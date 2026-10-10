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
const MAX_VERSION_BYTES: usize = 512 * 1024;

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

/// One version of a node: its saved data and text before and after a commit, for a readable
/// "what changed" in the Info window.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeVersion {
    before_node: Option<String>,
    after_node: Option<String>,
    before_text: Option<String>,
    after_text: Option<String>,
    /// Before this commit the node lived in the old single-file board.json (not a new node).
    before_legacy: bool,
}

#[tauri::command]
pub async fn node_commit_versions(
    state: State<'_, ProjectState>,
    hash: String,
    id: String,
    file: Option<String>,
) -> Result<NodeVersion, String> {
    let root = active_project_root(&state)?;
    validate_name(&id)?;
    if let Some(file) = &file {
        validate_name(file)?;
    }
    if hash.is_empty() || !hash.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("invalid commit".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let parent = format!("{hash}^");
        let after_node = show(&root, &hash, &format!("nodes/{id}.json"));
        let before_node = show(&root, &parent, &format!("nodes/{id}.json"));
        // The note file is named after the node, so each side reads the name it had then.
        let text_of = |revision: &str, node: &Option<String>| {
            let name = node
                .as_deref()
                .and_then(|json| serde_json::from_str::<serde_json::Value>(json).ok())
                .and_then(|value| value.get("file").and_then(|file| file.as_str()).map(str::to_string))
                .or_else(|| file.clone())?;
            validate_name(&name).ok()?;
            show(&root, revision, &format!("notes/{name}"))
        };
        let before_legacy = before_node.is_none()
            && show(&root, &parent, "board.json").is_some_and(|board| board.contains(&format!("\"{id}\"")));
        NodeVersion {
            before_text: text_of(&parent, &before_node),
            after_text: text_of(&hash, &after_node),
            before_node,
            after_node,
            before_legacy,
        }
    })
    .await
    .map_err(|error| error.to_string())
}

/// A file's content at a revision, or None when it did not exist there.
fn show(root: &Path, revision: &str, path: &str) -> Option<String> {
    let content = git(root, &["show", &format!("{revision}:{path}")])?;
    (content.len() <= MAX_VERSION_BYTES).then_some(content)
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
/// `-M -C -C`: text moved or copied from another note (a split or rename) keeps its author. Git
/// scores such copies by ASCII letters only, so lines in Cyrillic are traced by `copied_from`.
fn blame_authors(root: &Path, path: &str, me: &str) -> Vec<(String, u64)> {
    let Some(blame) = git(root, &["blame", "-w", "-M", "-C", "-C", "--line-porcelain", "--", path]) else {
        return Vec::new();
    };
    let mut totals: HashMap<String, u64> = HashMap::new();
    let mut touches_other_notes: HashMap<String, bool> = HashMap::new();
    let mut lookups = 0;
    let mut commit = String::new();
    let mut author = String::new();
    for line in blame.lines() {
        if let Some(name) = line.strip_prefix("author ") {
            author = if name == "Not Committed Yet" { me.to_string() } else { name.to_string() };
        } else if let Some(content) = line.strip_prefix('\t') {
            let mut credited = author.clone();
            let committed = !commit.is_empty() && !commit.chars().all(|character| character == '0');
            if committed && content.trim().chars().count() >= MIN_TRACED_LINE && lookups < MAX_TRACED_LINES {
                let several = *touches_other_notes
                    .entry(commit.clone())
                    .or_insert_with(|| changed_note_files(root, &commit) > 1);
                if several {
                    lookups += 1;
                    if let Some(original) = copied_from(root, &commit, content, 3) {
                        credited = original;
                    }
                }
            }
            *totals.entry(credited).or_default() += content.chars().count() as u64;
        } else if let Some(hash) = line.split(' ').next().filter(|word| word.len() == 40 && word.chars().all(|c| c.is_ascii_hexdigit())) {
            commit = hash.to_string();
        }
    }
    let mut sorted: Vec<_> = totals.into_iter().filter(|(_, chars)| *chars > 0).collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    sorted
}

const MIN_TRACED_LINE: usize = 12;
const MAX_TRACED_LINES: usize = 80;

fn changed_note_files(root: &Path, commit: &str) -> usize {
    git(root, &["diff-tree", "--no-commit-id", "--name-only", "-r", commit, "--", "notes"])
        .map_or(0, |names| names.lines().count())
}

/// The author of `content` when the commit only moved it from another note: the same line in a
/// note just before the commit, followed back up to `depth` moves.
fn copied_from(root: &Path, commit: &str, content: &str, depth: u8) -> Option<String> {
    let parent = format!("{commit}^");
    let found = git(root, &["grep", "-F", "-x", "-n", "--no-color", "-e", content, &parent, "--", "notes"])?;
    let first = found.lines().next()?.strip_prefix(&format!("{parent}:"))?;
    let marker = first.find(".md:")?;
    let path = &first[..marker + 3];
    let line_number: usize = first[marker + 4..].split(':').next()?.parse().ok()?;
    let range = format!("{line_number},{line_number}");
    let blame = git(root, &["blame", "-w", "--line-porcelain", "-L", &range, &parent, "--", path])?;
    let original_commit = blame.split(' ').next()?.to_string();
    let author = blame.lines().find_map(|line| line.strip_prefix("author "))?.to_string();
    if depth > 1 && changed_note_files(root, &original_commit) > 1 {
        if let Some(earlier) = copied_from(root, &original_commit, content, depth - 1) {
            return Some(earlier);
        }
    }
    Some(author)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn run(root: &Path, args: &[&str]) {
        let status = Command::new("git").arg("-C").arg(root).args(args).status().expect("git runs");
        assert!(status.success(), "git {args:?}");
    }

    #[test]
    fn text_moved_to_another_note_keeps_its_author_even_in_cyrillic() {
        let root = std::env::temp_dir().join(format!("hive-node-info-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("notes")).unwrap();
        run(&root, &["init", "-q"]);
        let line = "прокачка игрока проходит по средствам установки скилов";
        fs::write(root.join("notes/Note 4.md"), format!("{line}\nеба откуда такая модель\n")).unwrap();
        run(&root, &["add", "-A"]);
        run(&root, &["-c", "user.name=Friend", "-c", "user.email=f@x", "commit", "-qm", "friend"]);
        fs::write(root.join("notes/Note 4.md"), "еба откуда такая модель\n").unwrap();
        fs::write(root.join("notes/Note 4 2.md"), format!("{line}\n")).unwrap();
        run(&root, &["add", "-A"]);
        run(&root, &["-c", "user.name=Me", "-c", "user.email=m@x", "commit", "-qm", "split"]);

        let authors = blame_authors(&root, "notes/Note 4 2.md", "Me");
        assert_eq!(authors, vec![("Friend".to_string(), line.chars().count() as u64)]);
        let _ = fs::remove_dir_all(&root);
    }
}
