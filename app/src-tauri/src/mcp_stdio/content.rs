//! Turning hive's node content into MCP content blocks, plus the read-only file fallback.

use super::client::HiveError;
use super::offline::OfflineProject;
use super::youtube::{self, YouTubeInfo};
use base64::Engine;
use serde_json::{json, Map, Value};
use std::fs;

pub fn text_block(text: impl Into<String>) -> Value {
    json!({ "type": "text", "text": text.into() })
}

fn image_block(data: &str, mime: &str) -> Value {
    json!({ "type": "image", "data": data, "mimeType": mime })
}

fn is_image_payload(value: &Value) -> bool {
    value.get("data").is_some_and(Value::is_string) && value.get("mime").is_some_and(Value::is_string)
}

/// hive's NodeContent JSON → one JSON text block (images replaced by a short placeholder), then the
/// images, each preceded by a caption so the model knows which picture is which.
pub fn content_to_blocks(content: &Value, label: &str) -> Vec<Value> {
    let mut images: Vec<(String, Value)> = Vec::new();
    let stripped = strip_images(content, "", label, &mut images);
    let mut blocks = vec![text_block(format!("{label}\n{}", pretty(&stripped)))];
    for (index, (caption, payload)) in images.iter().enumerate() {
        blocks.push(text_block(format!("Image #{}: {caption}", index + 1)));
        blocks.push(image_block(
            payload.get("data").and_then(Value::as_str).unwrap_or(""),
            payload.get("mime").and_then(Value::as_str).unwrap_or("image/png"),
        ));
    }
    blocks
}

fn strip_images(value: &Value, path: &str, label: &str, images: &mut Vec<(String, Value)>) -> Value {
    if is_image_payload(value) {
        let file = value.get("file").and_then(Value::as_str);
        let caption = format!("{label} — {path}{}", file.map(|file| format!(" ({file})")).unwrap_or_default());
        images.push((caption, value.clone()));
        return json!({
            "image": format!("#{} below", images.len()),
            "file": value.get("file"),
            "width": value.get("width"),
            "height": value.get("height"),
            "originalWidth": value.get("originalWidth"),
            "originalHeight": value.get("originalHeight"),
        });
    }
    match value {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .enumerate()
                .map(|(index, item)| strip_images(item, &format!("{path}[{index}]"), label, images))
                .collect(),
        ),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| {
                    let child = if path.is_empty() { key.clone() } else { format!("{path}.{key}") };
                    (key.clone(), strip_images(item, &child, label, images))
                })
                .collect(),
        ),
        other => other.clone(),
    }
}

pub fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

/// YouTube video ids mentioned anywhere in a node's content.
pub fn youtube_ids_in(content: &Value) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    let mut add = |id: Option<String>| {
        if let Some(id) = id {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    };
    add(content.pointer("/youtube/videoId").and_then(Value::as_str).map(str::to_string));
    if let Some(links) = content.get("links").and_then(Value::as_array) {
        for link in links {
            let id = link
                .get("videoId")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| link.get("url").and_then(Value::as_str).and_then(youtube::video_id));
            add(id);
        }
    }
    if let Some(text) = content.get("text").and_then(Value::as_str) {
        for url in urls_in(text) {
            add(youtube::video_id(&url));
        }
    }
    ids
}

/// http(s) URLs in free text, ending at whitespace, `)`, `>` or `]`.
fn urls_in(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("http") {
        let candidate = &rest[start..];
        if candidate.starts_with("http://") || candidate.starts_with("https://") {
            let end = candidate
                .find(|c: char| c.is_whitespace() || c == ')' || c == '>' || c == ']')
                .unwrap_or(candidate.len());
            found.push(candidate[..end].to_string());
            rest = &candidate[end..];
        } else {
            rest = &candidate[4..];
        }
    }
    found
}

pub fn youtube_to_blocks(info: &YouTubeInfo, with_thumbnail: bool) -> Vec<Value> {
    let mut blocks = vec![text_block(format!("YouTube {}\n{}", info.video_id, pretty(&info.to_json())))];
    if with_thumbnail {
        if let Some(thumbnail) = &info.thumbnail {
            let title = info.title.as_ref().map(|title| format!(" \"{title}\"")).unwrap_or_default();
            blocks.push(text_block(format!("Thumbnail of YouTube {}{title}", info.video_id)));
            blocks.push(image_block(thumbnail, "image/jpeg"));
        }
    }
    blocks
}

pub fn youtube_blocks_for(ids: &[String], transcript: bool) -> Vec<Value> {
    let selected: Vec<&String> = ids.iter().take(5).collect();
    let results: Vec<Vec<Value>> = std::thread::scope(|scope| {
        let handles: Vec<_> = selected
            .iter()
            .map(|id| {
                scope.spawn(move || match youtube::read(id, transcript, None, true) {
                    Ok(info) => youtube_to_blocks(&info, true),
                    Err(error) => vec![text_block(format!("YouTube {id}: {}", error.message))],
                })
            })
            .collect();
        handles.into_iter().map(|handle| handle.join().unwrap_or_default()).collect()
    });
    let mut blocks: Vec<Value> = results.into_iter().flatten().collect();
    if ids.len() > 5 {
        blocks.push(text_block(format!("{} more YouTube links not expanded; use read_youtube for them.", ids.len() - 5)));
    }
    blocks
}

// ---------- read-only fallback while hive is closed ----------

const MAX_OFFLINE_IMAGE_BYTES: u64 = 3 * 1024 * 1024;
const TEXT_EXT: &[&str] = &[
    "txt", "md", "json", "csv", "tsv", "js", "ts", "tsx", "jsx", "py", "rs", "cs", "java", "c", "cpp", "h", "html", "css",
    "xml", "yaml", "yml", "toml", "ini", "sql", "sh", "ps1", "lua", "go", "kt", "swift", "rb", "php", "log",
];

fn image_mime(ext: &str) -> Option<&'static str> {
    match ext {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

fn offline_file(project: &OfflineProject, file: &str, max_text_chars: usize) -> Map<String, Value> {
    let mut out = Map::new();
    if file.contains('/') || file.contains('\\') {
        out.insert("note".into(), json!("unsafe file name"));
        return out;
    }
    let full = project.root.join("attachments").join(file);
    let ext = full.extension().map(|ext| ext.to_string_lossy().to_lowercase()).unwrap_or_default();
    let Ok(meta) = fs::metadata(&full) else {
        out.insert("file".into(), json!(file));
        out.insert("missing".into(), json!(true));
        return out;
    };
    if let Some(mime) = image_mime(&ext) {
        if meta.len() > MAX_OFFLINE_IMAGE_BYTES {
            out.insert("file".into(), json!(file));
            out.insert("note".into(), json!("Image too large to send while hive is closed; start hive for a downscaled copy."));
            return out;
        }
        match fs::read(&full) {
            Ok(bytes) => {
                let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                out.insert("image".into(), json!({ "file": file, "mime": mime, "data": data }));
            }
            Err(_) => {
                out.insert("file".into(), json!(file));
                out.insert("missing".into(), json!(true));
            }
        }
        return out;
    }
    if TEXT_EXT.contains(&ext.as_str()) {
        let text = fs::read_to_string(&full).unwrap_or_default();
        let truncated = text.chars().count() > max_text_chars;
        out.insert("file".into(), json!({ "name": file, "size": meta.len() }));
        out.insert("content".into(), json!(text.chars().take(max_text_chars).collect::<String>()));
        out.insert("truncated".into(), json!(truncated));
        return out;
    }
    out.insert("file".into(), json!({ "name": file, "size": meta.len() }));
    out.insert("note".into(), json!("Binary file; start hive to read PDFs and media details."));
    out
}

pub fn offline_content(project: &OfflineProject, id: &str, max_text_chars: usize) -> Result<Value, HiveError> {
    let note = project.find(id).ok_or_else(|| HiveError::new("not_found", format!("Node '{id}' not found.")))?;
    let text = project.text_of(note);
    let mut result = Map::new();
    result.insert("id".into(), json!(id));
    result.insert("type".into(), note.get("type").cloned().unwrap_or_else(|| json!("note")));
    result.insert("name".into(), note.get("name").cloned().unwrap_or(Value::Null));
    result.insert("text".into(), json!(text));
    result.insert("offline".into(), json!(true));
    if let Some(file) = note.get("image").and_then(|image| image.get("file")).and_then(Value::as_str) {
        result.extend(offline_file(project, file, max_text_chars));
    }
    if let Some(media) = note.get("media") {
        result.insert("media".into(), media.clone());
        if let Some(file) = media.get("file").and_then(Value::as_str) {
            result.extend(offline_file(project, file, max_text_chars));
        }
    }
    if let Some(source) = note.get("source") {
        result.insert("source".into(), source.clone());
        if let Some(file) = source.get("file").and_then(Value::as_str) {
            result.extend(offline_file(project, file, max_text_chars));
        }
    }
    if let Some(youtube) = note.get("youtube") {
        result.insert("youtube".into(), youtube.clone());
    }
    let mut inline = Vec::new();
    for file in inline_attachments(&text).into_iter().take(10) {
        let entry = offline_file(project, &file, max_text_chars);
        if let Some(image) = entry.get("image") {
            inline.push(image.clone());
        }
    }
    if !inline.is_empty() {
        result.insert("inlineImages".into(), Value::Array(inline));
    }
    const SKIP: &[&str] = &["id", "type", "name", "file", "text", "x", "y", "width", "height", "image", "media", "source", "youtube"];
    let data: Map<String, Value> =
        note.iter().filter(|(key, _)| !SKIP.contains(&key.as_str())).map(|(key, value)| (key.clone(), value.clone())).collect();
    if !data.is_empty() {
        result.insert("data".into(), Value::Object(data));
    }
    Ok(Value::Object(result))
}

/// `![alt](att:<file>)` inline pictures in note text.
fn inline_attachments(text: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("![") {
        let after = &rest[start + 2..];
        let Some(close) = after.find(']') else { break };
        if after[..close].contains('\n') {
            rest = &after[close..];
            continue;
        }
        let tail = &after[close + 1..];
        if let Some(target) = tail.strip_prefix("(att:") {
            if let Some(end) = target.find(')') {
                let raw = &target[..end];
                files.push(percent_encoding::percent_decode_str(raw).decode_utf8_lossy().to_string());
                rest = &target[end..];
                continue;
            }
        }
        rest = tail;
    }
    files
}
