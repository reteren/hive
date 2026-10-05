use crate::project::{self, ProjectState};
use crate::attachments;
use crate::drawing;
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
const DRAWING_DIRECTORY: &str = "drawing";
const ATTACHMENTS_POOL_DIRECTORY: &str = "attachments-pool";
const ATTACHMENTS_MANIFEST: &str = "attachments.json";
const META_FILE: &str = "snapshot.json";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMeta {
    id: String,
    fingerprint: String,
    note_count: usize,
    /// 0 (absent) = legacy fingerprint over full attachment contents; 2 = attachments by name + size.
    #[serde(default)]
    fingerprint_version: u32,
}

/// Attachment files are immutable within a snapshot; name and size are cheap identifiers after
/// project migration. Legacy hash-named entries are content-verified on restore.
const FINGERPRINT_VERSION: u32 = 2;

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
    delete_backup_at(&root, &id)
}

#[tauri::command]
pub fn restore_backup(state: State<'_, ProjectState>, id: String) -> Result<(), String> {
    let root = project::active_project_root(&state)?;
    let backup = backup_path(&root, &id)?;
    validate_snapshot_deep(&backup)?;
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
    let drawing_path = root.join(DRAWING_DIRECTORY);
    let has_drawing = optional_directory_present(&drawing_path)?;

    let fingerprint = project_fingerprint(&root)?;
    let (hive_dir, backups_dir) = ensure_backup_directories(&root)?;
    let attachments_pool = backups_dir.join(ATTACHMENTS_POOL_DIRECTORY);
    ensure_directory_create_safe(&attachments_pool)?;
    let id = unique_snapshot_id(&backups_dir);
    let temp = backups_dir.join(format!(".tmp-{}-{}", std::process::id(), next_counter()));
    fs::create_dir(&temp)
        .map_err(|error| format!("could not create temporary snapshot: {error}"))?;

    let result = (|| {
        copy_file(&index_path, &temp.join(INDEX_FILE))?;
        copy_directory_tree(&notes_path, &temp.join(NOTES_DIRECTORY))?;
        if has_drawing { copy_directory_tree(&drawing_path, &temp.join(DRAWING_DIRECTORY))?; }
        let attachment_files = if has_attachments {
            copy_attachments_to_pool(&attachments_path, &attachments_pool)?
        } else {
            Vec::new()
        };
        let manifest = serde_json::to_vec_pretty(&attachment_files)
            .map_err(|error| format!("could not encode attachment manifest: {error}"))?;
        write_new_file(&temp.join(ATTACHMENTS_MANIFEST), &manifest)
            .map_err(|error| format!("could not write attachment manifest: {error}"))?;
        if project_fingerprint(&root)? != fingerprint {
            return Err(
                "project files changed while the snapshot was being written; try again".to_string(),
            );
        }
        let snapshot_fingerprint = snapshot_fingerprint(&temp, &attachments_pool)?;
        let meta = SnapshotMeta {
            id: id.clone(),
            fingerprint: snapshot_fingerprint,
            note_count,
            fingerprint_version: FINGERPRINT_VERSION,
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
        if id == ATTACHMENTS_POOL_DIRECTORY || !is_snapshot_id(&id) {
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
    let total_size_bytes = backups.iter().map(|backup| backup.size_bytes).sum::<u64>()
        .saturating_add(optional_directory_size(&backups_dir.join(ATTACHMENTS_POOL_DIRECTORY))?);
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

/// Listing snapshots (every project open) uses the cheap check: structure, names and sizes.
/// `deep` (restore only) also re-hashes every pooled attachment and checks legacy content fingerprints.
fn validate_snapshot(path: &Path) -> Result<SnapshotMeta, String> {
    validate_snapshot_with(path, false)
}

fn validate_snapshot_deep(path: &Path) -> Result<SnapshotMeta, String> {
    validate_snapshot_with(path, true)
}

fn validate_snapshot_with(path: &Path, deep: bool) -> Result<SnapshotMeta, String> {
    ensure_real_directory(path)?;
    let index_path = path.join(INDEX_FILE);
    ensure_regular_file(&index_path)?;
    let contents = fs::read(index_path)
        .map_err(|error| format!("could not read snapshot board.json: {error}"))?;
    project::validate_project_index_contents(&contents)?;
    ensure_real_directory(&path.join(NOTES_DIRECTORY))?;
    let has_legacy_attachments = optional_directory_present(&path.join(ATTACHMENTS_DIRECTORY))?;
    let meta = read_snapshot_meta(path)?;
    let directory_id = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if meta.id != directory_id {
        return Err("snapshot metadata does not match its directory name".to_string());
    }
    let note_count = project::validate_project_index_contents(&contents)?;
    let by_size = meta.fingerprint_version >= FINGERPRINT_VERSION;
    // A legacy snapshot's fingerprint covers full attachment contents; recomputing it means reading
    // every video again, so it is only checked on restore.
    let check_fingerprint = by_size || deep;
    let fingerprint = if let Some(files) = read_attachment_manifest(path)? {
        if has_legacy_attachments {
            return Err("snapshot contains both pooled and embedded attachments".to_string());
        }
        let pool = path.parent().ok_or_else(|| "snapshot has no parent folder".to_string())?
            .join(ATTACHMENTS_POOL_DIRECTORY);
        for file in &files {
            let target = pool.join(file);
            ensure_regular_file(&target)?;
            if deep && attachments::is_legacy_hash_attachment(file) {
                let hash = file.split_once('.').map(|(hash, _)| hash).unwrap_or_default();
                attachments::verify_existing_attachment(&target, hash)?;
            }
        }
        if check_fingerprint { Some(snapshot_fingerprint_with(path, &pool, by_size)?) } else { None }
    } else if check_fingerprint {
        // Snapshots made before pooled storage keep their embedded attachments folder.
        Some(if by_size { project_fingerprint(path)? } else { legacy_project_fingerprint(path)? })
    } else {
        None
    };
    if note_count != meta.note_count || fingerprint.is_some_and(|value| value != meta.fingerprint) {
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

fn read_attachment_manifest(snapshot: &Path) -> Result<Option<Vec<String>>, String> {
    let path = snapshot.join(ATTACHMENTS_MANIFEST);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("could not inspect attachment manifest: {error}")),
        Ok(_) => ensure_regular_file(&path)?,
    }
    let contents = fs::read(&path).map_err(|error| format!("could not read attachment manifest: {error}"))?;
    let files: Vec<String> = serde_json::from_slice(&contents)
        .map_err(|error| format!("attachment manifest is invalid: {error}"))?;
    let mut unique = HashSet::new();
    for file in &files {
        attachments::validate_attachment_filename(file)?;
        if !unique.insert(file) {
            return Err("attachment manifest contains duplicate file names".to_string());
        }
    }
    Ok(Some(files))
}

fn copy_attachments_to_pool(source: &Path, pool: &Path) -> Result<Vec<String>, String> {
    ensure_real_directory(source)?;
    ensure_directory_create_safe(pool)?;
    let mut entries = fs::read_dir(source)
        .map_err(|error| format!("could not read attachments folder: {error}"))?
        .map(|entry| entry.map_err(|error| format!("could not read attachment entry: {error}")))
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    let mut files = Vec::with_capacity(entries.len());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        attachments::validate_attachment_filename(&name)?;
        let file_type = entry.file_type().map_err(|error| format!("could not inspect attachment {name}: {error}"))?;
        if !file_type.is_file() || file_type.is_symlink() {
            return Err(format!("attachment {name} is not a regular file"));
        }
        let source_file = entry.path();
        ensure_regular_file(&source_file)?;
        // Content-addressed and immutable: an already pooled file with the same name and size is the
        // same file. Re-hashing every video on every snapshot made opening a project take minutes.
        let pooled = pool.join(&name);
        match fs::symlink_metadata(&pooled) {
            Ok(_) => {
                ensure_regular_file(&pooled)?;
                if !same_size(&source_file, &pooled)? {
                    return Err(format!("pooled attachment {name} differs from the project copy"));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => copy_pool_file(&source_file, &pooled)?,
            Err(error) => return Err(format!("could not inspect pooled attachment {name}: {error}")),
        }
        files.push(name);
    }
    Ok(files)
}

fn same_size(left: &Path, right: &Path) -> Result<bool, String> {
    let left = fs::metadata(left).map_err(|error| format!("could not inspect attachment: {error}"))?;
    let right = fs::metadata(right).map_err(|error| format!("could not inspect pooled attachment: {error}"))?;
    Ok(left.len() == right.len())
}

fn copy_pool_file(source: &Path, destination: &Path) -> Result<(), String> {
    let filename = destination.file_name().and_then(|name| name.to_str()).unwrap_or("attachment");
    let temporary = destination.with_file_name(format!(".tmp-{}-{}-{filename}", std::process::id(), next_counter()));
    let result = (|| {
        let mut input = fs::File::open(source).map_err(|error| format!("could not read attachment: {error}"))?;
        let mut output = OpenOptions::new().write(true).create_new(true).open(&temporary)
            .map_err(|error| format!("could not stage pooled attachment: {error}"))?;
        io::copy(&mut input, &mut output).map_err(|error| format!("could not copy attachment to pool: {error}"))?;
        output.sync_all().map_err(|error| format!("could not finish pooled attachment: {error}"))?;
        drop(output);
        match fs::hard_link(&temporary, destination) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                ensure_regular_file(destination)?;
                if same_size(source, destination)? {
                    Ok(())
                } else {
                    Err("pooled attachment differs from the project copy".to_string())
                }
            }
            Err(error) => Err(format!("could not install pooled attachment: {error}")),
        }
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn snapshot_fingerprint(snapshot: &Path, pool: &Path) -> Result<String, String> {
    snapshot_fingerprint_with(snapshot, pool, true)
}

fn snapshot_fingerprint_with(snapshot: &Path, pool: &Path, attachments_by_size: bool) -> Result<String, String> {
    let mut entries = vec![
        (INDEX_FILE.to_string(), snapshot.join(INDEX_FILE)),
        (ATTACHMENTS_MANIFEST.to_string(), snapshot.join(ATTACHMENTS_MANIFEST)),
    ];
    let notes = snapshot.join(NOTES_DIRECTORY);
    let mut note_files = Vec::new();
    collect_files(&notes, &mut note_files)?;
    entries.extend(note_files.into_iter().map(|path| {
        let relative = path.strip_prefix(snapshot).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        (relative, path)
    }));
    let drawing = snapshot.join(DRAWING_DIRECTORY);
    if optional_directory_present(&drawing)? {
        let mut drawing_files = Vec::new();
        collect_files(&drawing, &mut drawing_files)?;
        entries.extend(drawing_files.into_iter().map(|path| {
            let relative = path.strip_prefix(snapshot).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            (relative, path)
        }));
    }
    if let Some(files) = read_attachment_manifest(snapshot)? {
        for file in files {
            entries.push((format!("{ATTACHMENTS_DIRECTORY}/{file}"), pool.join(file)));
        }
    }
    fingerprint_entries(entries, attachments_by_size)
}

fn garbage_collect_attachment_pool(backups: &Path) -> Result<(), String> {
    ensure_real_directory(backups)?;
    let pool = backups.join(ATTACHMENTS_POOL_DIRECTORY);
    if !optional_directory_present(&pool)? { return Ok(()); }
    let entries = fs::read_dir(backups)
        .map_err(|error| format!("could not inspect snapshots for attachment cleanup: {error}"))?;
    let mut referenced = HashSet::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not read snapshot entry: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_snapshot_id(&name) { continue; }
        let path = entry.path();
        ensure_real_directory(&path)?;
        if let Some(files) = read_attachment_manifest(&path)? {
            referenced.extend(files);
        }
    }
    let entries = fs::read_dir(&pool)
        .map_err(|error| format!("could not list pooled attachments: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not read pooled attachment: {error}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        ensure_regular_file(&path)?;
        attachments::validate_attachment_filename(&name)?;
        if !referenced.contains(&name) {
            fs::remove_file(&path).map_err(|error| format!("could not remove unused pooled attachment {name}: {error}"))?;
        }
    }
    Ok(())
}

fn delete_backup_at(root: &Path, id: &str) -> Result<(), String> {
    let backup = backup_path(root, id)?;
    ensure_real_directory(&backup)?;
    fs::remove_dir_all(&backup).map_err(|error| format!("could not delete snapshot: {error}"))?;
    let backups = backup.parent().ok_or_else(|| "snapshot has no parent folder".to_string())?;
    garbage_collect_attachment_pool(backups)
}

fn restore_snapshot_at(root: &Path, backup: &Path) -> Result<(), String> {
    let _ = validate_snapshot_deep(backup)?;
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
        let backup_drawing = backup.join(DRAWING_DIRECTORY);
        if optional_directory_present(&backup_drawing)? {
            copy_directory_tree(&backup_drawing, &staged.join(DRAWING_DIRECTORY))?;
        }
        if let Some(files) = read_attachment_manifest(backup)? {
            let pool = backup.parent().ok_or_else(|| "snapshot has no parent folder".to_string())?
                .join(ATTACHMENTS_POOL_DIRECTORY);
            let attachments = staged.join(ATTACHMENTS_DIRECTORY);
            fs::create_dir(&attachments).map_err(|error| format!("could not prepare restored attachments: {error}"))?;
            for file in files {
                copy_file(&pool.join(&file), &attachments.join(&file))?;
            }
        } else {
            let backup_attachments = backup.join(ATTACHMENTS_DIRECTORY);
            if optional_directory_present(&backup_attachments)? {
                copy_directory_tree(&backup_attachments, &staged.join(ATTACHMENTS_DIRECTORY))?;
            }
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

        for name in [INDEX_FILE, ATTACHMENTS_DIRECTORY, DRAWING_DIRECTORY] {
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

    let mut attachment_references = HashSet::new();
    collect_json_attachment_references(&value, &mut attachment_references);
    match fs::read_dir(&notes_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| extension.eq_ignore_ascii_case("md")) {
                    if let Ok(text) = fs::read_to_string(path) {
                        collect_inline_attachment_references(&text, &mut attachment_references);
                    }
                }
            }
        }
        Err(_) => {}
    }
    let attachments_dir = root.join(ATTACHMENTS_DIRECTORY);
    let mut attachment_references = attachment_references.into_iter().collect::<Vec<_>>();
    attachment_references.sort();
    for file in attachment_references {
        let exists = attachments::validate_attachment_filename(&file).is_ok()
            && ensure_real_directory(&attachments_dir).is_ok()
            && ensure_regular_file(&attachments_dir.join(&file)).is_ok();
        if !exists {
            findings.push(format!("Missing attachment {file}"));
        }
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
    findings.extend(drawing::health_findings(root));
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
    project_fingerprint_with(root, true)
}

/// Fingerprint over full attachment contents, only for validating snapshots made before version 2.
fn legacy_project_fingerprint(root: &Path) -> Result<String, String> {
    project_fingerprint_with(root, false)
}

fn project_fingerprint_with(root: &Path, attachments_by_size: bool) -> Result<String, String> {
    let mut files = vec![root.join(INDEX_FILE)];
    for directory_name in [NOTES_DIRECTORY, ATTACHMENTS_DIRECTORY, DRAWING_DIRECTORY] {
        let directory = root.join(directory_name);
        if optional_directory_present(&directory)? {
            collect_files(&directory, &mut files)?;
        }
    }
    let entries = files.into_iter().map(|path| {
        let relative = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        (relative, path)
    }).collect();
    fingerprint_entries(entries, attachments_by_size)
}

fn fingerprint_entries(mut entries: Vec<(String, PathBuf)>, attachments_by_size: bool) -> Result<String, String> {
    entries.sort_by(|left, right| left.0.cmp(&right.0));
    let mut hash = 0xcbf29ce484222325_u64;
    let attachment_prefix = format!("{ATTACHMENTS_DIRECTORY}/");
    for (relative, path) in entries {
        for byte in relative.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xff;
        hash = hash.wrapping_mul(0x100000001b3);
        let bytes = if attachments_by_size && relative.starts_with(&attachment_prefix) {
            let metadata = fs::metadata(&path)
                .map_err(|error| format!("could not inspect project file {relative}: {error}"))?;
            metadata.len().to_le_bytes().to_vec()
        } else {
            fs::read(&path).map_err(|error| {
                format!(
                    "could not read project file {}: {error}",
                    relative
                )
            })?
        };
        for byte in bytes {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash ^= 0xfe;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    Ok(format!("{hash:016x}"))
}

fn collect_json_attachment_references(value: &Value, output: &mut HashSet<String>) {
    match value {
        Value::Object(object) => {
            let image_container = object.get("type").and_then(Value::as_str) == Some("image")
                || object.get("kind").and_then(Value::as_str) == Some("image");
            let image_ref = object.contains_key("mime") || object.contains_key("naturalWidth");
            let source_ref = object.contains_key("description") && (object.contains_key("url") || object.contains_key("filePath"));
            if (image_container || image_ref || source_ref) && !object.contains_key("externalPath") {
                if let Some(file) = object.get("file").and_then(Value::as_str) {
                    output.insert(file.to_string());
                }
            }
            for child in object.values() {
                collect_json_attachment_references(child, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_json_attachment_references(item, output);
            }
        }
        _ => {}
    }
}

fn collect_inline_attachment_references(text: &str, output: &mut HashSet<String>) {
    let mut remaining = text;
    while let Some(index) = remaining.find("att:") {
        let after = &remaining[index + 4..];
        let file = after.split([')', '}', '\n', '\r', ' ', '\t']).next().unwrap_or_default();
        if !file.is_empty() {
            output.insert(percent_decode(file).unwrap_or_else(|| file.to_string()));
        }
        remaining = after;
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let pair = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            decoded.push(u8::from_str_radix(pair, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
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

fn optional_directory_size(path: &Path) -> Result<u64, String> {
    if optional_directory_present(path)? { directory_size(path) } else { Ok(0) }
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
        check_project_health_at, commit_snapshot_directory, create_backup_at, delete_backup_at,
        legacy_project_fingerprint, list_backups_at, project_fingerprint, restore_snapshot_at,
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

    fn write_attachment(root: &PathBuf, bytes: &[u8]) -> String {
        let name = format!("{}.png", crate::attachments::sha256_hex(bytes));
        fs::create_dir_all(root.join("attachments")).expect("create attachments folder");
        fs::write(root.join("attachments").join(&name), bytes).expect("write attachment");
        name
    }

    #[test]
    fn snapshot_restore_round_trip_preserves_project_files_and_keeps_restore_point() {
        let root = project("round-trip");
        let original_attachment = b"source attachment";
        let original_file = write_attachment(&root, original_attachment);
        let info = create_backup_at(&root).expect("create snapshot");
        fs::write(root.join("notes/First.md"), "changed note").expect("change live note");
        fs::write(root.join("notes/Extra.md"), "extra").expect("add live file");
        let changed_file = write_attachment(&root, b"changed attachment");
        create_backup_at(&root).expect("snapshot current state before restore");

        restore_snapshot_at(&root, &root.join(".hive/backups").join(&info.id))
            .expect("restore snapshot");

        assert_eq!(
            fs::read_to_string(root.join("notes/First.md")).expect("read note"),
            "original note"
        );
        assert!(!root.join("notes/Extra.md").exists());
        assert_eq!(
            fs::read(root.join("attachments").join(&original_file)).expect("read attachment"),
            original_attachment
        );
        assert!(!root.join("attachments").join(changed_file).exists());
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
    fn restores_a_hash_named_snapshot_after_live_attachments_are_migrated() {
        let root = project("legacy-hash-after-migration");
        let bytes = b"legacy image bytes";
        let old_file = write_attachment(&root, bytes);
        fs::write(
            root.join("board.json"),
            format!(r#"{{"version":1,"notes":[{{"id":"note-1","name":"First","file":"First.md","x":1,"y":2,"width":30,"height":null,"image":{{"file":"{old_file}","name":"photo.png","mime":"image/png","size":18,"naturalWidth":1,"naturalHeight":1}}}}],"links":[],"zones":[]}}"#),
        )
        .expect("write legacy board index");
        let snapshot = create_backup_at(&root).expect("create pre-migration snapshot");

        crate::attachments::migrate_attachments(&root).expect("migrate live attachments");
        assert!(root.join("attachments/photo.png").exists());
        restore_snapshot_at(&root, &root.join(".hive/backups").join(&snapshot.id))
            .expect("restore pre-migration snapshot");

        assert_eq!(
            fs::read(root.join("attachments").join(&old_file)).expect("restored hash attachment"),
            bytes
        );
        crate::attachments::migrate_attachments(&root).expect("migrate restored snapshot");
        assert!(!root.join("attachments").join(&old_file).exists());
        assert_eq!(
            fs::read(root.join("attachments/photo.png")).expect("restored readable attachment"),
            bytes
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn drawing_tiles_are_fingerprinted_backed_up_restored_and_health_checked() {
        let root = project("drawing");
        let drawing = root.join("drawing");
        fs::create_dir_all(drawing.join("tiles")).expect("create drawing tiles");
        fs::write(drawing.join("drawing.json"), br#"{"version":1,"pxPerUnit":20,"tileSizePx":512,"tiles":["-1:2"]}"#).expect("write drawing index");
        let tile = drawing.join("tiles/-1_2.png");
        fs::write(&tile, b"original drawing bytes").expect("write drawing tile");
        let before = project_fingerprint(&root).expect("fingerprint drawing");
        let snapshot = create_backup_at(&root).expect("snapshot drawing");
        assert_eq!(fs::read(root.join(".hive/backups").join(&snapshot.id).join("drawing/tiles/-1_2.png")).unwrap(), b"original drawing bytes");
        fs::write(&tile, b"changed drawing bytes!").expect("change drawing tile");
        assert_ne!(project_fingerprint(&root).unwrap(), before);
        restore_snapshot_at(&root, &root.join(".hive/backups").join(&snapshot.id)).expect("restore drawing");
        assert_eq!(fs::read(&tile).unwrap(), b"original drawing bytes");
        fs::remove_file(&tile).expect("remove listed tile");
        assert!(check_project_health_at(&root).findings.iter().any(|finding| finding == "Missing drawing tile: -1:2"));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn listing_snapshots_does_not_read_attachment_contents_but_restore_still_verifies_them() {
        let root = project("cheap-listing");
        let file = write_attachment(&root, b"original video bytes");
        let snapshot = create_backup_at(&root).expect("create snapshot");
        let pooled = root.join(".hive/backups/attachments-pool").join(&file);
        // Same size, different content: only a full content check can notice this.
        fs::write(&pooled, b"corrupted video bytes".get(..b"original video bytes".len()).unwrap()).expect("corrupt pooled copy");
        assert_eq!(fs::metadata(&pooled).unwrap().len(), b"original video bytes".len() as u64);

        let listing = list_backups_at(&root).expect("listing stays cheap and succeeds");
        assert_eq!(listing.backups.len(), 1);
        assert!(restore_snapshot_at(&root, &root.join(".hive/backups").join(&snapshot.id)).is_err());
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn pooled_attachment_is_collected_only_after_its_last_snapshot_is_deleted() {
        let root = project("pool-gc");
        let old_file = write_attachment(&root, b"old bytes");
        let first = create_backup_at(&root).expect("create first snapshot");
        fs::remove_file(root.join("attachments").join(&old_file)).expect("remove old attachment");
        let new_file = write_attachment(&root, b"new bytes");
        create_backup_at(&root).expect("create second snapshot");
        let pool = root.join(".hive/backups/attachments-pool");
        assert!(pool.join(&old_file).exists());
        assert!(pool.join(&new_file).exists());

        delete_backup_at(&root, &first.id).expect("delete first snapshot");

        assert!(!pool.join(&old_file).exists());
        assert!(pool.join(&new_file).exists());
        assert_eq!(list_backups_at(&root).expect("list snapshots").backups.len(), 1);
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn attachment_pool_and_restore_accept_pdf_and_video_files() {
        let root = project("media-pool");
        let attachments = root.join("attachments");
        fs::create_dir_all(&attachments).expect("create attachments folder");
        let pdf_bytes = b"%PDF-1.7 media test";
        let video_bytes = b"\0\0\0\x18ftypisomvideo test";
        let pdf = "Quarterly report (2).pdf".to_string();
        let video = format!("{}.mp4", crate::attachments::sha256_hex(video_bytes));
        fs::write(attachments.join(&pdf), pdf_bytes).expect("write PDF");
        fs::write(attachments.join(&video), video_bytes).expect("write video");
        let mut board: serde_json::Value =
            serde_json::from_slice(&fs::read(root.join("board.json")).expect("read board"))
                .expect("parse board");
        board["notes"][0]["pdfMedia"] = serde_json::json!({"file": pdf, "mime": "application/pdf", "size": pdf_bytes.len(), "kind": "pdf"});
        board["notes"][0]["videoMedia"] = serde_json::json!({"file": video, "mime": "video/mp4", "size": video_bytes.len(), "kind": "video"});
        fs::write(root.join("board.json"), serde_json::to_vec(&board).expect("encode board"))
            .expect("write board references");
        let healthy = check_project_health_at(&root);
        assert!(!healthy.findings.iter().any(|finding| finding.starts_with("Missing attachment")));

        let snapshot = create_backup_at(&root).expect("snapshot media attachments");
        let pool = root.join(".hive/backups/attachments-pool");
        let manifest = fs::read_to_string(root.join(".hive/backups").join(&snapshot.id).join("attachments.json"))
            .expect("read media manifest");
        assert!(manifest.contains(&pdf));
        assert!(manifest.contains(&video));
        assert_eq!(fs::read(pool.join(&pdf)).expect("read pooled PDF"), pdf_bytes);
        assert_eq!(fs::read(pool.join(&video)).expect("read pooled video"), video_bytes);

        fs::remove_file(attachments.join(&pdf)).expect("remove live PDF");
        fs::remove_file(attachments.join(&video)).expect("remove live video");
        let missing = check_project_health_at(&root);
        assert!(missing.findings.contains(&format!("Missing attachment {pdf}")));
        assert!(missing.findings.contains(&format!("Missing attachment {video}")));
        restore_snapshot_at(&root, &root.join(".hive/backups").join(&snapshot.id))
            .expect("restore media snapshot");
        assert_eq!(fs::read(attachments.join(pdf)).expect("restore PDF"), pdf_bytes);
        assert_eq!(fs::read(attachments.join(video)).expect("restore video"), video_bytes);
        assert!(!check_project_health_at(&root)
            .findings
            .iter()
            .any(|finding| finding.starts_with("Missing attachment")));
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn restores_a_legacy_snapshot_with_embedded_attachments() {
        let root = project("legacy-restore");
        let snapshots = root.join(".hive/backups");
        let legacy = snapshots.join("legacy-snapshot");
        fs::create_dir_all(legacy.join("notes")).expect("create legacy notes");
        fs::create_dir_all(legacy.join("attachments")).expect("create legacy attachments");
        fs::copy(root.join("board.json"), legacy.join("board.json")).expect("copy legacy index");
        fs::copy(root.join("notes/First.md"), legacy.join("notes/First.md")).expect("copy legacy note");
        fs::write(legacy.join("attachments/old-photo.bin"), b"legacy attachment").expect("write legacy attachment");
        let fingerprint = legacy_project_fingerprint(&legacy).expect("fingerprint legacy snapshot");
        let meta = serde_json::json!({ "id": "legacy-snapshot", "fingerprint": fingerprint, "noteCount": 1 });
        fs::write(legacy.join("snapshot.json"), serde_json::to_vec(&meta).expect("encode metadata")).expect("write metadata");
        fs::write(root.join("notes/First.md"), "new live note").expect("change live project");

        restore_snapshot_at(&root, &legacy).expect("restore old snapshot");

        assert_eq!(fs::read_to_string(root.join("notes/First.md")).expect("read restored note"), "original note");
        assert_eq!(fs::read(root.join("attachments/old-photo.bin")).expect("read restored attachment"), b"legacy attachment");
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

    #[test]
    fn health_check_reports_missing_board_and_inline_attachments() {
        let root = project("missing-attachments");
        let board_file = format!("{}.png", "a".repeat(64));
        let inline_file = format!("{}.jpg", "b".repeat(64));
        let board = format!(
            r#"{{"version":1,"notes":[{{"id":"image-1","name":"Photo","file":"Photo.md","x":1,"y":2,"width":30,"height":10,"type":"image","image":{{"file":"{board_file}","mime":"image/png","size":1,"naturalWidth":1,"naturalHeight":1}}}}],"links":[],"zones":[]}}"#
        );
        fs::write(root.join("board.json"), board).expect("write board with image ref");
        fs::write(root.join("notes/Photo.md"), format!("![inline](att:{inline_file})"))
            .expect("write inline image token");

        let report = check_project_health_at(&root);

        assert!(report.findings.contains(&format!("Missing attachment {board_file}")));
        assert!(report.findings.contains(&format!("Missing attachment {inline_file}")));
        fs::remove_dir_all(root).expect("remove fixture");
    }
}
