//! The hive MCP tools: definitions (JSON Schema) and handlers. Read tools fall back to the project
//! files while hive is closed; write tools need the running app (every call = one Undo step there).

use super::client::{read_last_project_root, HiveBridge, HiveError};
use super::content::{content_to_blocks, offline_content, pretty, text_block, youtube_blocks_for, youtube_ids_in, youtube_to_blocks};
use super::offline::{self, OfflineProject};
use super::youtube;
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::time::Instant;

// ---------- schemas ----------

fn obj(properties: Value, required: &[&str]) -> Value {
    let mut schema = json!({ "type": "object", "properties": properties });
    if !required.is_empty() {
        schema["required"] = json!(required);
    }
    schema
}

fn with_description(mut schema: Value, description: &str) -> Value {
    schema["description"] = json!(description);
    schema
}

fn node_id() -> Value {
    json!({ "type": "string", "minLength": 1, "description": "Node id (from list_nodes / search_nodes / create_nodes)." })
}

fn ids(max: u64) -> Value {
    json!({ "type": "array", "items": node_id(), "minItems": 1, "maxItems": max })
}

fn string_array() -> Value {
    json!({ "type": "array", "items": { "type": "string" } })
}

fn point() -> Value {
    obj(json!({ "x": { "type": "number" }, "y": { "type": "number" } }), &["x", "y"])
}

fn rect() -> Value {
    obj(
        json!({
            "x": { "type": "number" },
            "y": { "type": "number" },
            "width": { "type": "number", "exclusiveMinimum": 0 },
            "height": { "type": "number", "exclusiveMinimum": 0 },
        }),
        &["x", "y", "width", "height"],
    )
}

fn hex() -> Value {
    json!({ "type": "string", "pattern": "^#[0-9a-fA-F]{6}$", "description": "Use #rrggbb." })
}

fn nullable(schema: Value, description: &str) -> Value {
    json!({ "anyOf": [schema, { "type": "null" }], "description": description })
}

fn glow() -> Value {
    obj(
        json!({
            "color": hex(),
            "opacity": { "type": "number", "minimum": 0.05, "maximum": 1 },
            "size": { "type": "number", "exclusiveMinimum": 0, "description": "Blur radius in board units." },
        }),
        &["color", "opacity", "size"],
    )
}

fn task_input() -> Value {
    json!({ "anyOf": [{ "type": "boolean" }, obj(json!({ "done": { "type": "boolean" } }), &["done"])] })
}

fn near() -> Value {
    obj(
        json!({
            "node": { "type": "string", "description": "Existing node id, or a `ref` of a node created in the same call." },
            "side": { "type": "string", "enum": ["right", "left", "below", "above"], "description": "Default right." },
            "gap": { "type": "number", "minimum": 0, "description": "Distance in board units (default ≈ 6)." },
        }),
        &["node"],
    )
}

fn link_kind() -> Value {
    json!({ "type": "string", "enum": ["strong", "weak"], "description": "strong = directed arrow (default); weak = dashed visual line." })
}

fn link_shape() -> Value {
    json!({ "type": "string", "description": "Line shape name from describe_node_kinds → enums.linkShapes. Omit for the default." })
}

fn data() -> Value {
    json!({
        "type": "object",
        "additionalProperties": true,
        "description": "Kind-specific fields exactly as in describe_node_kinds → kinds[].dataFields (e.g. listItems for list, tiers for tierlist). Validated by hive.",
    })
}

const TEXT_HIDDEN: &str = "true removes the text box of a text node completely; its text is kept and returns with false.";

fn create_spec() -> Value {
    obj(
        json!({
            "ref": { "type": "string", "description": "Temporary id for this call, usable in `links[].from/to` and `near.node`." },
            "type": { "type": "string", "description": "Node kind (default \"note\"). See describe_node_kinds." },
            "name": { "type": "string", "description": "Title; must be unique in the project — a taken name gets a numeric suffix (the final name is returned)." },
            "text": { "type": "string", "description": "Markdown body (for text-bearing kinds)." },
            "x": { "type": "number", "description": "Top-left x in board units. Omit to auto-place without overlaps." },
            "y": { "type": "number", "description": "Top-left y in board units (y grows downward)." },
            "near": with_description(near(), "Place next to another node instead of giving x/y."),
            "width": { "type": "number", "exclusiveMinimum": 0 },
            "height": nullable(json!({ "type": "number", "exclusiveMinimum": 0 }), "null/omitted = grows with the text."),
            "color": with_description(hex(), "Main colour (frame/header; a beacon's colour)."),
            "accentColor": with_description(hex(), "Inner/body colour."),
            "glow": glow(),
            "headerHidden": { "type": "boolean" },
            "textHidden": { "type": "boolean", "description": TEXT_HIDDEN },
            "task": with_description(task_input(), "true = open task; {done:true} = completed task."),
            "importance": { "type": "string", "description": "One of enums.importance." },
            "purposes": with_description(string_array(), "Values from enums.purposes."),
            "moods": with_description(string_array(), "Values from enums.moods."),
            "zoneId": { "type": "string" },
            "data": data(),
        }),
        &[],
    )
}

fn update_spec() -> Value {
    obj(
        json!({
            "id": node_id(),
            "name": { "type": "string", "description": "Rename (must stay unique; the .md file follows)." },
            "text": { "type": "string", "description": "Replace the whole Markdown body. Prefer textEdit for small changes." },
            "textEdit": {
                "description": "Precise edit of the body: find/replace, append or prepend.",
                "anyOf": [
                    obj(json!({
                        "find": { "type": "string", "minLength": 1 },
                        "replace": { "type": "string" },
                        "all": { "type": "boolean", "description": "Replace every match; otherwise `find` must match exactly once." },
                    }), &["find", "replace"]),
                    obj(json!({ "append": { "type": "string" } }), &["append"]),
                    obj(json!({ "prepend": { "type": "string" } }), &["prepend"]),
                ],
            },
            "x": { "type": "number" },
            "y": { "type": "number" },
            "width": { "type": "number", "exclusiveMinimum": 0 },
            "height": nullable(json!({ "type": "number", "exclusiveMinimum": 0 }), "null = auto height."),
            "color": nullable(hex(), "null clears."),
            "accentColor": nullable(hex(), "null clears."),
            "glow": nullable(glow(), "null removes the glow."),
            "headerHidden": { "type": "boolean" },
            "textHidden": { "type": "boolean", "description": TEXT_HIDDEN },
            "task": { "anyOf": [{ "type": "boolean" }, obj(json!({ "done": { "type": "boolean" } }), &["done"]), { "type": "null" }], "description": "true/{done} sets the task state; null or false removes the task flag." },
            "importance": nullable(json!({ "type": "string" }), "null clears."),
            "purposes": with_description(string_array(), "Replaces the list."),
            "moods": with_description(string_array(), "Replaces the list."),
            "zoneId": nullable(json!({ "type": "string" }), "null removes the zone."),
            "data": data(),
        }),
        &["id"],
    )
}

fn link_spec(endpoints: Value) -> Value {
    let mut properties = json!({ "kind": link_kind(), "shape": link_shape() });
    properties["from"] = endpoints.clone();
    properties["to"] = endpoints;
    obj(properties, &["from", "to"])
}

struct Annotations {
    read_only: bool,
    destructive: bool,
    idempotent: bool,
    open_world: bool,
}

const READ_ONLY: Annotations = Annotations { read_only: true, destructive: false, idempotent: true, open_world: false };
const ADDITIVE: Annotations = Annotations { read_only: false, destructive: false, idempotent: false, open_world: false };
const DESTRUCTIVE: Annotations = Annotations { read_only: false, destructive: true, idempotent: false, open_world: false };

fn tool(name: &str, title: &str, description: &str, schema: Value, annotations: Annotations) -> Value {
    json!({
        "name": name,
        "title": title,
        "description": description,
        "inputSchema": schema,
        "annotations": {
            "title": title,
            "readOnlyHint": annotations.read_only,
            "destructiveHint": annotations.destructive,
            "idempotentHint": annotations.idempotent,
            "openWorldHint": annotations.open_world,
        },
    })
}

pub fn definitions() -> Vec<Value> {
    let empty = obj(json!({}), &[]);
    vec![
        tool("get_status", "hive status",
            "Start here. Returns whether hive is running, the open project (name, folder), object counts, the camera and the visible board area (board units) and the current selection. When hive is closed the result has offline:true and only read tools work.",
            empty.clone(), READ_ONLY),
        tool("describe_node_kinds", "Node kinds and fields",
            "Every node kind hive supports (note, beacon, list, tierlist, goal, calendar, …) with a description, default width, whether it has a Markdown body, and its kind-specific `data` fields; plus the allowed values for importance, purposes, moods, link kinds and shapes, and the Markdown syntax hive renders. Call before creating anything other than plain notes. Needs hive running.",
            empty.clone(), READ_ONLY),
        tool("list_nodes", "List nodes",
            "List nodes with filters (kind, zone, task state, text query, rectangle, linked to a node) and paging. Returns short summaries with a 160-character text preview; use get_nodes for full text. Coordinates are board units, x/y = top-left, y grows downward.",
            obj(json!({
                "types": with_description(string_array(), "Only these kinds."),
                "zoneId": { "type": "string" },
                "task": { "type": "string", "enum": ["open", "done", "any", "none"] },
                "query": { "type": "string", "description": "Substring in name or text." },
                "bbox": with_description(rect(), "Only nodes intersecting this board rectangle."),
                "linkedTo": { "type": "string", "description": "Only nodes linked to this node id." },
                "sort": { "type": "string", "enum": ["position", "created", "name"] },
                "limit": { "type": "integer", "minimum": 1, "maximum": 500, "description": "Default 100." },
                "offset": { "type": "integer", "minimum": 0 },
            }), &[]), READ_ONLY),
        tool("get_nodes", "Get nodes",
            "Full data of up to 50 nodes by id or exact name: every stored field, the complete Markdown text, effective size, links (with the other node's name) and zone.",
            obj(json!({
                "ids": { "type": "array", "items": { "type": "string" }, "maxItems": 50 },
                "names": { "type": "array", "items": { "type": "string" }, "maxItems": 50, "description": "Exact names (case-insensitive fallback)." },
            }), &[]), READ_ONLY),
        tool("search_nodes", "Search",
            "Search node names, kinds and text with hive's own Search ranking (name matches first). Returns ids, names and a snippet around the match.",
            obj(json!({
                "query": { "type": "string", "minLength": 1 },
                "types": string_array(),
                "limit": { "type": "integer", "minimum": 1, "maximum": 100, "description": "Default 20." },
            }), &["query"]), READ_ONLY),
        tool("create_nodes", "Create nodes",
            "Create one or many nodes (any kind) and optionally link them, in ONE undoable step (Ctrl+Z in hive removes the whole batch). Nodes get the same defaults as hive's Q menu. Placement: explicit x/y, else `near` another node, else automatic placement from `origin` (default: centre of the visible area) using `layout`, never overlapping existing nodes. Use `ref` to link nodes created in the same call (e.g. a mind map: layout \"tree\" + links from the root). Returns the final ids, names and positions.",
            obj(json!({
                "nodes": { "type": "array", "items": create_spec(), "minItems": 1, "maxItems": 200 },
                "links": { "type": "array", "items": link_spec(json!({ "type": "string" })), "description": "from/to: node ids or refs from `nodes`." },
                "layout": { "type": "string", "enum": ["auto", "row", "column", "grid", "tree"], "description": "For nodes without x/y/near. Default auto." },
                "origin": with_description(point(), "Board point where automatic placement starts."),
                "gap": { "type": "number", "minimum": 0 },
            }), &["nodes"]), ADDITIVE),
        tool("update_nodes", "Update nodes",
            "Change existing nodes in ONE undoable step: rename, replace or precisely edit the Markdown text (find/replace that must match exactly once, append, prepend), move/resize, colours, glow, header, text box (textHidden), task state, importance, purposes, moods, zone, kind-specific data. Only the fields you pass change.",
            obj(json!({ "updates": { "type": "array", "items": update_spec(), "minItems": 1, "maxItems": 200 } }), &["updates"]), ADDITIVE),
        tool("delete_nodes", "Delete nodes",
            "Delete nodes exactly like the Delete key in hive: they go to the Trash (restorable with restore_from_trash) together with their links. mode \"archive\" archives instead. One undoable step.",
            obj(json!({ "ids": ids(500), "mode": { "type": "string", "enum": ["trash", "archive"] } }), &["ids"]), DESTRUCTIVE),
        tool("move_nodes", "Move nodes", "Set exact top-left positions (board units) of nodes. One undoable step.",
            obj(json!({ "moves": { "type": "array", "minItems": 1, "maxItems": 500, "items": obj(json!({ "id": node_id(), "x": { "type": "number" }, "y": { "type": "number" } }), &["id", "x", "y"]) } }), &["moves"]),
            ADDITIVE),
        tool("arrange_nodes", "Arrange nodes",
            "Lay out existing nodes as a row, column, grid, tree (by their links) or circle starting at `origin` (default: their current top-left). One undoable step.",
            obj(json!({
                "ids": ids(500),
                "layout": { "type": "string", "enum": ["row", "column", "grid", "tree", "circle"] },
                "origin": point(),
                "gap": { "type": "number", "minimum": 0 },
            }), &["ids", "layout"]), ADDITIVE),
        tool("list_links", "List links", "All lines between nodes, or only those touching `nodeId`, with both node names.",
            obj(json!({ "nodeId": { "type": "string" } }), &[]), READ_ONLY),
        tool("create_links", "Create links",
            "Draw lines between existing nodes (strong = arrow from → to, weak = dashed). hive's linking rules apply (e.g. beacons only have outgoing links); a refused link explains why. One undoable step.",
            obj(json!({ "links": { "type": "array", "items": link_spec(node_id()), "minItems": 1, "maxItems": 500 } }), &["links"]), ADDITIVE),
        tool("update_links", "Update links", "Change kind or shape of existing links. One undoable step.",
            obj(json!({ "updates": { "type": "array", "minItems": 1, "maxItems": 500, "items": obj(json!({ "id": { "type": "string" }, "kind": link_kind(), "shape": link_shape() }), &["id"]) } }), &["updates"]),
            ADDITIVE),
        tool("delete_links", "Delete links", "Remove links by id (nodes stay). One undoable step.",
            obj(json!({ "ids": { "type": "array", "items": { "type": "string" }, "minItems": 1, "maxItems": 500 } }), &["ids"]), DESTRUCTIVE),
        tool("list_zones", "List zones", "Zones (coloured areas that group nodes) with their rectangles and member node ids.", empty.clone(), READ_ONLY),
        tool("create_zone", "Create zone", "Create a zone either from an explicit rectangle or `around` a set of nodes with padding. One undoable step.",
            obj(json!({
                "name": { "type": "string" },
                "color": hex(),
                "rect": rect(),
                "around": obj(json!({ "ids": { "type": "array", "items": node_id(), "minItems": 1 }, "padding": { "type": "number", "minimum": 0 } }), &["ids"]),
            }), &[]), ADDITIVE),
        tool("update_zone", "Update zone", "Rename, recolour or move/resize a zone. One undoable step.",
            obj(json!({ "id": { "type": "string" }, "name": { "type": "string" }, "color": hex(), "rect": rect() }), &["id"]), ADDITIVE),
        tool("delete_zones", "Delete zones", "Delete zones; their nodes stay on the board. One undoable step.",
            obj(json!({ "ids": { "type": "array", "items": { "type": "string" }, "minItems": 1 } }), &["ids"]), DESTRUCTIVE),
        tool("import_file", "Import file",
            "Add a file from disk to the project exactly like dropping it on the board: it is copied into the project folder (big videos above the user's threshold are linked instead) and becomes an image, GIF, PDF, audio, video, text/code (format) or source node. Use an absolute path.",
            obj(json!({ "path": { "type": "string", "minLength": 1 }, "x": { "type": "number" }, "y": { "type": "number" }, "near": near(), "name": { "type": "string" } }), &["path"]),
            ADDITIVE),
        tool("list_trash", "List trash", "Entries in the project's Trash (deleted nodes) that restore_from_trash can bring back.", empty.clone(), READ_ONLY),
        tool("list_archive", "List archive", "Archived nodes of the project.", empty.clone(), READ_ONLY),
        tool("restore_from_trash", "Restore from trash", "Restore Trash entries by id (as listed by list_trash) to their old place, with their links. One undoable step.",
            obj(json!({ "ids": { "type": "array", "items": { "type": "string" }, "minItems": 1 } }), &["ids"]), ADDITIVE),
        tool("focus_view", "Show on screen",
            "Move hive's camera so the given nodes (or rectangle) are visible — use after creating something so the user sees it. Not an undo step.",
            obj(json!({ "ids": { "type": "array", "items": node_id() }, "bbox": rect(), "zoom": { "type": "number", "exclusiveMinimum": 0 } }), &[]),
            READ_ONLY),
        tool("undo_last_change", "Undo",
            "Undo the most recent change in hive. By default only undoes changes made through this MCP server (entries labelled \"MCP: …\") and refuses if the user changed something since.",
            obj(json!({ "onlyIfMcp": { "type": "boolean", "description": "Default true." } }), &[]), DESTRUCTIVE),
        tool("save_project", "Save now", "Write all pending changes to the project folder immediately (hive also saves automatically).",
            empty.clone(), Annotations { idempotent: true, ..ADDITIVE }),
        tool("read_node_content", "Read node content",
            "Read what is INSIDE nodes, not just their text: images and GIFs come back as real images you can look at (downscaled), inline pictures inside notes too; text/code/JSON/CSV files and project-copied sources come back as text; PDFs as page text; audio/video as duration, size and a poster frame; YouTube nodes and YouTube links inside notes are expanded with title, channel, description, thumbnail and transcript; lists, tierlists, goals, calendars and other modules as their data. Use this to study a project. Up to 10 nodes per call.",
            obj(json!({
                "ids": ids(10),
                "maxImagePx": { "type": "integer", "minimum": 256, "maximum": 2048, "description": "Longest image side, default 1024. Lower it when reading many images." },
                "pdfPages": obj(json!({ "from": { "type": "integer", "minimum": 1 }, "to": { "type": "integer", "minimum": 1 } }), &[]),
                "youtube": { "type": "string", "enum": ["full", "metadata", "none"], "description": "full (default): title, description, thumbnail and transcript; metadata: without transcript." },
            }), &["ids"]), Annotations { open_world: true, ..READ_ONLY }),
        tool("read_youtube", "Read a YouTube video",
            "Any YouTube link or video id (watch, youtu.be, shorts, embed, live, music): title, channel, length, views, description, thumbnail image and the transcript (captions in the requested language when available, otherwise the original).",
            obj(json!({
                "url": { "type": "string", "minLength": 1 },
                "transcript": { "type": "boolean", "description": "Default true." },
                "lang": { "type": "string", "description": "Preferred caption language code, e.g. \"ru\" or \"en\"." },
            }), &["url"]), Annotations { open_world: true, ..READ_ONLY }),
        tool("view_board", "Look at the board",
            "A real screenshot of the hive board as the user sees it — layout, colours, drawings, links, zones, pictures. Without arguments: the current view; with ids or bbox hive briefly moves the camera there, captures and moves it back. Needs the hive window open (not minimized).",
            obj(json!({ "ids": { "type": "array", "items": node_id() }, "bbox": rect(), "maxPx": { "type": "integer", "minimum": 512, "maximum": 3000, "description": "Default 1600." } }), &[]),
            READ_ONLY),
        tool("get_board_overview", "Project overview",
            "A cheap map of the whole project to plan a study: bounds, zones, clusters of connected/nearby nodes with labels, counts per node kind, media counts (images, PDFs, videos, YouTube…), open/done tasks, newest nodes and the longest texts.",
            empty, READ_ONLY),
    ]
}

// ---------- handlers ----------

pub struct Tools {
    bridge: HiveBridge,
    offline_cache: Option<(OfflineProject, Instant)>,
}

fn ok(value: Value) -> Value {
    let structured = if value.is_object() { value.clone() } else { json!({ "value": value }) };
    json!({ "content": [text_block(pretty(&value))], "structuredContent": structured })
}

fn fail(error: &HiveError) -> Value {
    let data = error.data.as_ref().map(|data| format!("\n{}", pretty(data))).unwrap_or_default();
    json!({ "content": [text_block(format!("[{}] {}{data}", error.code, error.message))], "isError": true })
}

impl Tools {
    pub fn new(bridge: HiveBridge) -> Self {
        Self { bridge, offline_cache: None }
    }

    fn offline(&mut self) -> Result<&OfflineProject, HiveError> {
        let fresh = self.offline_cache.as_ref().is_some_and(|(_, at)| at.elapsed().as_secs_f64() < 2.0);
        if !fresh {
            let root = self
                .bridge
                .info
                .as_ref()
                .and_then(|info| info.project_root.clone())
                .or_else(|| read_last_project_root(self.bridge.config_dir()))
                .ok_or_else(|| HiveError::new("not_running", "hive is not running and no previously opened project is known. Start hive."))?;
            let project = offline::load(&PathBuf::from(root))?;
            self.offline_cache = Some((project, Instant::now()));
        }
        Ok(&self.offline_cache.as_ref().expect("cache filled above").0)
    }

    /// Live call; read tools fall back to the project files when hive is not running.
    fn read(&mut self, method: &str, params: Value, fallback: impl FnOnce(&OfflineProject) -> Value) -> Value {
        match self.bridge.call(method, params) {
            Ok(value) => ok(value),
            Err(error) if error.is_not_running() => match self.offline() {
                Ok(project) => {
                    let mut value = fallback(project);
                    if let Some(map) = value.as_object_mut() {
                        map.insert("offline".into(), json!(true));
                    }
                    ok(value)
                }
                Err(offline_error) => fail(&offline_error),
            },
            Err(error) => fail(&error),
        }
    }

    fn write(&mut self, method: &str, params: Value) -> Value {
        match self.bridge.call(method, params) {
            Ok(value) => ok(value),
            Err(error) => fail(&error),
        }
    }

    pub fn call(&mut self, name: &str, args: Value) -> Option<Value> {
        let args = if args.is_object() { args } else { json!({}) };
        let result = match name {
            "get_status" => self.read("status", json!({}), OfflineProject::status),
            "describe_node_kinds" => self.write("schema", json!({})),
            "list_nodes" => self.read("nodes.list", args.clone(), |project| project.list(&args)),
            "get_nodes" => self.read("nodes.get", args.clone(), |project| project.get(&args)),
            "search_nodes" => self.read("search", args.clone(), |project| project.search(&args)),
            "create_nodes" => self.write("nodes.create", args),
            "update_nodes" => self.write("nodes.update", args),
            "delete_nodes" => self.write("nodes.delete", args),
            "move_nodes" => self.write("nodes.move", args),
            "arrange_nodes" => self.write("nodes.arrange", args),
            "list_links" => self.read("links.list", args.clone(), |project| project.links(&args)),
            "create_links" => self.write("links.create", args),
            "update_links" => self.write("links.update", args),
            "delete_links" => self.write("links.delete", args),
            "list_zones" => self.read("zones.list", json!({}), OfflineProject::zones),
            "create_zone" => self.write("zones.create", args),
            "update_zone" => self.write("zones.update", args),
            "delete_zones" => self.write("zones.delete", args),
            "import_file" => self.write("files.import", args),
            "list_trash" => self.read("trash.list", json!({}), |project| json!({ "entries": project.entries("trash") })),
            "list_archive" => self.read("archive.list", json!({}), |project| json!({ "entries": project.entries("archive") })),
            "restore_from_trash" => self.write("trash.restore", args),
            "focus_view" => self.write("view.focus", args),
            "undo_last_change" => self.write("history.undo", args),
            "save_project" => self.write("project.save", json!({})),
            "read_node_content" => self.read_node_content(&args),
            "read_youtube" => {
                let url = args.get("url").and_then(Value::as_str).unwrap_or("");
                let transcript = args.get("transcript").and_then(Value::as_bool) != Some(false);
                match youtube::read(url, transcript, args.get("lang").and_then(Value::as_str), true) {
                    Ok(info) => json!({ "content": youtube_to_blocks(&info, true) }),
                    Err(error) => fail(&error),
                }
            }
            "view_board" => match self.bridge.call("view.capture", args) {
                Ok(result) => json!({ "content": content_to_blocks(&result, "Board screenshot") }),
                Err(error) => fail(&error),
            },
            "get_board_overview" => self.read("board.overview", json!({}), |project| {
                let mut status = project.status();
                status["note"] = json!("Overview needs hive running; offline status shown instead.");
                status
            }),
            _ => return None,
        };
        Some(result)
    }

    fn read_node_content(&mut self, args: &Value) -> Value {
        let mut blocks: Vec<Value> = Vec::new();
        let mut youtube_ids: Vec<String> = Vec::new();
        for id in offline::string_list(args.get("ids")) {
            let mut params = Map::new();
            params.insert("id".into(), json!(id));
            for key in ["maxImagePx", "pdfPages"] {
                if let Some(value) = args.get(key) {
                    params.insert(key.into(), value.clone());
                }
            }
            let content = match self.bridge.call("nodes.content", Value::Object(params)) {
                Ok(content) => content,
                Err(error) if error.is_not_running() => match self.offline().and_then(|project| offline_content(project, &id, 200_000)) {
                    Ok(content) => content,
                    Err(offline_error) => {
                        blocks.push(text_block(format!("Node {id}: {}", offline_error.message)));
                        continue;
                    }
                },
                Err(error) => {
                    blocks.push(text_block(format!("Node {id}: [{}] {}", error.code, error.message)));
                    continue;
                }
            };
            let label = format!(
                "Node \"{}\" ({}, id {id})",
                content.get("name").and_then(Value::as_str).unwrap_or(&id),
                content.get("type").and_then(Value::as_str).unwrap_or("?"),
            );
            blocks.extend(content_to_blocks(&content, &label));
            for video in youtube_ids_in(&content) {
                if !youtube_ids.contains(&video) {
                    youtube_ids.push(video);
                }
            }
        }
        let mode = args.get("youtube").and_then(Value::as_str).unwrap_or("full");
        if !youtube_ids.is_empty() && mode != "none" {
            blocks.extend(youtube_blocks_for(&youtube_ids, mode != "metadata"));
        }
        json!({ "content": blocks })
    }
}
