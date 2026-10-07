use crate::watcher::ProjectWatcher;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

const INDEX_FILE_NAME: &str = "board.json";
const NOTES_DIRECTORY: &str = "notes";
const LAST_PROJECT_FILE_NAME: &str = "last-project.json";
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Default)]
pub struct ProjectState {
    root: Mutex<Option<PathBuf>>,
}

pub(crate) fn active_project_root(state: &ProjectState) -> Result<PathBuf, String> {
    state
        .root
        .lock()
        .map_err(|_| "project state is unavailable")?
        .clone()
        .ok_or_else(|| "no project is open".to_string())
}

/// The board index from disk (single-file or split layout) plus warnings for skipped object files.
fn load_index(root: &Path) -> Result<(BoardIndex, Vec<String>), String> {
    let (document, warnings) = crate::board_store::read_document(root)?;
    let mut index: BoardIndex = serde_json::from_value(document)
        .map_err(|error| format!("{INDEX_FILE_NAME} is invalid: {error}"))?;
    migrate_index(&mut index)?;
    validate_index(&index)?;
    Ok((index, warnings))
}

pub(crate) fn validate_project_index_contents(contents: &[u8]) -> Result<usize, String> {
    let mut index: BoardIndex = serde_json::from_slice(contents)
        .map_err(|error| format!("board.json is invalid: {error}"))?;
    migrate_index(&mut index)?;
    validate_index(&index)?;
    Ok(index.notes.len())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardIndex {
    #[serde(default)]
    version: u32,
    notes: Vec<BoardNote>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BoardNote {
    id: String,
    name: String,
    #[serde(default)]
    file: String,
    x: f64,
    y: f64,
    width: f64,
    #[serde(default)]
    height: Option<f64>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectNote {
    id: String,
    name: String,
    file: String,
    text: String,
    x: f64,
    y: f64,
    width: f64,
    height: Option<f64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLoad {
    path: String,
    name: String,
    index_json: String,
    notes: Vec<ProjectNote>,
    warnings: Vec<String>,
    missing_files: Vec<String>,
    /// Board revision the window starts from; saves send it back (see board_store::REVISION).
    revision: u64,
}

/// The board as it is on disk after someone else changed it (a Git pull), for the open window.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BoardChange {
    index_json: String,
    notes: Vec<ProjectNote>,
    warnings: Vec<String>,
    missing_files: Vec<String>,
    revision: u64,
}

/// `Some` when the board files differ from what this app last loaded or saved.
pub(crate) fn external_board_change(root: &Path) -> Result<Option<BoardChange>, String> {
    let (index, mut warnings) = load_index(root)?;
    let document = serde_json::to_value(&index).map_err(|error| format!("could not encode the board: {error}"))?;
    if crate::board_store::synced(root).as_ref() == Some(&document) {
        return Ok(None);
    }
    crate::board_store::set_synced(root, &document);
    let revision = crate::board_store::bump_revision();
    let notes_directory = ensure_notes_directory(root)?;
    let (notes, note_warnings, missing_files) = read_note_texts(&notes_directory, &index)?;
    warnings.extend(note_warnings);
    let index_json = serde_json::to_string(&index).map_err(|error| format!("could not encode the board: {error}"))?;
    Ok(Some(BoardChange { index_json, notes, warnings, missing_files, revision }))
}

/// Read every note's Markdown; a missing file opens as empty and is reported.
fn read_note_texts(notes_directory: &Path, index: &BoardIndex) -> Result<(Vec<ProjectNote>, Vec<String>, Vec<String>), String> {
    let mut notes = Vec::with_capacity(index.notes.len());
    let mut warnings = Vec::new();
    let mut missing_files = Vec::new();
    for entry in &index.notes {
        let path = safe_note_path(notes_directory, &entry.file)?;
        let text = match read_note_file(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                warnings.push(format!("Missing note file: {} (opened as empty)", entry.file));
                missing_files.push(entry.file.clone());
                String::new()
            }
            Err(error) => return Err(format!("could not read note file {}: {error}", entry.file)),
        };
        notes.push(ProjectNote {
            id: entry.id.clone(),
            name: entry.name.clone(),
            file: entry.file.clone(),
            text,
            x: entry.x,
            y: entry.y,
            width: entry.width,
            height: entry.height,
        });
    }
    Ok((notes, warnings, missing_files))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    file: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    index_json: String,
    changed_files: Vec<ChangedFile>,
    /// Board revision the window's state is based on; None skips the check (older callers).
    #[serde(default)]
    base_revision: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    warnings: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictCopyRequest {
    file: String,
    kind: String,
    timestamp: String,
    text: String,
}

struct StagedWrite {
    temporary: PathBuf,
    target: PathBuf,
    previous: Option<Vec<u8>>,
}

struct PendingWatchWrites {
    watcher: ProjectWatcher,
    paths: Vec<PathBuf>,
    finished: bool,
}

impl PendingWatchWrites {
    fn new(watcher: ProjectWatcher) -> Self {
        Self {
            watcher,
            paths: Vec::new(),
            finished: false,
        }
    }

    fn begin(&mut self, path: &Path, contents: &[u8]) {
        self.watcher.begin_write(path, contents);
        self.paths.push(path.to_path_buf());
    }

    fn finish(&mut self, succeeded: bool) {
        for path in &self.paths {
            self.watcher.finish_write(path, succeeded);
        }
        self.finished = true;
    }
}

impl Drop for PendingWatchWrites {
    fn drop(&mut self) {
        if !self.finished {
            self.finish(false);
        }
    }
}

impl Drop for StagedWrite {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.temporary);
    }
}

#[tauri::command]
pub fn initialize_project(
    app: AppHandle,
    state: State<'_, ProjectState>,
    watcher: State<'_, ProjectWatcher>,
) -> Result<ProjectLoad, String> {
    let mut startup_warning = None;
    let remembered = last_project_path(&app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str::<String>(&contents).ok())
        .map(PathBuf::from);

    if let Some(path) = remembered {
        if path.is_dir() {
            match open_project_root(&path) {
                Ok(project) => {
                    remember_project(&app, &project.root)?;
                    *state
                        .root
                        .lock()
                        .map_err(|_| "project state is unavailable")? = Some(project.root.clone());
                    crate::mcp_bridge::project_changed(&app, &project.root);
                    let mut project = project;
                    enable_project_watch(&app, &watcher, &mut project);
                    return Ok(project.load);
                }
                Err(error) => {
                    startup_warning = Some(format!(
                    "Could not open the last project; opened the default project instead: {error}"
                ))
                }
            }
        } else {
            startup_warning = Some(
                "The last project folder is unavailable; opened the default project instead."
                    .to_string(),
            );
        }
    }

    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("could not resolve the Documents directory: {error}"))?;
    let default_root = documents.join("hive").join("Main");
    fs::create_dir_all(&default_root)
        .map_err(|error| format!("could not create the default project folder: {error}"))?;
    let index_path = default_root.join(INDEX_FILE_NAME);
    ensure_regular_or_missing(&index_path)?;
    if !index_path.exists() {
        atomic_write(&index_path, br#"{"version":1,"notes":[]}"#)
            .map_err(|error| format!("could not create the default project index: {error}"))?;
    }
    let mut project = open_project_root(&default_root)?;
    if let Some(warning) = startup_warning {
        project.load.warnings.push(warning);
    }
    remember_project(&app, &project.root)?;
    *state
        .root
        .lock()
        .map_err(|_| "project state is unavailable")? = Some(project.root.clone());
    crate::mcp_bridge::project_changed(&app, &project.root);
    enable_project_watch(&app, &watcher, &mut project);
    Ok(project.load)
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    state: State<'_, ProjectState>,
    watcher: State<'_, ProjectWatcher>,
    path: String,
) -> Result<ProjectLoad, String> {
    let selected = PathBuf::from(path);
    fs::create_dir_all(&selected)
        .map_err(|error| format!("could not create project folder: {error}"))?;
    let root = canonical_project_root(&selected)?;
    let index_path = root.join(INDEX_FILE_NAME);
    if index_path.exists() {
        return Err("a project already exists in that folder".to_string());
    }
    ensure_regular_or_missing(&index_path)?;
    ensure_notes_directory(&root)?;
    atomic_write(&index_path, br#"{"version":1,"notes":[]}"#)
        .map_err(|error| format!("could not create project index: {error}"))?;

    let project = open_project_root(&root)?;
    remember_project(&app, &project.root)?;
    *state
        .root
        .lock()
        .map_err(|_| "project state is unavailable")? = Some(project.root.clone());
    crate::mcp_bridge::project_changed(&app, &project.root);
    let mut project = project;
    enable_project_watch(&app, &watcher, &mut project);
    Ok(project.load)
}

#[tauri::command]
pub fn open_project(
    app: AppHandle,
    state: State<'_, ProjectState>,
    watcher: State<'_, ProjectWatcher>,
    path: String,
) -> Result<ProjectLoad, String> {
    let mut project = open_project_root(Path::new(&path))?;
    remember_project(&app, &project.root)?;
    *state
        .root
        .lock()
        .map_err(|_| "project state is unavailable")? = Some(project.root.clone());
    crate::mcp_bridge::project_changed(&app, &project.root);
    enable_project_watch(&app, &watcher, &mut project);
    Ok(project.load)
}

#[tauri::command]
pub fn save_project(
    state: State<'_, ProjectState>,
    watcher: State<'_, ProjectWatcher>,
    request: SaveRequest,
) -> Result<SaveResult, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "project state is unavailable")?
        .clone()
        .ok_or_else(|| "no project is open".to_string())?;
    save_project_files(&root, request, &watcher)
}

#[tauri::command]
pub fn write_conflict_copy(
    state: State<'_, ProjectState>,
    watcher: State<'_, ProjectWatcher>,
    request: ConflictCopyRequest,
) -> Result<String, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "project state is unavailable")?
        .clone()
        .ok_or_else(|| "no project is open".to_string())?;
    validate_note_file(&request.file)?;
    if request.kind != "external" && request.kind != "local" {
        return Err("conflict copy kind must be external or local".to_string());
    }
    if !is_conflict_timestamp(&request.timestamp) {
        return Err("conflict copy timestamp is invalid".to_string());
    }

    let notes_directory = ensure_notes_directory(&root)?;
    let (index, _) = load_index(&root)?;
    let tracked_files = index
        .notes
        .iter()
        .map(|note| windows_case_key(&note.file))
        .collect::<HashSet<_>>();
    let base = &request.file[..request.file.len() - 3];
    for collision in 1..=1_000 {
        let file = conflict_copy_file_name(base, &request.kind, &request.timestamp, collision);
        validate_note_file(&file)?;
        if tracked_files.contains(&windows_case_key(&file)) {
            continue;
        }
        let path = safe_note_path(&notes_directory, &file)?;
        let bytes = request.text.as_bytes();
        watcher.begin_write(&path, bytes);
        match atomic_create(&path, bytes) {
            Ok(()) => {
                watcher.finish_write(&path, true);
                return Ok(file);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                watcher.finish_write(&path, false);
            }
            Err(error) => {
                watcher.finish_write(&path, false);
                return Err(format!(
                    "could not save {} conflict copy: {error}",
                    request.kind
                ));
            }
        }
    }
    Err("could not choose a unique conflict copy name".to_string())
}

#[tauri::command]
pub fn acknowledge_external_file_change(
    state: State<'_, ProjectState>,
    watcher: State<'_, ProjectWatcher>,
    file: String,
    text: Option<String>,
) -> Result<bool, String> {
    let root = state
        .root
        .lock()
        .map_err(|_| "project state is unavailable")?
        .clone()
        .ok_or_else(|| "no project is open".to_string())?;
    validate_note_file(&file)?;
    let notes_directory = ensure_notes_directory(&root)?;
    let path = safe_note_path(&notes_directory, &file)?;
    Ok(watcher.acknowledge_external_change(&path, text.as_deref().map(str::as_bytes)))
}

fn enable_project_watch(app: &AppHandle, watcher: &ProjectWatcher, project: &mut OpenedProject) {
    if let Err(error) = crate::attachments::refresh_asset_protocol_scope(app, &project.root) {
        project.load.warnings.push(format!("Project images may not load: {error}"));
    }
    if let Err(error) = crate::board_watch::watch(app, &project.root) {
        project.load.warnings.push(format!("Changes from Git pulls will appear after reopening the project: {error}"));
    }
    let notes_directory = project.root.join(NOTES_DIRECTORY);
    if let Err(error) = watcher.watch_notes(&notes_directory) {
        project
            .load
            .warnings
            .push(format!("External note monitoring is unavailable: {error}"));
    }
}

fn is_conflict_timestamp(timestamp: &str) -> bool {
    let bytes = timestamp.as_bytes();
    bytes.len() == 15
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
        && bytes[10] == b' '
        && bytes[11..15].iter().all(u8::is_ascii_digit)
}

fn conflict_copy_file_name(base: &str, kind: &str, timestamp: &str, collision: usize) -> String {
    let collision_suffix = if collision == 1 {
        String::new()
    } else {
        format!(" {collision}")
    };
    let suffix = format!(" ({kind} {timestamp}){collision_suffix}");
    let available_units = 120usize.saturating_sub(suffix.encode_utf16().count());
    let shortened_base = truncate_utf16(base, available_units)
        .trim_end_matches(['.', ' '])
        .to_string();
    format!("{shortened_base}{suffix}.md")
}

struct OpenedProject {
    root: PathBuf,
    load: ProjectLoad,
}

fn open_project_root(selected: &Path) -> Result<OpenedProject, String> {
    let root = canonical_project_root(selected)?;
    let index_path = root.join(INDEX_FILE_NAME);
    ensure_regular_or_missing(&index_path)?;
    crate::attachments::migrate_attachments(&root)?;
    // One-time move to the Git-friendly layout (one file per object); a safety copy comes first.
    if crate::board_store::is_legacy(&root)? {
        let (legacy, _) = load_index(&root)?;
        if !legacy.notes.is_empty() {
            crate::backup::create_backup_before_migration(&root)?;
        }
        crate::board_store::migrate_to_split(&root)?;
    }
    crate::board_store::ensure_gitignore(&root);
    let (index, mut warnings) = load_index(&root)?;
    let notes_directory = ensure_notes_directory(&root)?;
    if let Ok(document) = serde_json::to_value(&index) {
        crate::board_store::set_synced(&root, &document);
    }

    let (notes, note_warnings, missing_files) = read_note_texts(&notes_directory, &index)?;
    warnings.extend(note_warnings);

    let index_json = serde_json::to_string(&index)
        .map_err(|error| format!("could not encode migrated {INDEX_FILE_NAME}: {error}"))?;
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Project")
        .to_string();
    Ok(OpenedProject {
        load: ProjectLoad {
            path: root.to_string_lossy().into_owned(),
            name,
            index_json,
            notes,
            warnings,
            missing_files,
            revision: crate::board_store::revision(),
        },
        root,
    })
}

fn validate_index(index: &BoardIndex) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut files = HashSet::new();
    for note in &index.notes {
        if note.id.trim().is_empty()
            || note.id.len() > 200
            || note.id.contains('/')
            || note.id.contains('\\')
        {
            return Err("board index contains an unsafe note id".to_string());
        }
        if note.name.trim().is_empty() || note.name.encode_utf16().count() > 500 {
            return Err(format!("note {} has an invalid name", note.id));
        }
        if !note.x.is_finite()
            || !note.y.is_finite()
            || !note.width.is_finite()
            || note.width <= 0.0
            || note
                .height
                .is_some_and(|height| !height.is_finite() || height <= 0.0)
        {
            return Err(format!("note {} has invalid geometry", note.id));
        }
        validate_note_file(&note.file)?;
        if !ids.insert(note.id.as_str()) {
            return Err(format!(
                "board index contains duplicate note id: {}",
                note.id
            ));
        }
        if !files.insert(windows_case_key(&note.file)) {
            return Err(format!(
                "board index contains colliding note file: {}",
                note.file
            ));
        }
    }
    Ok(())
}

fn migrate_index(index: &mut BoardIndex) -> Result<(), String> {
    for note in &mut index.notes {
        if note.file.is_empty() {
            note.file = format!("{}.md", sanitize_note_name(&note.name));
        }
    }
    // Rust only needs note identity and safe Markdown paths. Preserve known and
    // future index versions plus flattened JSON fields through open/save cycles.
    if index.version == 0 {
        index.version = 1;
    }
    Ok(())
}

fn sanitize_note_name(name: &str) -> String {
    let mut safe = name
        .chars()
        .map(|character| {
            if character.is_control() || "<>:\"/\\|?*".contains(character) {
                '_'
            } else {
                character
            }
        })
        .collect::<String>();
    safe = safe.trim_end_matches(['.', ' ']).to_string();
    safe = truncate_utf16(&safe, 120)
        .trim_end_matches(['.', ' '])
        .to_string();
    if safe.is_empty() || safe == "." || safe == ".." {
        return "Note".to_string();
    }
    if is_reserved_windows_name(&safe) {
        if let Some((stem, extension)) = safe.split_once('.') {
            safe = format!("{stem}_{extension}");
        } else {
            safe.push('_');
        }
        safe = truncate_utf16(&safe, 120)
            .trim_end_matches(['.', ' '])
            .to_string();
    }
    safe
}

fn truncate_utf16(value: &str, max_units: usize) -> String {
    let mut result = String::new();
    let mut used_units = 0;
    for character in value.chars() {
        let units = character.len_utf16();
        if used_units + units > max_units {
            break;
        }
        result.push(character);
        used_units += units;
    }
    result
}

fn save_project_files(
    root: &Path,
    request: SaveRequest,
    watcher: &ProjectWatcher,
) -> Result<SaveResult, String> {
    let root = canonical_project_root(root)?;
    let _store = crate::board_store::STORE_LOCK.lock().map_err(|_| "project storage is busy")?;
    let notes_directory = ensure_notes_directory(&root)?;
    let mut pending_watch_writes = PendingWatchWrites::new(watcher.clone());
    let index_path = root.join(INDEX_FILE_NAME);
    ensure_regular_or_missing(&index_path)?;
    // Compare with what this app last loaded or saved, not with the disk: objects that arrived
    // from a pull are not ours to delete or to treat as renamed.
    if request.base_revision.is_some_and(|revision| revision != crate::board_store::revision()) {
        return Err(crate::board_store::STALE_SAVE_ERROR.to_string());
    }
    let known_document = crate::board_store::synced(&root);
    let mut old_index: BoardIndex = match &known_document {
        Some(document) => serde_json::from_value(document.clone())
            .map_err(|error| format!("current board index is invalid: {error}"))?,
        None => load_index(&root)?.0,
    };
    migrate_index(&mut old_index)?;
    validate_index(&old_index)?;
    let mut new_index: BoardIndex = serde_json::from_str(&request.index_json)
        .map_err(|error| format!("new board index is invalid: {error}"))?;
    migrate_index(&mut new_index)?;
    validate_index(&new_index)?;

    let old_by_id: HashMap<&str, &BoardNote> = old_index
        .notes
        .iter()
        .map(|note| (note.id.as_str(), note))
        .collect();
    let new_by_id: HashMap<&str, &BoardNote> = new_index
        .notes
        .iter()
        .map(|note| (note.id.as_str(), note))
        .collect();
    let mut changed_by_file = HashMap::new();
    for changed in request.changed_files {
        validate_note_file(&changed.file)?;
        if changed_by_file
            .insert(changed.file.clone(), changed.text)
            .is_some()
        {
            return Err(format!("duplicate changed note file: {}", changed.file));
        }
    }
    for file in changed_by_file.keys() {
        if !new_index.notes.iter().any(|note| note.file == *file) {
            return Err(format!(
                "changed note file is absent from the board index: {file}"
            ));
        }
    }

    let mut warnings = Vec::new();
    let mut staged = Vec::new();
    let mut targets = HashSet::new();
    for note in &new_index.notes {
        let target = safe_note_path(&notes_directory, &note.file)?;
        let target_key = windows_case_key(&note.file);
        if !targets.insert(target_key) {
            return Err(format!("duplicate target note file: {}", note.file));
        }
        let old = old_by_id.get(note.id.as_str()).copied();
        let is_rename = old.is_some_and(|previous| previous.file != note.file);
        let is_new = old.is_none();
        if (is_rename || is_new) && path_exists(&target)? {
            return Err(format!(
                "note file already exists and will not be overwritten: {}",
                note.file
            ));
        }

        let content = if let Some(text) = changed_by_file.remove(&note.file) {
            Some(text.into_bytes())
        } else if let Some(previous) = old.filter(|previous| previous.file != note.file) {
            let old_path = safe_note_path(&notes_directory, &previous.file)?;
            match read_note_bytes(&old_path) {
                Ok(bytes) => Some(bytes),
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    warnings.push(format!(
                        "Missing note file: {} (saved as empty)",
                        previous.file
                    ));
                    Some(Vec::new())
                }
                Err(error) => {
                    return Err(format!(
                        "could not read note file {}: {error}",
                        previous.file
                    ))
                }
            }
        } else if is_new {
            Some(Vec::new())
        } else {
            None
        };

        if let Some(bytes) = content {
            pending_watch_writes.begin(&target, &bytes);
            stage_or_cleanup(&mut staged, &target, &bytes)?;
        } else {
            ensure_regular_or_missing(&target)?;
        }
    }
    if let Some(file) = changed_by_file.keys().next() {
        return Err(format!(
            "changed note file is not a safe index target: {file}"
        ));
    }

    let mut removed_files = Vec::new();
    for previous in &old_index.notes {
        if !new_by_id.contains_key(previous.id.as_str()) {
            let source = safe_note_path(&notes_directory, &previous.file)?;
            if path_exists(&source)? {
                let archived = match archive_removed_note(&root, previous, &source) {
                    Ok(archived) => archived,
                    Err(error) => {
                        cleanup_staged(&staged);
                        return Err(error);
                    }
                };
                removed_files.push((source, archived));
            } else {
                warnings.push(format!(
                    "Missing note file: {} (nothing to archive)",
                    previous.file
                ));
            }
        } else if new_by_id[previous.id.as_str()].file != previous.file {
            let source = safe_note_path(&notes_directory, &previous.file)?;
            if path_exists(&source)? {
                removed_files.push((source, PathBuf::new()));
            } else {
                warnings.push(format!(
                    "Missing note file: {} (renamed as empty)",
                    previous.file
                ));
            }
        }
    }

    let new_document = match serde_json::to_value(&new_index) {
        Ok(document) => document,
        Err(error) => {
            cleanup_staged(&staged);
            return Err(format!("could not encode board index: {error}"));
        }
    };
    let board_plan = match crate::board_store::plan_write(&root, &new_document, known_document.as_ref()) {
        Ok(plan) => plan,
        Err(error) => {
            cleanup_staged(&staged);
            return Err(error);
        }
    };

    for write in &staged {
        if write.target.parent() == Some(notes_directory.as_path()) {
            if let Err(error) = watcher.verify_current_content(&write.target) {
                cleanup_staged(&staged);
                return Err(error);
            }
        }
    }
    for (source, _) in &removed_files {
        if let Err(error) = watcher.verify_current_content(source) {
            cleanup_staged(&staged);
            return Err(error);
        }
    }

    let mut committed = Vec::new();
    for write in &staged {
        if let Err(error) = replace_staged_file(&write.temporary, &write.target) {
            let rollback_errors = rollback_writes(&committed);
            cleanup_staged(&staged);
            let detail = if rollback_errors.is_empty() {
                String::new()
            } else {
                format!("; rollback also failed: {}", rollback_errors.join("; "))
            };
            return Err(format!(
                "could not save project file {}: {error}{detail}",
                write.target.display()
            ));
        }
        committed.push(write);
    }

    for (source, _archive) in removed_files {
        if let Err(error) = fs::remove_file(&source) {
            warnings.push(format!(
                "Saved project, but could not remove old note file {}: {error}",
                source.display()
            ));
        } else {
            watcher.acknowledge_external_change(&source, None);
        }
    }

    pending_watch_writes.finish(true);
    if let Err(error) = crate::board_store::apply_plan(&board_plan) {
        return Err(format!("note files were saved, but the board could not be: {error}"));
    }
    crate::board_store::set_synced(&root, &new_document);
    Ok(SaveResult { warnings })
}

fn archive_removed_note(root: &Path, note: &BoardNote, source: &Path) -> Result<PathBuf, String> {
    let metadata_directory = root.join(".hive");
    ensure_directory_not_symlink(&metadata_directory)?;
    let removed_directory = metadata_directory.join("removed");
    ensure_directory_not_symlink(&removed_directory)?;
    let original = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Note.md");
    let id = note
        .id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    for suffix in 0..1000 {
        let suffix = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let destination = removed_directory.join(format!("{id}-{original}{suffix}"));
        if path_exists(&destination)? {
            continue;
        }
        let contents = read_note_bytes(source)
            .map_err(|error| format!("could not archive removed note {}: {error}", note.file))?;
        atomic_create(&destination, &contents)
            .map_err(|error| format!("could not archive removed note {}: {error}", note.file))?;
        return Ok(destination);
    }
    Err(format!(
        "could not choose an archive name for removed note {}",
        note.file
    ))
}

fn canonical_project_root(path: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(path)
        .map_err(|error| format!("could not open project folder: {error}"))?;
    if !root.is_dir() {
        return Err("project path is not a folder".to_string());
    }
    Ok(root)
}

fn ensure_notes_directory(root: &Path) -> Result<PathBuf, String> {
    let notes = root.join(NOTES_DIRECTORY);
    ensure_directory_not_symlink(&notes)?;
    let canonical_notes = fs::canonicalize(&notes)
        .map_err(|error| format!("could not resolve notes directory: {error}"))?;
    if !canonical_notes.starts_with(root) {
        return Err("notes directory resolves outside the project folder".to_string());
    }
    Ok(canonical_notes)
}

fn ensure_directory_not_symlink(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "refusing to use a symbolic link as a project directory: {}",
            path.display()
        )),
        Ok(metadata) if !metadata.is_dir() => Err(format!(
            "project path is not a directory: {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|error| {
                format!(
                    "could not create project directory {}: {error}",
                    path.display()
                )
            })
        }
        Err(error) => Err(format!(
            "could not inspect project directory {}: {error}",
            path.display()
        )),
    }
}

fn ensure_regular_or_missing(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "refusing to use a symbolic link as a project file: {}",
            path.display()
        )),
        Ok(metadata) if !metadata.is_file() => Err(format!(
            "project path is not a regular file: {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "could not inspect project file {}: {error}",
            path.display()
        )),
    }
}

fn safe_note_path(notes_directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    validate_note_file(file_name)?;
    let path = notes_directory.join(file_name);
    if !path.starts_with(notes_directory) {
        return Err("note file path escapes the notes directory".to_string());
    }
    ensure_regular_or_missing(&path)?;
    Ok(path)
}

fn validate_note_file(file_name: &str) -> Result<(), String> {
    let path = Path::new(file_name);
    let mut components = path.components();
    if !matches!(components.next(), Some(Component::Normal(_))) || components.next().is_some() {
        return Err(format!("unsafe note file path: {file_name}"));
    }
    if file_name.contains('/')
        || file_name.contains('\\')
        || !file_name.to_ascii_lowercase().ends_with(".md")
    {
        return Err(format!("unsafe note file path: {file_name}"));
    }
    let stem = &file_name[..file_name.len() - 3];
    if stem.is_empty()
        || stem.encode_utf16().count() > 120
        || stem.ends_with('.')
        || stem.ends_with(' ')
        || stem
            .chars()
            .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
        || is_reserved_windows_name(stem)
    {
        return Err(format!("unsafe Windows note filename: {file_name}"));
    }
    Ok(())
}

fn is_reserved_windows_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|number| {
            matches!(
                number,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    })
}

fn windows_case_key(value: &str) -> String {
    value.to_lowercase()
}

fn read_note_file(path: &Path) -> io::Result<String> {
    String::from_utf8(read_note_bytes(path)?)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

fn read_note_bytes(path: &Path) -> io::Result<Vec<u8>> {
    ensure_regular_or_missing(path)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    fs::read(path)
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "refusing to use a symbolic link as a project file: {}",
            path.display()
        )),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "could not inspect project file {}: {error}",
            path.display()
        )),
    }
}

fn stage_write(target: &Path, contents: &[u8]) -> Result<StagedWrite, String> {
    ensure_regular_or_missing(target)?;
    let parent = target
        .parent()
        .ok_or_else(|| "project file has no parent directory".to_string())?;
    let previous = match fs::read(target) {
        Ok(contents) => Some(contents),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("could not back up {}: {error}", target.display())),
    };
    let temporary = temporary_path(
        parent,
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("project-file"),
    );
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("could not create temporary project file: {error}"))?;
    let result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(format!("could not write temporary project file: {error}"));
    }
    Ok(StagedWrite {
        temporary,
        target: target.to_path_buf(),
        previous,
    })
}

fn stage_or_cleanup(
    staged: &mut Vec<StagedWrite>,
    target: &Path,
    contents: &[u8],
) -> Result<(), String> {
    match stage_write(target, contents) {
        Ok(write) => {
            staged.push(write);
            Ok(())
        }
        Err(error) => {
            cleanup_staged(staged);
            Err(error)
        }
    }
}

fn replace_staged_file(temporary: &Path, target: &Path) -> io::Result<()> {
    move_file(temporary, target, true)
}

fn rollback_writes(committed: &[&StagedWrite]) -> Vec<String> {
    let mut errors = Vec::new();
    for write in committed.iter().rev() {
        let result = match &write.previous {
            Some(contents) => atomic_write(&write.target, contents),
            None => fs::remove_file(&write.target),
        };
        if let Err(error) = result {
            if !(write.previous.is_none() && error.kind() == io::ErrorKind::NotFound) {
                errors.push(format!("{}: {error}", write.target.display()));
            }
        }
    }
    errors
}

fn cleanup_staged(staged: &[StagedWrite]) {
    for write in staged {
        let _ = fs::remove_file(&write.temporary);
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "project path has no parent"))?;
    fs::create_dir_all(parent)?;
    let temporary = temporary_path(
        parent,
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("project-file"),
    );
    write_new_file(&temporary, contents)?;
    if let Err(error) = move_file(&temporary, path, true) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn atomic_create(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "project path has no parent"))?;
    fs::create_dir_all(parent)?;
    let temporary = temporary_path(
        parent,
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("project-file"),
    );
    write_new_file(&temporary, contents)?;
    if let Err(error) = move_file(&temporary, path, false) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn write_new_file(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    let result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(path);
        return Err(error);
    }
    Ok(())
}

fn temporary_path(parent: &Path, file_name: &str) -> PathBuf {
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        counter
    ))
}

#[cfg(windows)]
fn move_file(source: &Path, destination: &Path, replace: bool) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let flags = MOVEFILE_WRITE_THROUGH
        | if replace {
            MOVEFILE_REPLACE_EXISTING
        } else {
            0
        };
    // MoveFileExW provides an atomic same-volume rename and can refuse existing targets.
    let moved = unsafe { MoveFileExW(source_wide.as_ptr(), destination_wide.as_ptr(), flags) };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn move_file(source: &Path, destination: &Path, replace: bool) -> io::Result<()> {
    if replace {
        fs::rename(source, destination)
    } else {
        fs::hard_link(source, destination)?;
        fs::remove_file(source)
    }
}

fn last_project_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|directory| directory.join(LAST_PROJECT_FILE_NAME))
}

fn remember_project(app: &AppHandle, root: &Path) -> Result<(), String> {
    let path = last_project_path(app)
        .ok_or_else(|| "could not resolve the app config directory".to_string())?;
    let contents = serde_json::to_vec(&root.to_string_lossy().to_string())
        .map_err(|error| format!("could not encode last project path: {error}"))?;
    atomic_write(&path, &contents)
        .map_err(|error| format!("could not remember the last project: {error}"))?;
    if let Err(error) = crate::recent::remember_folder(app, root) {
        eprintln!("Could not add the opened project to recents: {error}");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        atomic_create, atomic_write, open_project_root, sanitize_note_name, validate_note_file,
    };
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_directory(label: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "hive-project-{label}-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn rejects_traversal_reserved_names_and_unsafe_windows_characters() {
        assert!(validate_note_file("../outside.md").is_err());
        assert!(validate_note_file("sub\\outside.md").is_err());
        assert!(validate_note_file("CON.md").is_err());
        assert!(validate_note_file("bad:name.md").is_err());
        assert!(validate_note_file("trailing. .md").is_err());
        assert!(validate_note_file("safe note.md").is_ok());
    }

    #[test]
    fn sanitizes_windows_device_names_invalid_chars_and_long_names() {
        assert_eq!(sanitize_note_name("CON"), "CON_");
        assert_eq!(sanitize_note_name("COM¹"), "COM¹_");
        assert_eq!(sanitize_note_name("bad:name. "), "bad_name");
        assert_eq!(sanitize_note_name("  ...  "), "Note");
        assert_eq!(sanitize_note_name(&"a".repeat(130)).len(), 120);
    }

    #[test]
    fn atomic_write_replaces_a_file_without_leaving_a_temp_file() {
        let directory = test_directory("atomic");
        let path = directory.join("board.json");
        fs::write(&path, b"old").expect("write old contents");

        atomic_write(&path, b"new").expect("replace atomically");

        assert_eq!(fs::read(&path).expect("read new contents"), b"new");
        assert_eq!(fs::read_dir(&directory).expect("list directory").count(), 1);
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn atomic_write_failure_keeps_last_good_file() {
        let directory = test_directory("failure");
        let path = directory.join("board.json");
        fs::create_dir(&path).expect("create incompatible target directory");
        let sentinel = path.join("last-good");
        fs::write(&sentinel, b"keep").expect("write sentinel");

        assert!(atomic_write(&path, b"new").is_err());
        assert_eq!(fs::read(&sentinel).expect("read sentinel"), b"keep");
        assert_eq!(fs::read_dir(&directory).expect("list directory").count(), 1);
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    #[test]
    fn atomic_create_does_not_overwrite_an_existing_target() {
        let directory = test_directory("no-overwrite");
        let path = directory.join("note.md");
        fs::write(&path, b"original").expect("write original");

        assert!(atomic_create(&path, b"replacement").is_err());
        assert_eq!(fs::read(&path).expect("read original"), b"original");
        fs::remove_dir_all(directory).expect("remove test directory");
    }

    fn open_index_fixture(label: &str, index: serde_json::Value) -> serde_json::Value {
        let directory = test_directory(label);
        let notes = directory.join("notes");
        fs::create_dir_all(&notes).expect("create notes directory");
        fs::write(notes.join("Benefit.md"), "body").expect("write note body");
        fs::write(
            directory.join("board.json"),
            serde_json::to_vec(&index).expect("encode index fixture"),
        )
        .expect("write board index");

        let opened = open_project_root(&directory).expect("open project index");
        let round_trip =
            serde_json::from_str(&opened.load.index_json).expect("decode returned index");
        fs::remove_dir_all(directory).expect("remove test project");
        round_trip
    }

    #[test]
    fn opens_v1_index_with_links_and_preserves_r3_and_unknown_fields() {
        let fixture = serde_json::json!({
            "version": 1,
            "futureIndexSetting": { "enabled": true },
            "links": [{ "id": "line-1", "from": "a", "to": "b", "kind": "weak", "shape": "straight" }],
            "taskLog": [{ "noteId": "a", "name": "Benefit", "doneAt": 1700000000000_i64 }],
            "notes": [{
                "id": "a", "name": "Benefit", "file": "Benefit.md", "x": 1, "y": 2, "width": 30, "height": null,
                "type": "pro", "task": { "done": true, "doneAt": 1700000000000_i64 },
                "taskMemory": { "done": false, "doneAt": null },
                "importance": "absolute", "purposes": ["concept", "decision"], "futureNoteField": "kept"
            }]
        });

        let round_trip = open_index_fixture("v1", fixture);
        assert_eq!(round_trip["version"], 1);
        assert_eq!(round_trip["links"][0]["id"], "line-1");
        assert_eq!(round_trip["taskLog"][0]["noteId"], "a");
        assert_eq!(round_trip["notes"][0]["type"], "pro");
        assert_eq!(round_trip["notes"][0]["task"]["done"], true);
        assert_eq!(round_trip["notes"][0]["taskMemory"]["done"], false);
        assert_eq!(round_trip["notes"][0]["importance"], "absolute");
        assert_eq!(round_trip["notes"][0]["purposes"][1], "decision");
        assert_eq!(round_trip["notes"][0]["futureNoteField"], "kept");
        assert_eq!(round_trip["futureIndexSetting"]["enabled"], true);
    }

    #[test]
    fn opens_v2_and_future_indexes_without_downgrading_their_versions() {
        for (label, version) in [("v2", 2), ("future", 7)] {
            let fixture = serde_json::json!({
                "version": version,
                "futureIndexField": ["keep", 2],
                "notes": [{
                    "id": "a", "name": "Benefit", "file": "Benefit.md", "x": 1, "y": 2, "width": 30, "height": null,
                    "type": "con", "task": null, "importance": "medium", "purposes": ["timeline"],
                    "futureNoteField": { "kept": true }
                }]
            });

            let round_trip = open_index_fixture(label, fixture);
            assert_eq!(round_trip["version"], version);
            assert_eq!(round_trip["futureIndexField"][0], "keep");
            assert_eq!(round_trip["notes"][0]["type"], "con");
            assert_eq!(round_trip["notes"][0]["futureNoteField"]["kept"], true);
        }
    }
}
