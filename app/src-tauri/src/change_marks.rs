//! Per-user memory of what this person has already seen in a project, for the "new" / "changed"
//! marks on nodes that arrived from outside (a Git pull, a synced folder, another Windows user).
//! It lives in this user's app config folder, never in the project, so every person and every
//! Windows account keeps their own. The file is keyed by the project path the window passes, so
//! a save still lands in the right project while another one is being opened.

use crate::project::{active_project_root, ProjectState};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

const MAX_SEEN_BYTES: usize = 8 * 1024 * 1024;
const MAX_AUTHOR_LOOKUPS: usize = 60;

#[tauri::command]
pub fn load_seen_state(app: AppHandle, project_path: String) -> Result<Option<String>, String> {
    let path = seen_path(&app, Path::new(&project_path))?;
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read the seen-changes file: {error}")),
    }
}

#[tauri::command]
pub fn save_seen_state(app: AppHandle, project_path: String, contents: String) -> Result<(), String> {
    if contents.len() > MAX_SEEN_BYTES {
        return Err("seen-changes data is too large".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|error| format!("seen-changes data must be JSON: {error}"))?;
    let path = seen_path(&app, Path::new(&project_path))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents.as_bytes()).map_err(|error| format!("could not save seen changes: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("could not save seen changes: {error}"))
}

/// Who last committed each node (node id → author), for Git projects only. Authors equal to this
/// computer's own Git user are left out: those changes are not someone else's.
#[tauri::command]
pub async fn change_authors(
    state: State<'_, ProjectState>,
    nodes: Vec<(String, String)>,
) -> Result<HashMap<String, String>, String> {
    let root = active_project_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || authors(&root, &nodes))
        .await
        .map_err(|error| error.to_string())
}

fn authors(root: &Path, nodes: &[(String, String)]) -> HashMap<String, String> {
    let mut found = HashMap::new();
    if !root.join(".git").exists() {
        return found;
    }
    let me = git(root, &["config", "user.name"]).unwrap_or_default();
    for (id, file) in nodes.iter().take(MAX_AUTHOR_LOOKUPS) {
        if id.contains(['/', '\\']) || file.contains(['/', '\\']) || file.contains("..") {
            continue;
        }
        let node_file = format!("nodes/{id}.json");
        let note_file = format!("notes/{file}");
        let Some(author) = git(root, &["log", "-1", "--format=%an", "--", &node_file, &note_file]) else {
            continue;
        };
        if !author.is_empty() && author != me {
            found.insert(id.clone(), author);
        }
    }
    found
}

pub(crate) fn git(root: &Path, args: &[&str]) -> Option<String> {
    let mut command = std::process::Command::new("git");
    // Readable (not octal-escaped) non-ASCII file names in diffs and logs.
    command.arg("-C").arg(root).args(["-c", "core.quotepath=false"]).args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up for every lookup.
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn seen_path(app: &AppHandle, root: &Path) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("could not resolve the app config directory: {error}"))?;
    let key = root.to_string_lossy().to_lowercase();
    Ok(directory.join("seen").join(format!("{:016x}.json", fnv64(key.as_bytes()))))
}

fn fnv64(bytes: &[u8]) -> u64 {
    let mut value = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        value ^= u64::from(*byte);
        value = value.wrapping_mul(0x0100_0000_01b3);
    }
    value
}
