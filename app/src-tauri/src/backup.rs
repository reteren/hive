use crate::project::{self, ProjectState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const HIVE_DIRECTORY: &str = ".hive";
const BACKUPS_DIRECTORY: &str = "backups";
const INDEX_FILE: &str = "board.json";
const NOTES_DIRECTORY: &str = "notes";
const ATTACHMENTS_DIRECTORY: &str = "attachments";
const META_FILE: &str = "snapshot.json";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMeta {
    id: String,
    fingerprint: String,
    note_count: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    id: String,
    date: String,
    size_bytes: u64,
    note_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupListing {
    backups: Vec<BackupInfo>,
    total_size_bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupStatus {
    fingerprint: String,
    last_snapshot_fingerprint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    findings: Vec<String>,
}

#[tauri::command]
pub fn list_backups(state: State<'_, ProjectState>) -> Result<BackupListing, String> {
    list_backups_at(&project::active_project_root(&state)?)
}

#[tauri::command]
pub fn create_backup(state: State<'_, ProjectState>) -> Result<BackupInfo, String> {
    create_backup_at(&project::active_project_root(&state)?)
}

#[tauri::command]
pub fn create_backup_if_changed(
    state: State<'_, ProjectState>,
) -> Result<Option<BackupInfo>, String> {
    let root = project::active_project_root(&state)?;
    let status = backup_status_at(&root)?;
    if status.last_snapshot_fingerprint.as_deref() == Some(&status.fingerprint) {
        return Ok(None);
    }
    create_backup_at(&root).map(Some)
}

#[tauri::command]
pub fn backup_status(state: State<'_, ProjectState>) -> Result<BackupStatus, String> {
    backup_status_at(&project::active_project_root(&state)?)
}

#[tauri::command]
pub fn delete_backup(state: State<'_, ProjectState>, id: String) -> Result<(), String> {
    let root = project::active_project_root(&state)?;
    let backup = backup_path(&root, &id)?;
    ensure_real_directory(&backup)?;
    fs::remove_dir_all(&backup).map_err(|error| format!("could not delete snapshot: {error}"))
}

#[tauri::command]
pub fn restore_backup(state: State<'_, ProjectState>, id: String) -> Result<(), String> {
    let root = project::active_project_root(&state)?;
    let backup = backup_path(&root, &id)?;
    validate_snapshot(&backup)?;
    // The current project is snapshotted first. A bad current index aborts here,
    // leaving both the selected backup and the live project untouched.
    create_backup_at(&root)?;
    restore_snapshot_at(&root, &backup)?;
    Ok(())
}

#[tauri::command]
pub fn check_project_health(state: State<'_, ProjectState>) -> Result<HealthReport, String> {
    let root = project::active_project_root(&state)?;
    Ok(check_project_health_at(&root))
}

fn create_backup_at(root: &Path) -> Result<BackupInfo, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("could not resolve project folder: {error}"))?;
    let index_path = root.join(INDEX_FILE);
    ensure_regular_file(&index_path)?;
    let index_contents =
        fs::read(&index_path).map_err(|error| format!("could not read board.json: {error}"))?;
    let note_count = project::validate_project_index_contents(&index_contents)?;
    let notes_path = root.join(NOTES_DIRECTORY);
    ensure_real_directory(&notes_path)?;
    let attachments_path = root.join(ATTACHMENTS_DIRECTORY);
    let has_attachments = optional_directory_present(&attachments_path)?;

    let fingerprint = project_fingerprint(&root)?;
    let (hive_dir, backups_dir) = ensure_backup_directories(&root)?;
    let id = unique_snapshot_id(&backups_dir);
    let temp = backups_dir.join(format!(".tmp-{}-{}", std::process::id(), next_counter()));
    fs::create_dir(&temp)
        .map_err(|error| format!("could not create temporary snapshot: {error}"))?;

    let result = (|| {
        copy_file(&index_path, &temp.join(INDEX_FILE))?;
        copy_directory_tree(&notes_path, &temp.join(NOTES_DIRECTORY))?;
        if has_attachments {
            copy_directory_tree(&attachments_path, &temp.join(ATTACHMENTS_DIRECTORY))?;
        }
        if project_fingerprint(&temp)? != fingerprint {
            return Err(
                "project files changed while the snapshot was being written; try again".to_string(),
            );
        }
        let meta = SnapshotMeta {
            id: id.clone(),
            fingerprint,
            note_count,
        };
        let meta_contents = serde_json::to_vec_pretty(&meta)
            .map_err(|error| format!("could not encode snapshot metadata: {error}"))?;
        write_new_file(&temp.join(META_FILE), &meta_contents)
            .map_err(|error| format!("could not write snapshot metadata: {error}"))?;
        let destination = backups_dir.join(&id);
        commit_snapshot_directory(&temp, &destination)?;
        backup_info(&destination, &id, note_count)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&temp);
    }
    // Keep this binding alive until all temporary work has completed.
    let _ = hive_dir;
    result
}

fn list_backups_at(root: &Path) -> Result<BackupListing, String> {
    let (_, backups_dir) = ensure_backup_directories(root)?;
    let entries =
        fs::read_dir(&backups_dir).map_err(|error| format!("could not list snapshots: {error}"))?;
    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not read snapshot entry: {error}"))?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !is_snapshot_id(&id) {
            continue;
        }
        let path = entry.path();
        ensure_real_directory(&path)?;
        let meta = read_snapshot_meta(&path)?;
        if meta.id != id {
            return Err(format!("snapshot metadata does not match directory {id}"));
        }
        validate_snapshot(&path)?;
        backups.push(backup_info(&path, &id, meta.note_count)?);
    }
    backups.sort_by(|left, right| right.id.cmp(&left.id));
    let total_size_bytes = backups.iter().map(|backup| backup.size_bytes).sum();
    Ok(BackupListing {
        backups,
        total_size_bytes,
    })
}

fn backup_status_at(root: &Path) -> Result<BackupStatus, String> {
    let fingerprint = project_fingerprint(root)?;
    let listing = list_backups_at(root)?;
    let last_snapshot_fingerprint = listing.backups.first().and_then(|backup| {
        let path = backup_path(root, &backup.id).ok()?;
        read_snapshot_meta(&path).ok().map(|meta| meta.fingerprint)
    });
    Ok(BackupStatus {
        fingerprint,
        last_snapshot_fingerprint,
    })
}

fn backup_info(path: &Path, id: &str, note_count: usize) -> Result<BackupInfo, String> {
    Ok(BackupInfo {
        id: id.to_string(),
        date: id.to_string(),
        size_bytes: directory_size(path)?,
        note_count,
    })
}

fn validate_snapshot(path: &Path) -> Result<SnapshotMeta, String> {
    ensure_real_directory(path)?;
    let index_path = path.join(INDEX_FILE);
    ensure_regular_file(&index_path)?;
    let contents = fs::read(index_path)
        .map_err(|error| format!("could not read snapshot board.json: {error}"))?;
    project::validate_project_index_contents(&contents)?;
    ensure_real_directory(&path.join(NOTES_DIRECTORY))?;
    let _ = optional_directory_present(&path.join(ATTACHMENTS_DIRECTORY))?;
    let meta = read_snapshot_meta(path)?;
    let directory_id = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if meta.id != directory_id {
        return Err("snapshot metadata does not match its directory name".to_string());
    }
    let note_count = project::validate_project_index_contents(&contents)?;
    if note_count != meta.note_count || project_fingerprint(path)? != meta.fingerprint {
        return Err("snapshot contents do not match its integrity metadata".to_string());
    }
    Ok(meta)
}

fn read_snapshot_meta(path: &Path) -> Result<SnapshotMeta, String> {
    let meta_path = path.join(META_FILE);
    ensure_regular_file(&meta_path)?;
    let contents = fs::read(meta_path)
        .map_err(|error| format!("could not read snapshot metadata: {error}"))?;
    serde_json::from_slice(&contents)
        .map_err(|error| format!("snapshot metadata is invalid: {error}"))
}

fn restore_snapshot_at(root: &Path, backup: &Path) -> Result<(), String> {
    let _ = validate_snapshot(backup)?;
    let (_, backups_dir) = ensure_backup_directories(root)?;
    let transaction = backups_dir.join(format!(
        ".tmp-restore-{}-{}",
        std::process::id(),
        next_counter()
    ));
    let staged = transaction.join("staged");
    let previous = transaction.join("previous");
    fs::create_dir_all(&staged).map_err(|error| format!("could not prepare restore: {error}"))?;
    fs::create_dir_all(&previous)
        .map_err(|error| format!("could not prepare restore rollback: {error}"))?;
    let stage_result = (|| {
        copy_file(&backup.join(INDEX_FILE), &staged.join(INDEX_FILE))?;
        copy_directory_tree(&backup.join(NOTES_DIRECTORY), &staged.join(NOTES_DIRECTORY))?;
        let backup_attachments = backup.join(ATTACHMENTS_DIRECTORY);
        if optional_directory_present(&backup_attachments)? {
            copy_directory_tree(&backup_attachments, &staged.join(ATTACHMENTS_DIRECTORY))?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = stage_result {
        let _ = fs::remove_dir_all(&transaction);
        return Err(error);
    }

    let mut moved_old = Vec::<(PathBuf, PathBuf)>::new();
    let mut installed = Vec::<PathBuf>::new();
    let apply = (|| {
        move_directory_children(
            &root.join(NOTES_DIRECTORY),
            &previous.join(NOTES_DIRECTORY),
            &mut moved_old,
        )?;
        install_directory_children(
            &staged.join(NOTES_DIRECTORY),
            &root.join(NOTES_DIRECTORY),
            &mut installed,
        )?;

        for name in [INDEX_FILE, ATTACHMENTS_DIRECTORY] {
            let live = root.join(name);
            if fs::symlink_metadata(&live).is_ok() {
                fs::rename(&live, previous.join(name)).map_err(|error| {
                    format!("could not stage current {name} for restore: {error}")
                })?;
                moved_old.push((previous.join(name), live.clone()));
            }
            let replacement = staged.join(name);
            if fs::symlink_metadata(&replacement).is_ok() {
                fs::rename(&replacement, &live)
                    .map_err(|error| format!("could not install restored {name}: {error}"))?;
                installed.push(live);
            }
        }
        Ok::<(), String>(())
    })();

    if let Err(error) = apply {
        let mut rollback_errors = Vec::new();
        for path in installed.iter().rev() {
            if let Err(rollback) = remove_path(path) {
                rollback_errors.push(format!(
                    "could not remove partial {}: {rollback}",
                    path.display()
                ));
            }
        }
        for (staged_path, original_path) in moved_old.iter().rev() {
            if let Err(rollback) = fs::rename(staged_path, original_path) {
                rollback_errors.push(format!(
                    "could not restore previous {}: {rollback}",
                    original_path.display()
                ));
            }
        }
        let _ = fs::remove_dir_all(&transaction);
        if rollback_errors.is_empty() {
            return Err(error);
        }
        return Err(format!(
            "{error}; rollback also failed: {}",
            rollback_errors.join("; ")
        ));
    }

    fs::remove_dir_all(&transaction)
        .map_err(|error| format!("restored project, but could not clean restore staging: {error}"))
}

fn move_directory_children(
    source: &Path,
    destination: &Path,
    moved: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("could not prepare {}: {error}", destination.display()))?;
    let mut entries = fs::read_dir(source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?
        .map(|entry| entry.map_err(|error| format!("could not read directory entry: {error}")))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let original = entry.path();
        let staged = destination.join(entry.file_name());
        fs::rename(&original, &staged)
            .map_err(|error| format!("could not stage {}: {error}", original.display()))?;
        moved.push((staged, original));
    }
    Ok(())
}

fn install_directory_children(
    source: &Path,
    destination: &Path,
    installed: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?
        .map(|entry| entry.map_err(|error| format!("could not read directory entry: {error}")))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let from = entry.path();
        let to = destination.join(entry.file_name());
        fs::rename(&from, &to)
            .map_err(|error| format!("could not restore {}: {error}", to.display()))?;
        installed.push(to);
    }
    Ok(())
}

fn check_project_health_at(root: &Path) -> HealthReport {
    let mut findings = Vec::new();
    let index_path = root.join(INDEX_FILE);
    let contents = match fs::read(&index_path) {
        Ok(contents) => contents,
        Err(error) => {
            findings.push(format!("Could not read board.json: {error}"));
            return HealthReport { findings };
        }
    };
    let value: Value = match serde_json::from_slice(&contents) {
        Ok(value) => value,
        Err(error) => {
            findings.push(format!("board.json is invalid JSON: {error}"));
            return HealthReport { findings };
        }
    };
    let Some(index) = value.as_object() else {
        findings.push("board.json must contain an object".to_string());
        return HealthReport { findings };
    };
    let Some(notes) = index.get("notes").and_then(Value::as_array) else {
        findings.push("board.json is missing its notes array".to_string());
        return HealthReport { findings };
    };
    if project::validate_project_index_contents(&contents).is_err() {
        findings.push("board.json has invalid note ids, file names, or geometry".to_string());
    }

    let notes_dir = root.join(NOTES_DIRECTORY);
    let mut actual_files = HashSet::new();
    match fs::read_dir(&notes_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
                {
                    if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                        actual_files.insert(name.to_lowercase());
                    }
                }
            }
        }
        Err(error) => findings.push(format!("Could not read notes folder: {error}")),
    }

    let known_kinds: HashSet<&str> = [
        "note",
        "pro",
        "con",
        "importance",
        "purpose",
        "mood",
        "beacon",
        "goal",
        "progress",
        "calculator",
        "tierlist",
        "stats",
        "archive",
        "trash",
    ]
    .into_iter()
    .collect();
    let mut ids = HashSet::new();
    let mut tracked_files = HashSet::new();
    for (position, note) in notes.iter().enumerate() {
        let Some(note) = note.as_object() else {
            findings.push(format!("Note entry {} is not an object", position + 1));
            continue;
        };
        let id = note.get("id").and_then(Value::as_str);
        if let Some(id) = id {
            ids.insert(id.to_string());
        }
        let label = id.unwrap_or("(unknown id)");
        if let Some(kind) = note.get("type").and_then(Value::as_str) {
            if !known_kinds.contains(kind) {
                findings.push(format!("Note {label} has unknown kind '{kind}'"));
            }
        }
        let file = note
            .get("file")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                // Legacy board indexes before explicit file names use the note name.
                note.get("name")
                    .and_then(Value::as_str)
                    .map(|name| format!("{name}.md"))
            });
        if let Some(file) = file {
            let key = file.to_lowercase();
            tracked_files.insert(key.clone());
            if !actual_files.contains(&key) {
                findings.push(format!("Note {label} is missing notes/{file}"));
            }
        } else {
            findings.push(format!("Note {label} has no Markdown file entry"));
        }
    }
    for file in actual_files.difference(&tracked_files) {
        findings.push(format!("notes/{file} has no board.json entry"));
    }

    if let Some(links) = index.get("links").and_then(Value::as_array) {
        for (position, link) in links.iter().enumerate() {
            let Some(link) = link.as_object() else {
                findings.push(format!("Link {} is not an object", position + 1));
                continue;
            };
            for endpoint in ["from", "to"] {
                let Some(id) = link.get(endpoint).and_then(Value::as_str) else {
                    findings.push(format!("Link {} has no {endpoint} endpoint", position + 1));
                    continue;
                };
                let is_allowed_me_source = endpoint == "from" && id == "me";
                if !is_allowed_me_source && !ids.contains(id) {
                    findings.push(format!(
                        "Link {} points to missing note '{id}'",
                        position + 1
                    ));
                }
            }
        }
    } else if index.contains_key("links") {
        findings.push("board.json links must be an array".to_string());
    }

    if let Some(zones) = index.get("zones") {
        if let Some(zones) = zones.as_array() {
            for (position, zone) in zones.iter().enumerate() {
                if !valid_zone(zone) {
                    let name = zone
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("(unnamed)");
                    findings.push(format!("Zone {position} '{name}' has invalid contours"));
                }
            }
        } else {
            findings.push("board.json zones must be an array".to_string());
        }
    }
    HealthReport { findings }
}

fn valid_zone(zone: &Value) -> bool {
    let Some(zone) = zone.as_object() else {
        return false;
    };
    let Some(parts) = zone.get("parts").and_then(Value::as_array) else {
        return false;
    };
    if parts.is_empty() || !parts.iter().all(valid_polygon) {
        return false;
    }
    match zone.get("holes") {
        None => true,
        Some(holes) => holes
            .as_array()
            .is_some_and(|holes| holes.iter().all(valid_polygon)),
    }
}

fn valid_polygon(polygon: &Value) -> bool {
    let Some(points) = polygon.as_array() else {
        return false;
    };
    if points.len() < 4 {
        return false;
    }
    let mut area = 0.0_f64;
    let mut parsed = Vec::new();
    for point in points {
        let Some(point) = point.as_object() else {
            return false;
        };
        let (Some(x), Some(y)) = (
            point.get("x").and_then(Value::as_f64),
            point.get("y").and_then(Value::as_f64),
        ) else {
            return false;
        };
        if !x.is_finite() || !y.is_finite() {
            return false;
        }
        parsed.push((x, y));
    }
    for index in 0..parsed.len() {
        let (x, y) = parsed[index];
        let (next_x, next_y) = parsed[(index + 1) % parsed.len()];
        if x == next_x && y == next_y {
            return false;
        }
        if x != next_x && y != next_y {
            return false;
        }
        area += x * next_y - next_x * y;
    }
    area.abs() > f64::EPSILON
}

fn project_fingerprint(root: &Path) -> Result<String, String> {
    let mut files = vec![root.join(INDEX_FILE)];
    for directory_name in [NOTES_DIRECTORY, ATTACHMENTS_DIRECTORY] {
        let directory = root.join(directory_name);
        if optional_directory_present(&directory)? {
            collect_files(&directory, &mut files)?;
        }
    }
    files.sort();
    let mut hash = 0xcbf29ce484222325_u64;
    for path in files {
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "project file escaped its folder")?;
        for byte in relative.to_string_lossy().replace('\\', "/").as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
        let bytes = fs::read(&path).map_err(|error| {
            format!(
                "could not read project file {}: {error}",
                relative.display()
            )
        })?;
        for byte in bytes {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xfe;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(format!("{hash:016x}"))
}

fn collect_files(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    ensure_real_directory(directory)?;
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("could not inspect {}: {error}", directory.display()))?
        .map(|entry| entry.map_err(|error| format!("could not inspect directory entry: {error}")))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("could not inspect {}: {error}", path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "refusing to snapshot symbolic link {}",
                path.display()
            ));
        }
        if metadata.is_dir() {
            collect_files(&path, output)?;
        } else if metadata.is_file() {
            output.push(path);
        } else {
            return Err(format!(
                "unsupported project file type at {}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn copy_directory_tree(source: &Path, destination: &Path) -> Result<(), String> {
    ensure_real_directory(source)?;
    fs::create_dir(destination)
        .map_err(|error| format!("could not create {}: {error}", destination.display()))?;
    let mut entries = fs::read_dir(source)
        .map_err(|error| format!("could not read {}: {error}", source.display()))?
        .map(|entry| entry.map_err(|error| format!("could not read directory entry: {error}")))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let from = entry.path();
        let to = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&from)
            .map_err(|error| format!("could not inspect {}: {error}", from.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!("refusing to copy symbolic link {}", from.display()));
        }
        if metadata.is_dir() {
            copy_directory_tree(&from, &to)?;
        } else if metadata.is_file() {
            copy_file(&from, &to)?;
        } else {
            return Err(format!(
                "unsupported project file type at {}",
                from.display()
            ));
        }
    }
    Ok(())
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    ensure_regular_file(source)?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create destination folder: {error}"))?;
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|error| format!("could not copy {}: {error}", source.display()))
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

fn ensure_backup_directories(root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let hive = root.join(HIVE_DIRECTORY);
    ensure_directory_create_safe(&hive)?;
    let backups = hive.join(BACKUPS_DIRECTORY);
    ensure_directory_create_safe(&backups)?;
    Ok((hive, backups))
}

fn ensure_directory_create_safe(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(format!(
            "refusing to use non-directory or symbolic link {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir(path)
            .map_err(|error| format!("could not create {}: {error}", path.display())),
        Err(error) => Err(format!("could not inspect {}: {error}", path.display())),
    }
}

fn optional_directory_present(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "refusing symbolic link directory {}",
            path.display()
        )),
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(format!("expected a directory at {}", path.display())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "could not inspect directory {}: {error}",
            path.display()
        )),
    }
}

fn commit_snapshot_directory(temp: &Path, destination: &Path) -> Result<(), String> {
    if fs::symlink_metadata(destination).is_ok() {
        return Err("a snapshot with this timestamp already exists".to_string());
    }
    fs::rename(temp, destination)
        .map_err(|error| format!("could not finish snapshot atomically: {error}"))
}

fn ensure_real_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "refusing symbolic link directory {}",
            path.display()
        )),
        Ok(metadata) if metadata.is_dir() => Ok(()),
        Ok(_) => Err(format!("expected a directory at {}", path.display())),
        Err(error) => Err(format!(
            "could not access directory {}: {error}",
            path.display()
        )),
    }
}

fn ensure_regular_file(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("refusing symbolic link file {}", path.display()))
        }
        Ok(metadata) if metadata.is_file() => Ok(()),
        Ok(_) => Err(format!("expected a regular file at {}", path.display())),
        Err(error) => Err(format!("could not access file {}: {error}", path.display())),
    }
}

fn directory_size(path: &Path) -> Result<u64, String> {
    ensure_real_directory(path)?;
    let mut size = 0_u64;
    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?
        .map(|entry| entry.map_err(|error| format!("could not read directory entry: {error}")))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let entry_path = entry.path();
        let metadata = fs::symlink_metadata(&entry_path)
            .map_err(|error| format!("could not inspect {}: {error}", entry_path.display()))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "snapshot contains symbolic link {}",
                entry_path.display()
            ));
        }
        if metadata.is_dir() {
            size = size.saturating_add(directory_size(&entry_path)?);
        } else if metadata.is_file() {
            size = size.saturating_add(metadata.len());
        }
    }
    Ok(size)
}

fn backup_path(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !is_snapshot_id(id) {
        return Err("snapshot id is invalid".to_string());
    }
    let (_, directory) = ensure_backup_directories(root)?;
    let path = directory.join(id);
    ensure_real_directory(&path)?;
    let canonical_root = fs::canonicalize(&directory)
        .map_err(|error| format!("could not resolve backups folder: {error}"))?;
    let canonical_path = fs::canonicalize(&path)
        .map_err(|error| format!("could not resolve snapshot folder: {error}"))?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("snapshot path escapes the backups folder".to_string());
    }
    Ok(canonical_path)
}

fn is_snapshot_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.')
        && id != "."
        && id != ".."
}

fn unique_snapshot_id(backups: &Path) -> String {
    let base = iso_timestamp(SystemTime::now());
    if !backups.join(&base).exists() {
        return base;
    }
    for suffix in 1..=9999 {
        let candidate = format!("{base}-{suffix:04}");
        if !backups.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{base}-{}", next_counter())
}

fn iso_timestamp(time: SystemTime) -> String {
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = duration.as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = day_seconds % 3_600 / 60;
    let second = day_seconds % 60;
    let millis = duration.subsec_millis();
    format!("{year:04}-{month:02}-{day:02}T{hour:02}-{minute:02}-{second:02}.{millis:03}Z")
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let shifted = days_since_epoch + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

fn next_counter() -> u64 {
    TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn remove_path(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            fs::remove_dir_all(path)
        }
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        check_project_health_at, commit_snapshot_directory, create_backup_at, list_backups_at,
        restore_snapshot_at,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn project(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "hive-backup-{label}-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(root.join("notes")).expect("create notes folder");
        fs::write(root.join("board.json"), br#"{"version":1,"notes":[{"id":"note-1","name":"First","file":"First.md","x":1,"y":2,"width":30,"height":null}],"links":[],"zones":[]}"#).expect("write board");
        fs::write(root.join("notes/First.md"), "original note").expect("write note");
        root
    }

    #[test]
    fn snapshot_restore_round_trip_preserves_project_files_and_keeps_restore_point() {
        let root = project("round-trip");
        fs::create_dir_all(root.join("attachments")).expect("create attachments folder");
        fs::write(root.join("attachments/source.bin"), b"source attachment")
            .expect("write attachment");
        let info = create_backup_at(&root).expect("create snapshot");
        fs::write(root.join("notes/First.md"), "changed note").expect("change live note");
        fs::write(root.join("notes/Extra.md"), "extra").expect("add live file");
        fs::write(root.join("attachments/source.bin"), b"changed attachment")
            .expect("change attachment");
        create_backup_at(&root).expect("snapshot current state before restore");

        restore_snapshot_at(&root, &root.join(".hive/backups").join(&info.id))
            .expect("restore snapshot");

        assert_eq!(
            fs::read_to_string(root.join("notes/First.md")).expect("read note"),
            "original note"
        );
        assert!(!root.join("notes/Extra.md").exists());
        assert_eq!(
            fs::read(root.join("attachments/source.bin")).expect("read attachment"),
            b"source attachment"
        );
        assert_eq!(
            list_backups_at(&root)
                .expect("list snapshots")
                .backups
                .len(),
            2
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn corrupt_current_index_cannot_replace_or_damage_a_good_snapshot() {
        let root = project("corrupt");
        let info = create_backup_at(&root).expect("create good snapshot");
        let snapshot_file = root
            .join(".hive/backups")
            .join(&info.id)
            .join("notes/First.md");
        let before = fs::read(&snapshot_file).expect("read good snapshot");
        fs::write(root.join("board.json"), b"{broken json").expect("damage live index");

        assert!(create_backup_at(&root).is_err());
        assert_eq!(
            fs::read(&snapshot_file).expect("read unchanged snapshot"),
            before
        );
        assert_eq!(
            list_backups_at(&root)
                .expect("list good snapshots")
                .backups
                .len(),
            1
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn failed_snapshot_does_not_leave_a_partial_directory() {
        let root = project("atomic");
        create_backup_at(&root).expect("create snapshot");
        let backups = root.join(".hive/backups");
        let entries = fs::read_dir(&backups).expect("read backups").count();
        fs::remove_dir_all(root.join("notes")).expect("remove notes folder");
        assert!(create_backup_at(&root).is_err());
        assert_eq!(
            fs::read_dir(&backups)
                .expect("read backups after failure")
                .count(),
            entries
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn atomic_commit_never_replaces_an_existing_snapshot_directory() {
        let root = project("atomic-commit");
        let temp = root.join(".hive-temp-snapshot");
        let destination = root.join("existing-snapshot");
        fs::create_dir(&temp).expect("create temporary snapshot");
        fs::write(temp.join("board.json"), b"new").expect("write staged index");
        fs::create_dir(&destination).expect("create existing snapshot");
        fs::write(destination.join("board.json"), b"last good").expect("write good index");

        assert!(commit_snapshot_directory(&temp, &destination).is_err());
        assert_eq!(
            fs::read(destination.join("board.json")).expect("read good snapshot"),
            b"last good"
        );
        assert!(
            temp.join("board.json").is_file(),
            "failed commit keeps its temporary source for cleanup"
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn health_check_reports_unknown_kinds_and_dangling_links_without_fixes() {
        let root = project("health");
        let board = br#"{"version":1,"notes":[{"id":"note-1","name":"First","file":"First.md","x":1,"y":2,"width":30,"height":null,"type":"mystery"}],"links":[{"from":"missing","to":"note-1"}],"zones":[{"name":"Broken","parts":[[{"x":1,"y":1}]],"holes":[]}] }"#;
        fs::write(root.join("board.json"), board).expect("write invalid entries");
        fs::remove_file(root.join("notes/First.md")).expect("remove indexed note file");
        fs::write(root.join("notes/Extra.md"), "untracked").expect("write untracked file");
        let report = check_project_health_at(&root);
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.contains("unknown kind")));
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.contains("missing note 'missing'")));
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.contains("missing notes/First.md")));
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.contains("notes/extra.md has no board.json entry")));
        assert!(report
            .findings
            .iter()
            .any(|finding| finding.contains("invalid contours")));
        assert_eq!(
            fs::read(root.join("board.json")).expect("read unchanged board"),
            board
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
