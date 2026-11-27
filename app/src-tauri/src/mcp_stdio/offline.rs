//! Read-only view of a hive project folder, used by `hive.exe mcp` while hive is closed.
//! Mirrors the shapes of the live bridge's read methods as far as the files allow
//! (no measured heights, no camera, no selection).

use super::client::HiveError;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

pub struct OfflineProject {
    pub root: PathBuf,
    pub name: String,
    pub index: Map<String, Value>,
    pub notes: Vec<Map<String, Value>>,
    texts: HashMap<String, String>,
}

/// hive 1.8.3+ keeps one file per object (nodes/<id>.json, …) next to a small board.json.
const SPLIT_COLLECTIONS: [(&str, &str); 6] = [
    ("notes", "nodes"),
    ("links", "links"),
    ("zones", "zones"),
    ("trash", "trash"),
    ("archive", "archive"),
    ("taskLog", "tasklog"),
];

/// Default and largest text preview in list results, as in hive (app/src/mcp/readMethods.ts).
const PREVIEW: u64 = 80;
const MAX_PREVIEW: u64 = 300;

pub fn load(root: &Path) -> Result<OfflineProject, HiveError> {
    let index_path = root.join("board.json");
    let raw = fs::read_to_string(&index_path)
        .map_err(|error| HiveError::new("internal", format!("Cannot read {}: {error}", index_path.display())))?;
    let mut index = match serde_json::from_str::<Value>(&raw) {
        Ok(Value::Object(map)) => map,
        _ => return Err(HiveError::new("internal", format!("Cannot read {}: not a JSON object", index_path.display()))),
    };
    if !index.get("notes").is_some_and(Value::is_array) {
        assemble_split_board(root, &mut index);
    }
    let notes: Vec<Map<String, Value>> = index
        .get("notes")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| item.as_object().cloned()).collect())
        .unwrap_or_default();
    let mut texts = HashMap::new();
    for note in &notes {
        let Some(file) = note.get("file").and_then(Value::as_str) else { continue };
        if file.contains('/') || file.contains('\\') {
            continue;
        }
        let text = fs::read_to_string(root.join("notes").join(file)).unwrap_or_default();
        texts.insert(id_of(note), text);
    }
    let name = root.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    Ok(OfflineProject { root: root.to_path_buf(), name, index, notes, texts })
}

fn assemble_split_board(root: &Path, index: &mut Map<String, Value>) {
    for (key, directory) in SPLIT_COLLECTIONS {
        let mut items = read_objects(&root.join(directory));
        items.sort_by(|a, b| {
            order(a).partial_cmp(&order(b)).unwrap_or(std::cmp::Ordering::Equal).then_with(|| id_of(a).cmp(&id_of(b)))
        });
        let items = items
            .into_iter()
            .map(|mut item| {
                item.remove("_order");
                Value::Object(item)
            })
            .collect();
        index.insert(key.to_string(), Value::Array(items));
    }
    let mut calculators = Map::new();
    for item in read_objects(&root.join("calculators")) {
        if let Some(key) = item.get("key").and_then(Value::as_str) {
            calculators.insert(key.to_string(), item.get("value").cloned().unwrap_or(Value::Null));
        }
    }
    index.insert("calculators".to_string(), Value::Object(calculators));
}

fn read_objects(directory: &Path) -> Vec<Map<String, Value>> {
    let Ok(entries) = fs::read_dir(directory) else { return Vec::new() };
    entries
        .flatten()
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
        // Unreadable files (e.g. an unresolved Git conflict) are skipped.
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|raw| match serde_json::from_str::<Value>(&raw) {
            Ok(Value::Object(map)) => Some(map),
            _ => None,
        })
        .collect()
}

fn order(item: &Map<String, Value>) -> f64 {
    item.get("_order").and_then(Value::as_f64).unwrap_or(f64::MAX)
}

fn id_of(note: &Map<String, Value>) -> String {
    match note.get("id") {
        Some(Value::String(id)) => id.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    }
}

fn type_of(note: &Map<String, Value>) -> String {
    note.get("type").and_then(Value::as_str).unwrap_or("note").to_string()
}

fn num(note: &Map<String, Value>, key: &str) -> f64 {
    note.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

impl OfflineProject {
    pub fn text_of(&self, note: &Map<String, Value>) -> String {
        self.texts
            .get(&id_of(note))
            .cloned()
            .unwrap_or_else(|| note.get("text").and_then(Value::as_str).unwrap_or("").to_string())
    }

    fn collection(&self, key: &str) -> Vec<&Map<String, Value>> {
        self.index
            .get(key)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_object).collect())
            .unwrap_or_default()
    }

    pub fn entries(&self, key: &str) -> Value {
        self.index.get(key).filter(|value| value.is_array()).cloned().unwrap_or_else(|| json!([]))
    }

    pub fn find(&self, id: &str) -> Option<&Map<String, Value>> {
        self.notes.iter().find(|note| id_of(note) == id)
    }

    fn name_of(&self, id: &Value) -> Value {
        self.notes
            .iter()
            .find(|note| note.get("id") == Some(id))
            .and_then(|note| note.get("name").cloned())
            .unwrap_or(Value::Null)
    }

    fn link_info(&self, link: &Map<String, Value>) -> Value {
        let from = link.get("from").cloned().unwrap_or(Value::Null);
        let to = link.get("to").cloned().unwrap_or(Value::Null);
        let mut out = Map::new();
        out.insert("id".into(), link.get("id").cloned().unwrap_or(Value::Null));
        out.insert("from".into(), from.clone());
        out.insert("to".into(), to.clone());
        // Kind and shape only when they are not the defaults (strong, base), as hive answers.
        if let Some(kind) = link.get("kind").filter(|kind| kind.as_str() != Some("strong")) {
            out.insert("kind".into(), kind.clone());
        }
        if let Some(shape) = link.get("shape").filter(|shape| shape.as_str() != Some("base")) {
            out.insert("shape".into(), shape.clone());
        }
        out.insert("fromName".into(), self.name_of(&from));
        out.insert("toName".into(), self.name_of(&to));
        Value::Object(out)
    }

    /// Every id an agent can name: nodes, links, zones, Trash and Archive entries.
    pub fn object_ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.notes.iter().map(id_of).collect();
        for key in ["links", "zones", "trash", "archive"] {
            ids.extend(self.collection(key).into_iter().filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_string)));
        }
        ids
    }

    fn touches(link: &Map<String, Value>, id: &str) -> bool {
        link.get("from").and_then(Value::as_str) == Some(id) || link.get("to").and_then(Value::as_str) == Some(id)
    }

    fn summary(&self, note: &Map<String, Value>, preview: usize) -> Value {
        let id = id_of(note);
        let text = self.text_of(note);
        let mut out = Map::new();
        out.insert("id".into(), json!(id));
        out.insert("type".into(), json!(type_of(note)));
        for key in ["name", "x", "y", "width"] {
            out.insert(key.into(), note.get(key).cloned().unwrap_or(Value::Null));
        }
        out.insert("height".into(), note.get("height").cloned().unwrap_or(Value::Null));
        if let Some(color) = note.get("color").filter(|value| truthy(value)) {
            out.insert("color".into(), color.clone());
        }
        if let Some(task) = note.get("task").and_then(Value::as_object) {
            out.insert("task".into(), json!({ "done": task.get("done").and_then(Value::as_bool).unwrap_or(false) }));
        }
        for key in ["importance", "zoneId"] {
            if let Some(value) = note.get(key).filter(|value| truthy(value)) {
                out.insert(key.into(), value.clone());
            }
        }
        for key in ["purposes", "moods"] {
            if let Some(list) = note.get(key).and_then(Value::as_array).filter(|list| !list.is_empty()) {
                out.insert(key.into(), Value::Array(list.clone()));
            }
        }
        let text_preview: String = collapse_whitespace(&text).chars().take(preview).collect();
        if !text_preview.is_empty() {
            out.insert("textPreview".into(), json!(text_preview));
        }
        let links = self.collection("links").into_iter().filter(|link| Self::touches(link, &id)).count();
        if links > 0 {
            out.insert("linkCount".into(), json!(links));
        }
        Value::Object(out)
    }

    pub fn status(&self) -> Value {
        let count = |key: &str| self.index.get(key).and_then(Value::as_array).map_or(0, Vec::len);
        json!({
            "live": false,
            "readOnly": true,
            "project": { "name": self.name, "root": self.root.to_string_lossy() },
            "counts": {
                "nodes": self.notes.len(),
                "links": count("links"),
                "zones": count("zones"),
                "trash": count("trash"),
                "archive": count("archive"),
            },
            "note": "hive is not running: this is a read-only view of the last opened project. Start hive to make changes.",
        })
    }

    pub fn list(&self, filter: &Value) -> Value {
        let types: Vec<String> = string_list(filter.get("types"));
        let zone = filter.get("zoneId").and_then(Value::as_str);
        let task_filter = filter.get("task").and_then(Value::as_str);
        let query = filter.get("query").and_then(Value::as_str).map(str::to_lowercase);
        let linked_to = filter.get("linkedTo").and_then(Value::as_str);
        let linked: Option<HashSet<String>> = linked_to.map(|target| {
            self.collection("links")
                .into_iter()
                .filter_map(|link| {
                    let from = link.get("from").and_then(Value::as_str)?;
                    let to = link.get("to").and_then(Value::as_str)?;
                    if from == target {
                        Some(to.to_string())
                    } else if to == target {
                        Some(from.to_string())
                    } else {
                        None
                    }
                })
                .collect()
        });
        let bbox = filter.get("bbox").and_then(Value::as_object);
        let mut result: Vec<&Map<String, Value>> = self
            .notes
            .iter()
            .filter(|note| {
                if !types.is_empty() && !types.contains(&type_of(note)) {
                    return false;
                }
                if let Some(zone) = zone {
                    if note.get("zoneId").and_then(Value::as_str) != Some(zone) {
                        return false;
                    }
                }
                let task = note.get("task").and_then(Value::as_object);
                let done = task.and_then(|task| task.get("done")).and_then(Value::as_bool).unwrap_or(false);
                match task_filter {
                    Some("none") if task.is_some() => return false,
                    Some("any") if task.is_none() => return false,
                    Some("open") if !(task.is_some() && !done) => return false,
                    Some("done") if !(task.is_some() && done) => return false,
                    _ => {}
                }
                if let Some(linked) = &linked {
                    if !linked.contains(&id_of(note)) {
                        return false;
                    }
                }
                if let Some(b) = bbox {
                    let bx = b.get("x").and_then(Value::as_f64).unwrap_or(0.0);
                    let by = b.get("y").and_then(Value::as_f64).unwrap_or(0.0);
                    let bw = b.get("width").and_then(Value::as_f64).unwrap_or(0.0);
                    let bh = b.get("height").and_then(Value::as_f64).unwrap_or(0.0);
                    let (x, y, w, h) = (num(note, "x"), num(note, "y"), num(note, "width"), num(note, "height"));
                    if x + w < bx || x > bx + bw || y + h < by || y > by + bh {
                        return false;
                    }
                }
                if let Some(query) = &query {
                    let name = note.get("name").and_then(Value::as_str).unwrap_or("");
                    if !format!("{name}\n{}", self.text_of(note)).to_lowercase().contains(query.as_str()) {
                        return false;
                    }
                }
                true
            })
            .collect();
        match filter.get("sort").and_then(Value::as_str).unwrap_or("position") {
            "name" => result.sort_by_key(|note| note.get("name").and_then(Value::as_str).unwrap_or("").to_string()),
            "created" => result.sort_by(|a, b| num(a, "createdAt").partial_cmp(&num(b, "createdAt")).unwrap_or(std::cmp::Ordering::Equal)),
            _ => result.sort_by(|a, b| {
                num(a, "y")
                    .partial_cmp(&num(b, "y"))
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then(num(a, "x").partial_cmp(&num(b, "x")).unwrap_or(std::cmp::Ordering::Equal))
            }),
        }
        let offset = filter.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
        let limit = filter.get("limit").and_then(Value::as_u64).unwrap_or(50).clamp(1, 500) as usize;
        let preview = filter.get("preview").and_then(Value::as_u64).unwrap_or(PREVIEW).min(MAX_PREVIEW) as usize;
        let total = result.len();
        let nodes: Vec<Value> = result.into_iter().skip(offset).take(limit).map(|note| self.summary(note, preview)).collect();
        json!({ "total": total, "nodes": nodes })
    }

    pub fn get(&self, input: &Value) -> Value {
        let mut found = Vec::new();
        let mut missing = Vec::new();
        let full = |note: &Map<String, Value>| -> Value {
            let id = id_of(note);
            let mut out = note.clone();
            out.insert("type".into(), json!(type_of(note)));
            out.insert("text".into(), json!(self.text_of(note)));
            let links: Vec<Value> = self
                .collection("links")
                .into_iter()
                .filter(|link| Self::touches(link, &id))
                .map(|link| self.link_info(link))
                .collect();
            out.insert("links".into(), Value::Array(links));
            if let Some(zone) = self.collection("zones").into_iter().find(|zone| zone.get("id") == note.get("zoneId")) {
                out.insert("zone".into(), json!({ "id": zone.get("id"), "name": zone.get("name") }));
            }
            Value::Object(out)
        };
        for id in string_list(input.get("ids")) {
            match self.find(&id) {
                Some(note) => found.push(full(note)),
                None => missing.push(id),
            }
        }
        for name in string_list(input.get("names")) {
            let lower = name.to_lowercase();
            let note = self
                .notes
                .iter()
                .find(|note| note.get("name").and_then(Value::as_str) == Some(name.as_str()))
                .or_else(|| {
                    self.notes
                        .iter()
                        .find(|note| note.get("name").and_then(Value::as_str).map(str::to_lowercase).as_deref() == Some(lower.as_str()))
                });
            match note {
                Some(note) => found.push(full(note)),
                None => missing.push(name),
            }
        }
        json!({ "nodes": found, "missing": missing })
    }

    pub fn search(&self, input: &Value) -> Value {
        let needle = input.get("query").and_then(Value::as_str).unwrap_or("").trim().to_lowercase();
        if needle.is_empty() {
            return json!({ "results": [] });
        }
        let types = string_list(input.get("types"));
        let mut results: Vec<(u8, Value)> = Vec::new();
        for note in &self.notes {
            let kind = type_of(note);
            if !types.is_empty() && !types.contains(&kind) {
                continue;
            }
            let name = note.get("name").and_then(Value::as_str).unwrap_or("").to_string();
            let text = self.text_of(note);
            let hit = if name.to_lowercase().contains(&needle) {
                Some((0, "name", name.clone()))
            } else if kind.to_lowercase().contains(&needle) {
                Some((1, "kind", kind.clone()))
            } else {
                snippet_around(&text, &needle).map(|snippet| (2, "text", snippet))
            };
            if let Some((rank, matched_in, snippet)) = hit {
                results.push((rank, json!({ "id": note.get("id"), "name": name, "type": kind, "matchedIn": matched_in, "snippet": snippet })));
            }
        }
        results.sort_by_key(|(rank, _)| *rank);
        let limit = input.get("limit").and_then(Value::as_u64).unwrap_or(20).clamp(1, 100) as usize;
        json!({ "results": results.into_iter().take(limit).map(|(_, value)| value).collect::<Vec<_>>() })
    }

    pub fn links(&self, input: &Value) -> Value {
        let node = input.get("nodeId").and_then(Value::as_str);
        let links: Vec<Value> = self
            .collection("links")
            .into_iter()
            .filter(|link| node.map_or(true, |id| Self::touches(link, id)))
            .map(|link| self.link_info(link))
            .collect();
        json!({ "links": links })
    }

    /// Zones as hive lists them: bounding rectangle and node count; member ids and polygon on request.
    pub fn zones(&self, input: &Value) -> Value {
        let members_wanted = input.get("members").and_then(Value::as_bool) == Some(true);
        let geometry_wanted = input.get("geometry").and_then(Value::as_bool) == Some(true);
        let zones: Vec<Value> = self
            .collection("zones")
            .into_iter()
            .map(|zone| {
                let members: Vec<Value> = self
                    .notes
                    .iter()
                    .filter(|note| note.get("zoneId").is_some() && note.get("zoneId") == zone.get("id"))
                    .map(|note| note.get("id").cloned().unwrap_or(Value::Null))
                    .collect();
                let mut out = Map::new();
                for key in ["id", "name", "color"] {
                    out.insert(key.into(), zone.get(key).cloned().unwrap_or(Value::Null));
                }
                out.insert("rect".into(), zone_rect(zone));
                out.insert("nodeCount".into(), json!(members.len()));
                if members_wanted {
                    out.insert("nodeIds".into(), Value::Array(members));
                }
                if geometry_wanted {
                    for key in ["parts", "holes"] {
                        out.insert(key.into(), zone.get(key).cloned().unwrap_or_else(|| json!([])));
                    }
                }
                Value::Object(out)
            })
            .collect();
        json!({ "zones": zones })
    }
}

/// Bounding rectangle of a zone's outer contours.
fn zone_rect(zone: &Map<String, Value>) -> Value {
    let points: Vec<(f64, f64)> = zone
        .get("parts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_array)
        .flatten()
        .filter_map(|point| Some((point.get("x")?.as_f64()?, point.get("y")?.as_f64()?)))
        .collect();
    if points.is_empty() {
        return json!({ "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 });
    }
    let min_x = points.iter().map(|point| point.0).fold(f64::INFINITY, f64::min);
    let min_y = points.iter().map(|point| point.1).fold(f64::INFINITY, f64::min);
    let max_x = points.iter().map(|point| point.0).fold(f64::NEG_INFINITY, f64::max);
    let max_y = points.iter().map(|point| point.1).fold(f64::NEG_INFINITY, f64::max);
    json!({ "x": min_x, "y": min_y, "width": max_x - min_x, "height": max_y - min_y })
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

pub fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default()
}

pub fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// ±60 characters around the first case-insensitive match, whitespace collapsed.
fn snippet_around(text: &str, needle: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = text.chars().flat_map(char::to_lowercase).collect();
    if lower.len() != chars.len() {
        // Lowercasing changed the length (rare scripts): fall back to a whole-text check.
        return text.to_lowercase().contains(needle).then(|| collapse_whitespace(&chars.iter().take(160).collect::<String>()));
    }
    let needle_chars: Vec<char> = needle.chars().collect();
    let at = lower.windows(needle_chars.len()).position(|window| window == needle_chars.as_slice())?;
    let start = at.saturating_sub(60);
    let end = (at + needle_chars.len() + 60).min(chars.len());
    Some(collapse_whitespace(&chars[start..end].iter().collect::<String>()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> OfflineProject {
        let notes: Vec<Map<String, Value>> = (0..60)
            .map(|index| {
                let mut note = json!({ "id": format!("n{index}"), "name": format!("Node {index}"), "type": "note", "x": index * 40, "y": 0, "width": 30 });
                if index < 2 {
                    note["zoneId"] = json!("z1");
                }
                note.as_object().unwrap().clone()
            })
            .collect();
        let index = json!({
            "notes": notes,
            "links": [
                { "id": "l1", "from": "n0", "to": "n1", "kind": "strong", "shape": "base" },
                { "id": "l2", "from": "n1", "to": "n2", "kind": "weak", "shape": "wave" },
            ],
            "zones": [{ "id": "z1", "name": "Zone", "color": "#608ac1", "parts": [[{ "x": 0, "y": 0 }, { "x": 70.5, "y": 0 }, { "x": 70.5, "y": 100 }, { "x": 0, "y": 100 }]], "holes": [] }],
            "trash": [{ "id": "t1" }],
            "archive": [],
        });
        let mut texts = HashMap::new();
        texts.insert("n3".to_string(), "The quick brown fox".to_string());
        texts.insert("n4".to_string(), "x".repeat(200));
        OfflineProject { root: PathBuf::from("C:/p"), name: "P".into(), index: index.as_object().unwrap().clone(), notes, texts }
    }

    #[test]
    fn zones_are_summaries_with_members_and_geometry_on_request() {
        let project = project();
        let summary = json!({ "id": "z1", "name": "Zone", "color": "#608ac1", "rect": { "x": 0.0, "y": 0.0, "width": 70.5, "height": 100.0 }, "nodeCount": 2 });
        assert_eq!(project.zones(&json!({})), json!({ "zones": [summary.clone()] }));
        let mut with_members = summary.clone();
        with_members["nodeIds"] = json!(["n0", "n1"]);
        assert_eq!(project.zones(&json!({ "members": true })), json!({ "zones": [with_members] }));
        let geometry = project.zones(&json!({ "geometry": true }));
        assert!(geometry["zones"][0]["parts"].is_array() && geometry["zones"][0]["holes"].is_array());
    }

    #[test]
    fn list_pages_50_with_preview_and_link_counts() {
        let project = project();
        let listed = project.list(&json!({}));
        assert_eq!(listed["total"], json!(60));
        assert_eq!(listed["nodes"].as_array().unwrap().len(), 50);
        let node = |listed: &Value, id: &str| listed["nodes"].as_array().unwrap().iter().find(|node| node["id"] == json!(id)).cloned().unwrap();
        assert_eq!(node(&listed, "n4")["textPreview"].as_str().unwrap().chars().count(), 80);
        assert!(node(&listed, "n10").get("textPreview").is_none());
        assert!(node(&listed, "n10").get("linkCount").is_none());
        assert_eq!(node(&listed, "n1")["linkCount"], json!(2));
        assert_eq!(node(&project.list(&json!({ "preview": 5 })), "n3")["textPreview"], json!("The q"));
        assert!(node(&project.list(&json!({ "preview": 0 })), "n3").get("textPreview").is_none());
    }

    #[test]
    fn links_leave_out_default_kind_and_shape() {
        let links = project().links(&json!({}));
        assert_eq!(links["links"][0], json!({ "id": "l1", "from": "n0", "to": "n1", "fromName": "Node 0", "toName": "Node 1" }));
        assert_eq!(links["links"][1]["kind"], json!("weak"));
        assert_eq!(links["links"][1]["shape"], json!("wave"));
    }

    #[test]
    fn object_ids_cover_every_collection() {
        let ids = project().object_ids();
        for id in ["n0", "n59", "l1", "z1", "t1"] {
            assert!(ids.contains(&id.to_string()), "{id}");
        }
    }
}
