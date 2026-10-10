//! Data for a node's Info window: file sizes on disk, and for Git projects who created and last
//! changed it, its version log, a per-version diff and who wrote how much of its text.

use crate::change_marks::git;
use crate::project::{active_project_root, ProjectState};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

const MAX_LOG_ENTRIES: &str = "200";
const MAX_DIFF_BYTES: usize = 200 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    node_file: String,
    node_bytes: Option<u64>,
    note_file: Option<String>,
    note_bytes: Option<u64>,
    attachment_bytes: u64,
    git: Option<GitInfo>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    me: String,
    /// The node has changes that are not committed yet.
    uncommitted: bool,
    /// Newest first.
    commits: Vec<Commit>,
    /// Author → characters of the current text last written by them.
    text_authors: Vec<(String, u64)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    hash: String,
    author: String,
    /// Unix seconds.
    at: i64,
    subject: String,
}

#[tauri::command]
pub async fn node_info(
    state: State<'_, ProjectState>,
    id: String,
    file: Option<String>,
    attachments: Vec<String>,
) -> Result<NodeInfo, String> {
    let root = active_project_root(&state)?;
    validate_name(&id)?;
    if let Some(file) = &file {
        validate_name(file)?;
    }
    for attachment in &attachments {
        validate_name(attachment)?;
    }
    tauri::async_runtime::spawn_blocking(move || collect(&root, &id, file.as_deref(), &attachments))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn node_commit_diff(
    state: State<'_, ProjectState>,
    hash: String,
    id: String,
    file: Option<String>,
) -> Result<String, String> {
    let root = active_project_root(&state)?;
    validate_name(&id)?;
    if let Some(file) = &file {
        validate_name(file)?;
    }
    if hash.is_empty() || !hash.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("invalid commit".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let paths = node_paths(&id, file.as_deref());
        let mut args = vec!["show", "--no-color", "--format=", hash.as_str(), "--"];
        args.extend(paths.iter().map(String::as_str));
        let mut diff = git(&root, &args).unwrap_or_default();
        if diff.len() > MAX_DIFF_BYTES {
            let mut cut = MAX_DIFF_BYTES;
            while !diff.is_char_boundary(cut) {
                cut -= 1;
            }
            diff.truncate(cut);
            diff.push_str("\n… (truncated)");
        }
        diff
    })
    .await
    .map_err(|error| error.to_string())
}

/// Open Explorer with the node's file selected (`notes/<file>` or `nodes/<id>.json`).
#[tauri::command]
pub fn reveal_node_file(app: AppHandle, state: State<'_, ProjectState>, relative: String) -> Result<(), String> {
    let root = active_project_root(&state)?;
    let path = project_file(&root, &relative)?;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|error| format!("could not show the file in Explorer: {error}"))
}

fn collect(root: &Path, id: &str, file: Option<&str>, attachments: &[String]) -> NodeInfo {
    let node_file = format!("nodes/{id}.json");
    let note_file = file.map(|file| format!("notes/{file}"));
    let attachment_bytes = attachments
        .iter()
        .filter_map(|name| size(&root.join("attachments").join(name)))
        .sum();
    NodeInfo {
        node_bytes: size(&root.join(&node_file)),
        note_bytes: note_file.as_ref().and_then(|path| size(&root.join(path))),
        node_file,
        note_file,
        attachment_bytes,
        git: git_info(root, id, file),
    }
}

fn git_info(root: &Path, id: &str, file: Option<&str>) -> Option<GitInfo> {
    if !root.join(".git").exists() {
        return None;
    }
    let paths = node_paths(id, file);
    let mut log_args = vec!["log", "-n", MAX_LOG_ENTRIES, "--format=%H%x1f%an%x1f%at%x1f%s", "--"];
    log_args.extend(paths.iter().map(String::as_str));
    let log = git(root, &log_args)?;
    let commits = log
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\u{1f}');
            Some(Commit {
                hash: parts.next()?.to_string(),
                author: parts.next()?.to_string(),
                at: parts.next()?.parse().ok()?,
                subject: parts.next().unwrap_or_default().to_string(),
            })
        })
        .collect();
    let mut status_args = vec!["status", "--porcelain", "--"];
    status_args.extend(paths.iter().map(String::as_str));
    let uncommitted = git(root, &status_args).is_some_and(|status| !status.is_empty());
    let me = git(root, &["config", "user.name"]).unwrap_or_default();
    let text_authors = file
        .map(|file| blame_authors(root, &format!("notes/{file}"), &me))
        .unwrap_or_default();
    Some(GitInfo { me, uncommitted, commits, text_authors })
}

/// Characters of the current text per author, from `git blame` (uncommitted lines count as yours).
/// `-w`: a commit that only changed line endings or spacing does not take over the lines.
fn blame_authors(root: &Path, path: &str, me: &str) -> Vec<(String, u64)> {
    let Some(blame) = git(root, &["blame", "-w", "--line-porcelain", "--", path]) else {
        return Vec::new();
    };
    let mut totals: HashMap<String, u64> = HashMap::new();
    let mut author = String::new();
    for line in blame.lines() {
        if let Some(name) = line.strip_prefix("author ") {
            author = if name == "Not Committed Yet" { me.to_string() } else { name.to_string() };
        } else if let Some(content) = line.strip_prefix('\t') {
            *totals.entry(author.clone()).or_default() += content.chars().count() as u64;
        }
    }
    let mut sorted: Vec<_> = totals.into_iter().filter(|(_, chars)| *chars > 0).collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    sorted
}

fn node_paths(id: &str, file: Option<&str>) -> Vec<String> {
    let mut paths = vec![format!("nodes/{id}.json")];
    if let Some(file) = file {
        paths.push(format!("notes/{file}"));
    }
    paths
}

fn size(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().filter(|meta| meta.is_file()).map(|meta| meta.len())
}

fn validate_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains(['/', '\\', '\0']) || name == "." || name == ".." {
        return Err(format!("invalid file name: {name}"));
    }
    Ok(())
}

fn project_file(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let (folder, name) = relative.split_once('/').ok_or("invalid project file")?;
    if !matches!(folder, "nodes" | "notes" | "attachments") {
        return Err("invalid project file".to_string());
    }
    validate_name(name)?;
    let path = root.join(folder).join(name);
    if !path.is_file() {
        return Err(format!("{relative} does not exist yet; it is written on the next save"));
    }
    Ok(path)
}
