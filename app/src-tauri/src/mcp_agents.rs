//! Settings → AI tools → "Configure" for popular AI agents: registers `hive.exe mcp` (the MCP server
//! built into this executable) as the "hive" MCP server in each agent's own config.
//!
//! - Claude Code: through its CLI (`claude mcp add --scope user …`) because it rewrites
//!   ~/.claude.json constantly; the file is edited directly only when the CLI is missing.
//! - Codex: the `[mcp_servers.hive]` table in ~/.codex/config.toml, edited in place.
//! - Claude Desktop, Cursor, Gemini CLI, Windsurf: `mcpServers.hive` in their JSON config.
//!
//! JSON configs are rewritten (keys come out sorted) after a one-file backup `<name>.hive-backup`.

use serde::Serialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const SERVER_NAME: &str = "hive";

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    ClaudeCode,
    Codex,
    /// JSON file with a top-level `mcpServers` object.
    McpServersJson,
}

struct Agent {
    id: &'static str,
    name: &'static str,
    kind: Kind,
    /// Config file to edit / inspect.
    config: PathBuf,
    /// The agent counts as installed when this exists.
    marker: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    id: &'static str,
    name: &'static str,
    /// The agent seems to be installed on this computer.
    detected: bool,
    /// "configured" (points at this hive.exe), "other" (a "hive" server with another command,
    /// e.g. the old hive-mcp package) or "none".
    state: &'static str,
    config_path: String,
    /// The command currently stored for the "hive" server, if any.
    current_command: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCommandInfo {
    command: String,
    args: Vec<String>,
    /// Ready-to-paste JSON for agents without a button.
    json: String,
}

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}

fn app_data() -> PathBuf {
    std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_else(|| home().join("AppData").join("Roaming"))
}

fn agents() -> Vec<Agent> {
    let home = home();
    vec![
        Agent { id: "claude-code", name: "Claude Code", kind: Kind::ClaudeCode, config: home.join(".claude.json"), marker: home.join(".claude") },
        Agent { id: "codex", name: "Codex", kind: Kind::Codex, config: home.join(".codex").join("config.toml"), marker: home.join(".codex") },
        Agent {
            id: "claude-desktop",
            name: "Claude Desktop",
            kind: Kind::McpServersJson,
            config: app_data().join("Claude").join("claude_desktop_config.json"),
            marker: app_data().join("Claude"),
        },
        Agent { id: "cursor", name: "Cursor", kind: Kind::McpServersJson, config: home.join(".cursor").join("mcp.json"), marker: home.join(".cursor") },
        Agent { id: "gemini", name: "Gemini CLI", kind: Kind::McpServersJson, config: home.join(".gemini").join("settings.json"), marker: home.join(".gemini") },
        Agent {
            id: "windsurf",
            name: "Windsurf",
            kind: Kind::McpServersJson,
            config: home.join(".codeium").join("windsurf").join("mcp_config.json"),
            marker: home.join(".codeium").join("windsurf"),
        },
    ]
}

/// This executable, without the `\\?\` prefix agents may not understand.
fn exe_path() -> Result<String, String> {
    let path = std::env::current_exe().map_err(|error| format!("could not find hive.exe: {error}"))?;
    let text = path.to_string_lossy().to_string();
    Ok(text.strip_prefix(r"\\?\").unwrap_or(&text).to_string())
}

fn same_path(a: &str, b: &str) -> bool {
    let normalize = |value: &str| value.trim().trim_matches('"').trim_matches('\'').replace('/', "\\").to_lowercase();
    normalize(a) == normalize(b)
}

// ---------- JSON configs ----------

fn read_json(path: &Path) -> Result<Map<String, Value>, String> {
    match fs::read_to_string(path) {
        Ok(raw) if raw.trim().is_empty() => Ok(Map::new()),
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(map)) => Ok(map),
            _ => Err(format!("{} is not valid JSON; fix or remove it first.", path.display())),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(error) => Err(format!("could not read {}: {error}", path.display())),
    }
}

fn backup(path: &Path) {
    if path.is_file() {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(".hive-backup");
        let _ = fs::copy(path, path.with_file_name(name));
    }
}

fn write_json(path: &Path, map: Map<String, Value>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    backup(path);
    let text = serde_json::to_string_pretty(&Value::Object(map)).map_err(|error| error.to_string())? + "\n";
    let temporary = path.with_extension("hive-tmp");
    fs::write(&temporary, text).map_err(|error| format!("could not write {}: {error}", path.display()))?;
    fs::rename(&temporary, path).map_err(|error| format!("could not replace {}: {error}", path.display()))
}

fn json_command(path: &Path) -> Option<String> {
    let map = read_json(path).ok()?;
    let entry = map.get("mcpServers")?.get(SERVER_NAME)?;
    let command = entry.get("command").and_then(Value::as_str).unwrap_or("");
    let args: Vec<&str> = entry.get("args").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).collect()).unwrap_or_default();
    Some(if args.is_empty() { command.to_string() } else { format!("{command} {}", args.join(" ")) })
}

fn set_json_server(path: &Path, entry: Option<Value>) -> Result<(), String> {
    let mut map = read_json(path)?;
    let servers = map.entry("mcpServers").or_insert_with(|| json!({}));
    if !servers.is_object() {
        *servers = json!({});
    }
    let servers = servers.as_object_mut().expect("object ensured above");
    match entry {
        Some(entry) => {
            servers.insert(SERVER_NAME.to_string(), entry);
        }
        None => {
            if servers.remove(SERVER_NAME).is_none() {
                return Ok(());
            }
        }
    }
    write_json(path, map)
}

// ---------- Codex TOML ----------

fn is_hive_table(line: &str) -> bool {
    let header = line.trim();
    if !header.starts_with('[') {
        return false;
    }
    let inner = header.trim_start_matches('[').trim_end_matches(']').trim();
    let inner = inner.replace(['"', '\''], "");
    inner == "mcp_servers.hive" || inner.starts_with("mcp_servers.hive.")
}

/// The config without the hive table (and its sub-tables such as `[mcp_servers.hive.env]`).
fn toml_without_hive(text: &str) -> (String, Option<String>) {
    let mut kept = Vec::new();
    let mut inside = false;
    let mut command = None;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('[') {
            inside = is_hive_table(trimmed);
        }
        if inside {
            if let Some(value) = trimmed.strip_prefix("command").map(str::trim_start).and_then(|rest| rest.strip_prefix('=')) {
                command = Some(value.trim().trim_matches('"').trim_matches('\'').replace("\\\\", "\\"));
            }
            continue;
        }
        kept.push(line);
    }
    while kept.last().is_some_and(|line| line.trim().is_empty()) {
        kept.pop();
    }
    (kept.join("\n"), command)
}

fn toml_string(value: &str) -> String {
    // A literal string needs no escaping unless it contains a single quote.
    if value.contains('\'') {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        format!("'{value}'")
    }
}

fn set_codex_server(path: &Path, exe: Option<&str>) -> Result<(), String> {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("could not read {}: {error}", path.display())),
    };
    let (mut rest, previous) = toml_without_hive(&text);
    if exe.is_none() && previous.is_none() {
        return Ok(());
    }
    if let Some(exe) = exe {
        if !rest.is_empty() {
            rest.push_str("\n\n");
        }
        rest.push_str(&format!("[mcp_servers.hive]\ncommand = {}\nargs = [\"mcp\"]\n", toml_string(exe)));
    } else {
        rest.push('\n');
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    backup(path);
    fs::write(path, rest).map_err(|error| format!("could not write {}: {error}", path.display()))
}

fn codex_command(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let (_, command) = toml_without_hive(&text);
    if command.is_some() {
        return command;
    }
    text.lines().any(is_hive_table).then(String::new)
}

// ---------- Claude Code CLI ----------

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Run `claude <args>`; None when the CLI is not installed.
fn claude_cli(args: &[&str]) -> Option<Result<String, String>> {
    #[cfg(windows)]
    let mut command = {
        // `claude` may be claude.exe or an npm .cmd shim: let cmd resolve it.
        let mut command = Command::new("cmd");
        command.arg("/C").arg("claude");
        command
    };
    #[cfg(not(windows))]
    let mut command = Command::new("claude");
    let output = hidden(command.args(args)).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let missing = stderr.contains("is not recognized") || stderr.contains("not found");
    if missing && !output.status.success() {
        return None;
    }
    Some(if output.status.success() { Ok(stdout) } else { Err(format!("{}{}", stderr.trim(), stdout.trim())) })
}

fn claude_code_command(agent: &Agent) -> Option<String> {
    json_command(&agent.config)
}

fn configure_claude_code(agent: &Agent, exe: Option<&str>) -> Result<(), String> {
    let _ = claude_cli(&["mcp", "remove", SERVER_NAME, "--scope", "user"]);
    match exe {
        Some(exe) => match claude_cli(&["mcp", "add", "--scope", "user", "--transport", "stdio", SERVER_NAME, "--", exe, "mcp"]) {
            Some(Ok(_)) => Ok(()),
            Some(Err(error)) => Err(format!("claude mcp add failed: {error}")),
            None => set_json_server(&agent.config, Some(json!({ "type": "stdio", "command": exe, "args": ["mcp"], "env": {} }))),
        },
        None => {
            if json_command(&agent.config).is_some() {
                set_json_server(&agent.config, None)
            } else {
                Ok(())
            }
        }
    }
}

// ---------- commands ----------

fn status(agent: &Agent, exe: &str) -> AgentStatus {
    let current = match agent.kind {
        Kind::ClaudeCode => claude_code_command(agent),
        Kind::Codex => codex_command(&agent.config),
        Kind::McpServersJson => json_command(&agent.config),
    };
    let state = match &current {
        None => "none",
        Some(command) if same_path(command.trim_end_matches(" mcp").trim(), exe) => "configured",
        Some(_) => "other",
    };
    AgentStatus {
        id: agent.id,
        name: agent.name,
        detected: agent.marker.exists() || agent.config.exists(),
        state,
        config_path: agent.config.to_string_lossy().to_string(),
        current_command: current,
    }
}

fn find(id: &str) -> Result<Agent, String> {
    agents().into_iter().find(|agent| agent.id == id).ok_or_else(|| format!("unknown agent '{id}'"))
}

fn apply(id: &str, enable: bool) -> Result<AgentStatus, String> {
    let agent = find(id)?;
    let exe = exe_path()?;
    let target = enable.then_some(exe.as_str());
    match agent.kind {
        Kind::ClaudeCode => configure_claude_code(&agent, target)?,
        Kind::Codex => set_codex_server(&agent.config, target)?,
        Kind::McpServersJson => set_json_server(&agent.config, target.map(|exe| json!({ "command": exe, "args": ["mcp"] })))?,
    }
    Ok(status(&agent, &exe))
}

#[tauri::command]
pub async fn mcp_agents_list() -> Result<Vec<AgentStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let exe = exe_path()?;
        Ok(agents().iter().map(|agent| status(agent, &exe)).collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn mcp_agent_configure(id: String, enable: bool) -> Result<AgentStatus, String> {
    tauri::async_runtime::spawn_blocking(move || apply(&id, enable)).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn mcp_command_info() -> Result<McpCommandInfo, String> {
    let command = exe_path()?;
    let json = serde_json::to_string_pretty(&json!({ "mcpServers": { SERVER_NAME: { "command": command, "args": ["mcp"] } } }))
        .map_err(|error| error.to_string())?;
    Ok(McpCommandInfo { command, args: vec!["mcp".into()], json })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hive-agents-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn codex_table_is_replaced_and_removed_in_place() {
        let dir = temp("codex");
        let path = dir.join("config.toml");
        fs::write(
            &path,
            "model = \"gpt\"\n\n[mcp_servers.hive]\ncommand = \"node\"\nargs = [\"x.js\"]\n\n[mcp_servers.hive.env]\nA = \"1\"\n\n[mcp_servers.other]\ncommand = \"o\"\n",
        )
        .unwrap();
        set_codex_server(&path, Some(r"C:\Program Files\hive\hive.exe")).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.contains("model = \"gpt\""));
        assert!(text.contains("[mcp_servers.other]\ncommand = \"o\""));
        assert!(!text.contains("node") && !text.contains("hive.env"));
        assert!(text.contains("[mcp_servers.hive]\ncommand = 'C:\\Program Files\\hive\\hive.exe'\nargs = [\"mcp\"]"));
        assert_eq!(codex_command(&path).as_deref(), Some(r"C:\Program Files\hive\hive.exe"));
        set_codex_server(&path, None).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(!text.contains("mcp_servers.hive"));
        assert!(text.contains("[mcp_servers.other]"));
        assert!(codex_command(&path).is_none());
        assert!(dir.join("config.toml.hive-backup").exists());
    }

    #[test]
    fn json_servers_keep_other_entries() {
        let dir = temp("json");
        let path = dir.join("mcp.json");
        fs::write(&path, r#"{"theme":"dark","mcpServers":{"other":{"command":"x"}}}"#).unwrap();
        set_json_server(&path, Some(json!({ "command": "C:\\hive.exe", "args": ["mcp"] }))).unwrap();
        let value: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "x");
        assert_eq!(value["mcpServers"]["hive"]["args"][0], "mcp");
        assert_eq!(json_command(&path).as_deref(), Some("C:\\hive.exe mcp"));
        set_json_server(&path, None).unwrap();
        assert!(json_command(&path).is_none());
    }

    #[test]
    fn broken_json_is_never_overwritten() {
        let dir = temp("broken");
        let path = dir.join("settings.json");
        fs::write(&path, "{ not json").unwrap();
        assert!(set_json_server(&path, Some(json!({ "command": "x" }))).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ not json");
    }

    #[test]
    fn status_compares_paths_loosely() {
        assert!(same_path("C:/Users/A/hive.exe", r"c:\users\a\HIVE.EXE"));
        assert!(!same_path("node", r"C:\hive.exe"));
    }
}
