use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use notify::{
    event::{ModifyKind, RenameMode},
    EventKind, RecursiveMode,
};
use notify_debouncer_full::{new_debouncer, DebounceEventResult, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

type DebouncerHandle = Debouncer<notify::RecommendedWatcher, RecommendedCache>;

const DEBOUNCE_DELAY: Duration = Duration::from_millis(200);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Fingerprint {
    size: u64,
    hash: u64,
}

#[derive(Debug)]
struct PendingWrite {
    fingerprint: Fingerprint,
}

struct WatcherState {
    app: AppHandle,
    notes_directory: Mutex<Option<PathBuf>>,
    known_contents: Mutex<HashMap<String, Fingerprint>>,
    observed_contents: Mutex<HashMap<String, Option<Fingerprint>>>,
    pending_writes: Mutex<HashMap<String, PendingWrite>>,
    debouncer: Mutex<Option<DebouncerHandle>>,
}

#[derive(Clone)]
pub struct ProjectWatcher {
    state: Arc<WatcherState>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFileEvent {
    kind: &'static str,
    file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    old_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    read_error: Option<String>,
}

impl ProjectWatcher {
    pub fn new(app: AppHandle) -> Self {
        let state = Arc::new_cyclic(|weak| {
            let callback_state = weak.clone();
            let debouncer = match new_debouncer(DEBOUNCE_DELAY, None, move |result| {
                handle_events(&callback_state, result)
            }) {
                Ok(debouncer) => Some(debouncer),
                Err(error) => {
                    eprintln!("Could not start project file monitoring: {error}");
                    None
                }
            };

            WatcherState {
                app: app.clone(),
                notes_directory: Mutex::new(None),
                known_contents: Mutex::new(HashMap::new()),
                observed_contents: Mutex::new(HashMap::new()),
                pending_writes: Mutex::new(HashMap::new()),
                debouncer: Mutex::new(debouncer),
            }
        });

        Self { state }
    }

    /// Replace the active project watch. The notes directory is watched
    /// non-recursively; changing projects releases the previous root first.
    pub fn watch_notes(&self, directory: &Path) -> Result<(), String> {
        let directory = fs::canonicalize(directory).map_err(|error| {
            format!("could not resolve notes directory for monitoring: {error}")
        })?;
        if !directory.is_dir() {
            return Err("notes path for monitoring is not a directory".to_string());
        }

        let previous = self
            .state
            .notes_directory
            .lock()
            .map_err(|_| "project watcher state is unavailable")?
            .clone();
        let has_debouncer = self
            .state
            .debouncer
            .lock()
            .map_err(|_| "project watcher is unavailable")?
            .is_some();
        if previous.as_deref() == Some(directory.as_path()) && has_debouncer {
            return Ok(());
        }

        if let Some(previous) = previous {
            if let Some(debouncer) = self
                .state
                .debouncer
                .lock()
                .map_err(|_| "project watcher is unavailable")?
                .as_mut()
            {
                debouncer.unwatch(&previous).map_err(|error| {
                    format!("could not stop monitoring the previous project: {error}")
                })?;
            }
        }

        let initial_contents = read_directory_fingerprints(&directory);
        *self
            .state
            .known_contents
            .lock()
            .map_err(|_| "project watcher state is unavailable")? = initial_contents;
        self.state
            .observed_contents
            .lock()
            .map_err(|_| "project watcher state is unavailable")?
            .clear();
        self.state
            .pending_writes
            .lock()
            .map_err(|_| "project watcher state is unavailable")?
            .clear();
        *self
            .state
            .notes_directory
            .lock()
            .map_err(|_| "project watcher state is unavailable")? = Some(directory.clone());

        if let Some(debouncer) = self
            .state
            .debouncer
            .lock()
            .map_err(|_| "project watcher is unavailable")?
            .as_mut()
        {
            if let Err(error) = debouncer.watch(&directory, RecursiveMode::NonRecursive) {
                *self
                    .state
                    .notes_directory
                    .lock()
                    .map_err(|_| "project watcher state is unavailable")? = None;
                self.state
                    .known_contents
                    .lock()
                    .map_err(|_| "project watcher state is unavailable")?
                    .clear();
                return Err(format!("could not monitor notes directory: {error}"));
            }
        } else {
            *self
                .state
                .notes_directory
                .lock()
                .map_err(|_| "project watcher state is unavailable")? = None;
            self.state
                .known_contents
                .lock()
                .map_err(|_| "project watcher state is unavailable")?
                .clear();
            return Err("file monitoring could not be initialized".to_string());
        }
        Ok(())
    }

    /// Register the intended bytes before Hive's atomic write starts. A
    /// matching notification is suppressed by content equality, never time.
    pub fn begin_write(&self, path: &Path, bytes: &[u8]) {
        self.state
            .pending_writes
            .lock()
            .expect("project watcher pending writes poisoned")
            .insert(
                path_key(path),
                PendingWrite {
                    fingerprint: content_fingerprint(bytes),
                },
            );
    }

    /// End the pending write and update the known fingerprint only after a
    /// successful write. On failure, the previous read/write baseline remains.
    pub fn finish_write(&self, path: &Path, succeeded: bool) {
        self.state
            .pending_writes
            .lock()
            .expect("project watcher pending writes poisoned")
            .remove(&path_key(path));

        if !succeeded {
            return;
        }
        if let Ok(bytes) = fs::read(path) {
            let key = path_key(path);
            self.state
                .known_contents
                .lock()
                .expect("project watcher known contents poisoned")
                .insert(key.clone(), content_fingerprint(&bytes));
            self.state
                .observed_contents
                .lock()
                .expect("project watcher observed contents poisoned")
                .remove(&key);
        }
    }

    /// Refuse a write if the file changed after Hive's last read or write.
    /// This closes the debounce window where a real external edit could be
    /// overwritten before its watcher event reaches the frontend.
    pub fn verify_current_content(&self, path: &Path) -> Result<(), String> {
        let watched_directory = self
            .state
            .notes_directory
            .lock()
            .map_err(|_| "project watcher root poisoned")?
            .clone();
        if !watched_directory.as_deref().is_some_and(|directory| {
            path.parent()
                .is_some_and(|parent| path_key(parent) == path_key(directory))
        }) {
            return Ok(());
        }

        let bytes = match fs::read(path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(format!("could not verify note before saving: {error}"));
            }
        };
        let current = bytes.as_deref().map(content_fingerprint);
        let key = path_key(path);
        let known = self
            .state
            .known_contents
            .lock()
            .map_err(|_| "project watcher known contents poisoned")?
            .get(&key)
            .copied();
        let pending = self
            .state
            .pending_writes
            .lock()
            .map_err(|_| "project watcher pending writes poisoned")?
            .get(&key)
            .map(|write| write.fingerprint);
        if current == known || current.is_some() && current == pending {
            return Ok(());
        }

        handle_path_event(
            &self.state,
            path,
            if current.is_some() {
                "modified"
            } else {
                "deleted"
            },
        );
        Err(format!(
            "note file changed outside Hive and was not overwritten: {}",
            path.file_name()
                .map(|name| name.to_string_lossy())
                .unwrap_or_default()
        ))
    }

    /// Accept an external event after the frontend has reloaded or preserved
    /// it. The file must still match the event before its fingerprint is
    /// promoted to Hive's known baseline.
    pub fn acknowledge_external_change(&self, path: &Path, expected: Option<&[u8]>) -> bool {
        let bytes = match fs::read(path) {
            Ok(bytes) => Some(bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return false,
        };
        let expected = expected.map(content_fingerprint);
        let current = bytes.as_deref().map(content_fingerprint);
        if current != expected {
            return false;
        }

        let key = path_key(path);
        let mut known = self
            .state
            .known_contents
            .lock()
            .expect("project watcher known contents poisoned");
        if let Some(fingerprint) = current {
            known.insert(key.clone(), fingerprint);
        } else {
            known.remove(&key);
        }
        drop(known);
        self.state
            .observed_contents
            .lock()
            .expect("project watcher observed contents poisoned")
            .remove(&key);
        true
    }
}

fn handle_events(state: &Weak<WatcherState>, result: DebounceEventResult) {
    let Some(state) = state.upgrade() else {
        return;
    };
    let events = match result {
        Ok(events) => events,
        Err(errors) => {
            for error in errors {
                eprintln!("Project file monitoring error: {error}");
            }
            return;
        }
    };

    let mut rename_from = Vec::new();
    let mut rename_to = Vec::new();
    for event in events {
        let paths = event
            .paths
            .iter()
            .filter(|path| is_markdown(path) && is_in_notes_directory(&state, path))
            .cloned()
            .collect::<Vec<_>>();
        if paths.is_empty() {
            continue;
        }

        if let EventKind::Modify(ModifyKind::Name(mode)) = event.kind {
            match mode {
                RenameMode::Both if paths.len() >= 2 => {
                    handle_rename(&state, &paths[0], &paths[1]);
                }
                RenameMode::From => rename_from.extend(paths),
                RenameMode::To => rename_to.extend(paths),
                RenameMode::Any => {
                    for path in paths {
                        if path.exists() {
                            rename_to.push(path);
                        } else {
                            rename_from.push(path);
                        }
                    }
                }
                _ => {
                    for path in paths {
                        handle_path_event(
                            &state,
                            &path,
                            if path.exists() { "modified" } else { "deleted" },
                        );
                    }
                }
            }
            continue;
        }

        let kind = match event.kind {
            EventKind::Create(_) => "created",
            EventKind::Remove(_) => "deleted",
            EventKind::Modify(_) => "modified",
            _ => continue,
        };
        for path in paths {
            handle_path_event(&state, &path, kind);
        }
    }

    let paired_count = rename_from.len().min(rename_to.len());
    for index in 0..paired_count {
        handle_rename(&state, &rename_from[index], &rename_to[index]);
    }
    for path in rename_from.into_iter().skip(paired_count) {
        handle_path_event(&state, &path, "deleted");
    }
    for path in rename_to.into_iter().skip(paired_count) {
        handle_path_event(&state, &path, "created");
    }
}

fn handle_path_event(state: &WatcherState, path: &Path, hinted_kind: &str) {
    match fs::read(path) {
        Ok(bytes) => {
            let fingerprint = content_fingerprint(&bytes);
            let key = path_key(path);
            let pending = state
                .pending_writes
                .lock()
                .expect("project watcher pending writes poisoned")
                .get(&key)
                .map(|write| write.fingerprint);
            let known = state
                .known_contents
                .lock()
                .expect("project watcher known contents poisoned")
                .get(&key)
                .copied();
            let observed = state
                .observed_contents
                .lock()
                .expect("project watcher observed contents poisoned")
                .get(&key)
                .copied();
            if should_suppress_content(fingerprint, known, observed, pending) {
                if pending == Some(fingerprint) {
                    state
                        .known_contents
                        .lock()
                        .expect("project watcher known contents poisoned")
                        .insert(key.clone(), fingerprint);
                    state
                        .observed_contents
                        .lock()
                        .expect("project watcher observed contents poisoned")
                        .remove(&key);
                } else if known == Some(fingerprint) {
                    state
                        .observed_contents
                        .lock()
                        .expect("project watcher observed contents poisoned")
                        .remove(&key);
                }
                return;
            }

            state
                .observed_contents
                .lock()
                .expect("project watcher observed contents poisoned")
                .insert(key, Some(fingerprint));
            let kind = if hinted_kind == "created" || known.is_none() {
                "created"
            } else {
                "modified"
            };
            let (text, read_error) = match String::from_utf8(bytes) {
                Ok(text) => (Some(text), None),
                Err(error) => (None, Some(format!("note is not valid UTF-8: {error}"))),
            };
            emit(
                state,
                ProjectFileEvent {
                    kind,
                    file: file_name(path),
                    old_file: None,
                    text,
                    read_error,
                },
            );
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let key = path_key(path);
            let pending = state
                .pending_writes
                .lock()
                .expect("project watcher pending writes poisoned")
                .contains_key(&key);
            if pending {
                return;
            }
            let was_known = state
                .known_contents
                .lock()
                .expect("project watcher known contents poisoned")
                .contains_key(&key);
            let observed = state
                .observed_contents
                .lock()
                .expect("project watcher observed contents poisoned")
                .get(&key)
                .copied();
            if observed == Some(None) {
                return;
            }
            state
                .observed_contents
                .lock()
                .expect("project watcher observed contents poisoned")
                .insert(key, None);
            if was_known || observed.is_some() || hinted_kind == "deleted" {
                emit(
                    state,
                    ProjectFileEvent {
                        kind: "deleted",
                        file: file_name(path),
                        old_file: None,
                        text: None,
                        read_error: None,
                    },
                );
            }
        }
        Err(error) => {
            eprintln!("Could not read changed note {}: {error}", path.display());
        }
    }
}

fn handle_rename(state: &WatcherState, first: &Path, second: &Path) {
    let (old_path, new_path) = match (first.exists(), second.exists()) {
        (false, true) => (first, second),
        (true, false) => (second, first),
        _ => (first, second),
    };
    let old_key = path_key(old_path);
    let new_key = path_key(new_path);
    let old_known = state
        .known_contents
        .lock()
        .expect("project watcher known contents poisoned")
        .get(&old_key)
        .copied();

    let read = fs::read(new_path);
    let (fingerprint, text, read_error) = match read {
        Ok(bytes) => {
            let fingerprint = content_fingerprint(&bytes);
            let (text, read_error) = match String::from_utf8(bytes) {
                Ok(text) => (Some(text), None),
                Err(error) => (None, Some(format!("note is not valid UTF-8: {error}"))),
            };
            (Some(fingerprint), text, read_error)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (None, None, None),
        Err(error) => {
            eprintln!(
                "Could not read renamed note {}: {error}",
                new_path.display()
            );
            (None, None, Some(error.to_string()))
        }
    };
    let pending = state
        .pending_writes
        .lock()
        .expect("project watcher pending writes poisoned")
        .get(&new_key)
        .map(|write| write.fingerprint);
    if let Some(fingerprint) = fingerprint {
        if pending == Some(fingerprint) {
            state
                .known_contents
                .lock()
                .expect("project watcher known contents poisoned")
                .remove(&old_key);
            state
                .known_contents
                .lock()
                .expect("project watcher known contents poisoned")
                .insert(new_key.clone(), fingerprint);
            let mut observed = state
                .observed_contents
                .lock()
                .expect("project watcher observed contents poisoned");
            observed.remove(&old_key);
            observed.remove(&new_key);
            return;
        }
    }

    let mut observed = state
        .observed_contents
        .lock()
        .expect("project watcher observed contents poisoned");
    observed.insert(old_key, None);
    if let Some(fingerprint) = fingerprint {
        observed.insert(new_key, Some(fingerprint));
    }
    drop(observed);

    // A paired .md rename is distinct from an unrelated new file. The client
    // checks the old tracked path for deletion and treats the new file as an
    // external change only if its basename is already tracked.
    if old_known.is_some() || fingerprint.is_some() {
        emit(
            state,
            ProjectFileEvent {
                kind: "renamed",
                file: file_name(new_path),
                old_file: Some(file_name(old_path)),
                text,
                read_error,
            },
        );
    }
}

fn emit(state: &WatcherState, event: ProjectFileEvent) {
    if let Err(error) = state.app.emit("project-file-event", event) {
        eprintln!("Could not notify the frontend about a project file change: {error}");
    }
}

fn is_in_notes_directory(state: &WatcherState, path: &Path) -> bool {
    let Some(notes_directory) = state
        .notes_directory
        .lock()
        .expect("project watcher root poisoned")
        .as_ref()
        .cloned()
    else {
        return false;
    };
    path.parent()
        .is_some_and(|parent| path_key(parent) == path_key(&notes_directory))
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("md"))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn read_directory_fingerprints(directory: &Path) -> HashMap<String, Fingerprint> {
    let mut contents = HashMap::new();
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            eprintln!(
                "Could not read notes directory {}: {error}",
                directory.display()
            );
            return contents;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !is_markdown(&path) || !entry.file_type().is_ok_and(|file_type| file_type.is_file()) {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            contents.insert(path_key(&path), content_fingerprint(&bytes));
        }
    }
    contents
}

fn path_key(path: &Path) -> String {
    let normalized = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let key = normalized.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    {
        key.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        key
    }
}

fn content_fingerprint(bytes: &[u8]) -> Fingerprint {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Fingerprint {
        size: bytes.len() as u64,
        hash,
    }
}

fn should_suppress_content(
    current: Fingerprint,
    known: Option<Fingerprint>,
    observed: Option<Option<Fingerprint>>,
    pending_write: Option<Fingerprint>,
) -> bool {
    known == Some(current) || observed == Some(Some(current)) || pending_write == Some(current)
}

#[cfg(test)]
mod tests {
    use super::{content_fingerprint, should_suppress_content};

    #[test]
    fn content_fingerprint_is_stable_and_changes_with_content() {
        assert_eq!(content_fingerprint(b"same"), content_fingerprint(b"same"));
        assert_ne!(
            content_fingerprint(b"same"),
            content_fingerprint(b"different")
        );
    }

    #[test]
    fn suppresses_known_and_pending_content_but_not_a_real_external_edit() {
        let old = content_fingerprint(b"old");
        let hive_write = content_fingerprint(b"saved by hive");
        let external = content_fingerprint(b"external edit");

        assert!(should_suppress_content(
            old,
            Some(old),
            None,
            Some(hive_write)
        ));
        assert!(should_suppress_content(
            hive_write,
            Some(old),
            None,
            Some(hive_write)
        ));
        assert!(should_suppress_content(
            external,
            Some(old),
            Some(Some(external)),
            None
        ));
        assert!(!should_suppress_content(
            external,
            Some(old),
            None,
            Some(hive_write)
        ));
    }
}
