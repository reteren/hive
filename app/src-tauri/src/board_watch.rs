//! Picks up board and drawing changes made outside hive — typically a Git pull in GitHub Desktop —
//! and hands them to the open window, which merges them into the live board.
//!
//! Own writes are told apart by content: a save updates the synced board document
//! (board_store::set_synced) and the drawing records the bytes it is about to write.

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

type DebouncerHandle = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

const DEBOUNCE_DELAY: Duration = Duration::from_millis(400);

struct Watch {
    root: PathBuf,
    _debouncer: DebouncerHandle,
}

static WATCH: Mutex<Option<Watch>> = Mutex::new(None);
/// Drawing tile file name → content hash, as this app last wrote or loaded it.
static DRAWING_KNOWN: Mutex<Option<(PathBuf, HashMap<String, u64>)>> = Mutex::new(None);

/// Watch `root` (recursively) for board and drawing files changed by someone else.
pub fn watch(app: &AppHandle, root: &Path) -> Result<(), String> {
    let mut slot = WATCH.lock().map_err(|_| "board watcher is unavailable")?;
    if slot.as_ref().is_some_and(|watch| watch.root == root) {
        return Ok(());
    }
    *slot = None;
    let callback_app = app.clone();
    let callback_root = root.to_path_buf();
    let mut debouncer = new_debouncer(DEBOUNCE_DELAY, None, move |result: DebounceEventResult| {
        handle(&callback_app, &callback_root, result);
    })
    .map_err(|error| format!("could not start board monitoring: {error}"))?;
    debouncer
        .watch(root, RecursiveMode::Recursive)
        .map_err(|error| format!("could not monitor the project folder: {error}"))?;
    *slot = Some(Watch {
        root: root.to_path_buf(),
        _debouncer: debouncer,
    });
    reset_drawing(root);
    Ok(())
}

/// Remember the drawing tiles as they are on disk now (after a load).
pub fn reset_drawing(root: &Path) {
    let tiles = tiles_directory(root);
    if let Ok(mut known) = DRAWING_KNOWN.lock() {
        *known = Some((root.to_path_buf(), scan_tiles(&tiles)));
    }
}

/// Record a tile this app is about to write (`Some`) or delete (`None`).
pub fn record_drawing_write(root: &Path, file_name: &str, bytes: Option<&[u8]>) {
    if let Ok(mut known) = DRAWING_KNOWN.lock() {
        if known
            .as_ref()
            .map_or(true, |(known_root, _)| known_root != root)
        {
            *known = Some((root.to_path_buf(), HashMap::new()));
        }
        if let Some((_, map)) = known.as_mut() {
            match bytes {
                Some(bytes) => {
                    map.insert(file_name.to_string(), hash(bytes));
                }
                None => {
                    map.remove(file_name);
                }
            }
        }
    }
    crate::backup::mark_project_changed(root);
}

fn handle(app: &AppHandle, root: &Path, result: DebounceEventResult) {
    let Ok(events) = result else { return };
    let tiles = tiles_directory(root);
    let mut board_paths = HashSet::new();
    let mut drawing_paths = HashSet::new();
    for event in &events {
        for path in &event.paths {
            if path.starts_with(root.join(".hive")) || path.starts_with(root.join(".git")) {
                continue;
            }
            if crate::board_store::is_board_path(root, path) {
                board_paths.insert(path.clone());
            }
            if path.starts_with(&tiles)
                && path.extension().and_then(|extension| extension.to_str()) == Some("png")
            {
                drawing_paths.insert(path.clone());
            }
        }
    }
    if !board_paths.is_empty() {
        check_board(app, root, &board_paths);
    }
    if !drawing_paths.is_empty() {
        check_drawing(app, root, &drawing_paths);
    }
}

fn check_board(app: &AppHandle, root: &Path, paths: &HashSet<PathBuf>) {
    if paths
        .iter()
        .all(|path| crate::board_store::is_synced_path_current(root, path))
    {
        return;
    }
    let Ok(_store) = crate::board_store::STORE_LOCK.lock() else {
        return;
    };
    crate::backup::mark_project_changed(root);
    match crate::project::external_board_change(root) {
        Ok(Some(payload)) => {
            if let Err(error) = app.emit("project-board-changed", payload) {
                eprintln!("Could not report a board change: {error}");
            }
        }
        Ok(None) => {}
        // A half-finished pull or a file with merge markers: report it, keep the board as it is.
        Err(error) => {
            let _ = app.emit("project-board-change-failed", error);
        }
    }
}

fn check_drawing(app: &AppHandle, root: &Path, paths: &HashSet<PathBuf>) {
    let changed = {
        let Ok(mut known) = DRAWING_KNOWN.lock() else {
            return;
        };
        if known
            .as_ref()
            .map_or(true, |(known_root, _)| known_root != root)
        {
            *known = Some((root.to_path_buf(), HashMap::new()));
        }
        let Some((_, map)) = known.as_mut() else {
            return;
        };
        let mut changed = false;
        for path in paths {
            let Some(name) = path
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
            else {
                continue;
            };
            let current = fs::read(path).ok().map(|bytes| hash(&bytes));
            match current {
                Some(fingerprint) if map.get(&name) != Some(&fingerprint) => {
                    map.insert(name, fingerprint);
                    changed = true;
                }
                None if map.remove(&name).is_some() => changed = true,
                _ => {}
            }
        }
        changed
    };
    if changed {
        crate::backup::mark_project_changed(root);
        if let Err(error) = app.emit("project-drawing-changed", ()) {
            eprintln!("Could not report a drawing change: {error}");
        }
    }
}

fn tiles_directory(root: &Path) -> PathBuf {
    root.join("drawing").join("tiles")
}

fn scan_tiles(tiles: &Path) -> HashMap<String, u64> {
    let mut map = HashMap::new();
    let Ok(entries) = fs::read_dir(tiles) else {
        return map;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".png") {
            continue;
        }
        if let Ok(bytes) = fs::read(entry.path()) {
            map.insert(name, hash(&bytes));
        }
    }
    map
}

fn hash(bytes: &[u8]) -> u64 {
    let mut value = 0xcbf29ce484222325_u64;
    for byte in bytes {
        value ^= u64::from(*byte);
        value = value.wrapping_mul(0x100000001b3);
    }
    value
}
