//! `hive.exe mcp` — the MCP server built into hive. It speaks MCP (JSON-RPC 2.0, one message per
//! line) on stdin/stdout and drives the running hive through the local token bridge
//! (mcp_bridge.rs), exactly like the separate hive-mcp package did. While hive is closed the read
//! tools show the last project read-only. Nothing but protocol messages may go to stdout.

mod client;
mod compact;
mod content;
mod offline;
mod short_ids;
mod tools;
mod youtube;

use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

const INSTRUCTIONS: &str = "hive is a spatial board for notes (an Obsidian-like app): nodes (notes, tasks, beacons, lists, tierlists, media…) placed on an infinite board, connected by links and grouped by zones.
- Call get_status first; describe_node_kinds before creating anything but plain notes.
- Ids are short (8 characters, a few longer to stay unique); pass them back exactly as given — full ids work too.
- Coordinates are board units; x/y is a node's top-left; y grows downward. Omit x/y to let hive place nodes without overlaps.
- Every write tool call is ONE undo step in hive (the user can press Ctrl+Z), labelled \"MCP: …\".
- Find nodes with search_nodes or list_nodes; read full text with get_nodes; edit text precisely with update_nodes textEdit.
- To understand what is INSIDE nodes (pictures, GIFs, PDFs, text/code files, media, YouTube videos incl. transcripts) use read_node_content; view_board shows the board as an image; get_board_overview maps the whole project. The study_project prompt walks through all of it.
- After creating or changing something the user should look at, call focus_view.
- Writes need hive running; while it is closed the read tools show the last project read-only.";

/// MCP revisions this server understands, newest first.
const PROTOCOL_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

/// True when hive was started as `hive.exe mcp`.
pub fn requested() -> bool {
    std::env::args().nth(1).is_some_and(|arg| arg.eq_ignore_ascii_case("mcp") || arg == "--mcp")
}

/// Same location as Tauri's app_config_dir() for this identifier.
pub fn config_dir(identifier: &str) -> PathBuf {
    if let Ok(dir) = std::env::var("HIVE_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home().join("AppData").join("Roaming"));
    #[cfg(target_os = "macos")]
    let base = home().join("Library").join("Application Support");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let base = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home().join(".config"));
    base.join(identifier)
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

fn study_prompt(focus: Option<&str>) -> Value {
    let mut lines = vec!["Study my hive project thoroughly using the hive tools, then give me a structured summary.".to_string()];
    if let Some(focus) = focus.filter(|focus| !focus.trim().is_empty()) {
        lines.push(format!("Focus especially on: {focus}."));
    }
    lines.extend(
        [
            "Steps:",
            "1. get_status and get_board_overview to learn the size, zones, clusters and media.",
            "2. view_board (whole view, then each zone or big cluster by ids) to see the layout and drawings.",
            "3. list_nodes page by page; read the full content of every node that matters with read_node_content (10 ids per call; use maxImagePx 768 when there are many images).",
            "4. Look at every image, read PDFs and text files, and use the YouTube details/transcripts that read_node_content returns (read_youtube for any remaining links).",
            "5. list_links and list_zones to understand how ideas connect.",
            "Then report: what the project is about, its main areas and how they relate, key facts from images/PDFs/videos, open tasks and priorities, and gaps or contradictions you noticed. Do not change anything in the project.",
        ]
        .map(str::to_string),
    );
    json!({
        "description": "Study the hive project",
        "messages": [{ "role": "user", "content": { "type": "text", "text": lines.join("\n") } }],
    })
}

fn prompt_list() -> Value {
    json!({
        "prompts": [{
            "name": "study_project",
            "title": "Study the hive project",
            "description": "Read and understand the whole open hive project: structure, every note, pictures, files, PDFs and YouTube videos.",
            "arguments": [{ "name": "focus", "description": "Optional topic or question to focus on.", "required": false }],
        }],
    })
}

enum Outcome {
    Result(Value),
    Error(i64, String),
}

fn handle(tools: &mut tools::Tools, method: &str, params: &Value) -> Outcome {
    match method {
        "initialize" => {
            let requested = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSIONS[0]);
            let version = if PROTOCOL_VERSIONS.contains(&requested) { requested } else { PROTOCOL_VERSIONS[0] };
            Outcome::Result(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false }, "prompts": { "listChanged": false } },
                "serverInfo": { "name": "hive", "title": "hive", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }))
        }
        "ping" => Outcome::Result(json!({})),
        "tools/list" => Outcome::Result(json!({ "tools": tools::definitions() })),
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            match tools.call(name, arguments) {
                Some(result) => Outcome::Result(result),
                None => Outcome::Error(-32602, format!("Unknown tool: {name}")),
            }
        }
        "prompts/list" => Outcome::Result(prompt_list()),
        "prompts/get" => match params.get("name").and_then(Value::as_str) {
            Some("study_project") => Outcome::Result(study_prompt(params.pointer("/arguments/focus").and_then(Value::as_str))),
            other => Outcome::Error(-32602, format!("Unknown prompt: {}", other.unwrap_or(""))),
        },
        "resources/list" => Outcome::Result(json!({ "resources": [] })),
        "resources/templates/list" => Outcome::Result(json!({ "resourceTemplates": [] })),
        _ => Outcome::Error(-32601, format!("Method not found: {method}")),
    }
}

fn respond(out: &mut impl Write, message: Value) -> io::Result<()> {
    let mut line = message.to_string();
    line.push('\n');
    out.write_all(line.as_bytes())?;
    out.flush()
}

fn handle_message(tools: &mut tools::Tools, message: &Value) -> Option<Value> {
    let id = message.get("id").cloned();
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        // A response to a request we never send, or garbage with an id.
        return id.map(|id| json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32600, "message": "Invalid request" } }));
    };
    // Notifications (initialized, cancelled, …) get no answer.
    let id = id?;
    let params = message.get("params").cloned().unwrap_or_else(|| json!({}));
    Some(match handle(tools, method, &params) {
        Outcome::Result(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Outcome::Error(code, text) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": text } }),
    })
}

/// Serve MCP on stdio until stdin closes.
pub fn run(identifier: &str) {
    let bridge = client::HiveBridge::new(config_dir(identifier), format!("hive-builtin-mcp/{}", env!("CARGO_PKG_VERSION")));
    let mut tools = tools::Tools::new(bridge);
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let parsed: Result<Value, _> = serde_json::from_str(&line);
        let replies: Vec<Value> = match parsed {
            Ok(Value::Array(batch)) => batch.iter().filter_map(|message| handle_message(&mut tools, message)).collect(),
            Ok(message) => handle_message(&mut tools, &message).into_iter().collect(),
            Err(_) => vec![json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } })],
        };
        for reply in replies {
            if respond(&mut out, reply).is_err() {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> tools::Tools {
        let dir = std::env::temp_dir().join(format!("hive-mcp-test-{}", std::process::id()));
        tools::Tools::new(client::HiveBridge::new(dir, "test".into()))
    }

    #[test]
    fn initializes_and_lists_tools() {
        let mut tools = tools();
        let init = handle_message(&mut tools, &json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-06-18" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        assert_eq!(init["result"]["serverInfo"]["name"], "hive");
        assert!(handle_message(&mut tools, &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let list = handle_message(&mut tools, &json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = list["result"]["tools"].as_array().unwrap().iter().map(|tool| tool["name"].as_str().unwrap()).collect();
        assert_eq!(names.len(), 29);
        for name in ["get_status", "create_nodes", "read_node_content", "view_board", "read_youtube"] {
            assert!(names.contains(&name), "{name}");
        }
        for tool in list["result"]["tools"].as_array().unwrap() {
            assert_eq!(tool["inputSchema"]["type"], "object", "{}", tool["name"]);
        }
    }

    #[test]
    fn write_tools_report_hive_not_running() {
        let mut tools = tools();
        let reply = handle_message(&mut tools, &json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": "create_nodes", "arguments": { "nodes": [{}] } } })).unwrap();
        assert_eq!(reply["result"]["isError"], true);
        assert!(reply["result"]["content"][0]["text"].as_str().unwrap().contains("not_running"));
    }

    #[test]
    fn unknown_method_is_an_error() {
        let mut tools = tools();
        let reply = handle_message(&mut tools, &json!({ "jsonrpc": "2.0", "id": 4, "method": "nope" })).unwrap();
        assert_eq!(reply["error"]["code"], -32601);
    }
}
