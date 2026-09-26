use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::State;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use crate::project::{active_project_root, validate_project_index_contents, ProjectState};

const INDEX_FILE_NAME: &str = "board.json";
const BACKUPS_RELATIVE_PATH: &str = ".hive/backups";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    project_bytes: u64,
    snapshot_count: u64,
    snapshot_bytes: u64,
}

#[tauri::command]
pub fn export_project(
    state: State<'_, ProjectState>,
    destination_path: String,
) -> Result<String, String> {
    let root = active_project_root(&state)?;
    let destination = PathBuf::from(destination_path);
    let destination = prepare_destination_path(&destination)?;
    write_project_archive(&root, &destination)?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn import_project_zip(zip_path: String, destination_path: String) -> Result<String, String> {
    let archive_path = PathBuf::from(zip_path);
    let destination = PathBuf::from(destination_path);
    extract_project_archive(&archive_path, &destination)
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn project_storage_stats(state: State<'_, ProjectState>) -> Result<StorageStats, String> {
    let root = active_project_root(&state)?;
    let project_bytes = directory_size(&root)
        .map_err(|error| format!("could not measure project folder: {error}"))?;
    let backups = root.join(BACKUPS_RELATIVE_PATH);
    let (snapshot_count, snapshot_bytes) = snapshot_storage(&backups)?;
    Ok(StorageStats {
        project_bytes,
        snapshot_count,
        snapshot_bytes,
    })
}

fn snapshot_storage(backups: &Path) -> Result<(u64, u64), String> {
    match fs::symlink_metadata(backups) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!("refusing to measure symbolic link snapshots folder {}", backups.display()));
        }
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Err(format!("snapshots path is not a folder: {}", backups.display())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok((0, 0)),
        Err(error) => return Err(format!("could not inspect snapshots folder: {error}")),
    }
    let entries =
        fs::read_dir(backups).map_err(|error| format!("could not read snapshots: {error}"))?;
    let mut count = 0_u64;
    let mut bytes = 0_u64;
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not read snapshot entry: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_snapshot_directory_name(&name) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(|error| {
            format!(
                "could not inspect snapshot {}: {error}",
                entry.path().display()
            )
        })?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "refusing to measure symbolic link snapshot {}",
                entry.path().display()
            ));
        }
        if !metadata.is_dir() {
            continue;
        }
        count = count.saturating_add(1);
        bytes = bytes.saturating_add(directory_size(&entry.path()).map_err(|error| {
            format!(
                "could not measure snapshot {}: {error}",
                entry.path().display()
            )
        })?);
    }
    Ok((count, bytes))
}

fn is_snapshot_directory_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.')
        && !name.starts_with('.')
        && name != ".."
}

fn prepare_destination_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "the export path has no parent folder".to_string())?;
    let parent = fs::canonicalize(parent)
        .map_err(|error| format!("could not open export folder: {error}"))?;
    let name = path
        .file_name()
        .ok_or_else(|| "the export path has no file name".to_string())?;
    Ok(parent.join(name))
}

fn write_project_archive(root: &Path, destination: &Path) -> Result<(), String> {
    if !root.join(INDEX_FILE_NAME).is_file() {
        return Err(format!("the open project has no {INDEX_FILE_NAME}"));
    }
    let temp_path = temporary_path(destination);
    let result = (|| {
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| format!("could not create export archive: {error}"))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        append_directory(&mut zip, root, root, destination, &temp_path, options)?;
        zip.finish()
            .map_err(|error| format!("could not finish export archive: {error}"))?;
        replace_file(&temp_path, destination).map_err(|error| {
            format!(
                "could not write export archive {}: {error}",
                destination.display()
            )
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn append_directory(
    zip: &mut ZipWriter<File>,
    root: &Path,
    directory: &Path,
    archive_destination: &Path,
    temporary_archive: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("could not read project data: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not read project data: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let source = entry.path();
        let relative = source
            .strip_prefix(root)
            .map_err(|error| format!("invalid project path: {error}"))?;
        if relative == Path::new(BACKUPS_RELATIVE_PATH)
            || relative.starts_with(BACKUPS_RELATIVE_PATH)
        {
            continue;
        }
        if same_path(&source, archive_destination) || same_path(&source, temporary_archive) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("could not inspect {}: {error}", source.display()))?;
        let archive_name = zip_name(relative);
        if file_type.is_symlink() {
            return Err(format!(
                "project export does not follow symbolic links: {}",
                source.display()
            ));
        }
        if file_type.is_dir() {
            zip.add_directory(format!("{archive_name}/"), options)
                .map_err(|error| format!("could not add project folder {archive_name}: {error}"))?;
            append_directory(
                zip,
                root,
                &source,
                archive_destination,
                temporary_archive,
                options,
            )?;
        } else if file_type.is_file() {
            zip.start_file(&archive_name, options)
                .map_err(|error| format!("could not add project file {archive_name}: {error}"))?;
            let mut file = File::open(&source).map_err(|error| {
                format!("could not open project file {}: {error}", source.display())
            })?;
            io::copy(&mut file, zip).map_err(|error| {
                format!("could not read project file {}: {error}", source.display())
            })?;
        } else {
            return Err(format!(
                "project contains an unsupported file: {}",
                source.display()
            ));
        }
    }
    Ok(())
}

fn extract_project_archive(archive_path: &Path, destination: &Path) -> Result<PathBuf, String> {
    let archive_path = fs::canonicalize(archive_path)
        .map_err(|error| format!("could not open import archive: {error}"))?;
    let destination = fs::canonicalize(destination)
        .map_err(|error| format!("could not open import destination folder: {error}"))?;
    if !destination.is_dir() {
        return Err("the import destination must be a folder".to_string());
    }
    if fs::read_dir(&destination)
        .map_err(|error| format!("could not read import destination folder: {error}"))?
        .next()
        .is_some()
    {
        return Err("choose an empty folder for the imported project".to_string());
    }

    let archive_file = File::open(&archive_path)
        .map_err(|error| format!("could not read import archive: {error}"))?;
    let mut archive =
        ZipArchive::new(archive_file).map_err(|error| format!("invalid zip archive: {error}"))?;
    let entries = validate_archive_entries(&mut archive)?;
    let mut index = archive
        .by_name(INDEX_FILE_NAME)
        .map_err(|_| format!("the archive must contain a root {INDEX_FILE_NAME}"))?;
    if index.is_dir() {
        return Err(format!(
            "the archive's {INDEX_FILE_NAME} entry must be a file"
        ));
    }
    let mut index_contents = Vec::new();
    index
        .read_to_end(&mut index_contents)
        .map_err(|error| format!("could not read {INDEX_FILE_NAME} from archive: {error}"))?;
    validate_project_index_contents(&index_contents)?;
    drop(index);

    let stage = create_stage_directory(&destination)?;
    let _stage_guard = RemoveDirectoryOnDrop(Some(stage.clone()));
    for (index, entry) in entries.iter().enumerate() {
        let target = stage.join(&entry.path);
        if entry.is_directory {
            fs::create_dir_all(&target).map_err(|error| {
                format!("could not create imported folder {}: {error}", entry.name)
            })?;
            continue;
        }
        let parent = target
            .parent()
            .ok_or_else(|| format!("invalid archive path {}", entry.name))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create imported folder: {error}"))?;
        let mut source = archive
            .by_index(index)
            .map_err(|error| format!("could not read archive entry {}: {error}", entry.name))?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(|error| format!("could not create imported file {}: {error}", entry.name))?;
        io::copy(&mut source, &mut output)
            .map_err(|error| format!("could not extract {}: {error}", entry.name))?;
        output
            .flush()
            .map_err(|error| format!("could not finish {}: {error}", entry.name))?;
    }

    let mut moved = Vec::<PathBuf>::new();
    let commit_result = (|| {
        let staged_entries =
            fs::read_dir(&stage).map_err(|error| format!("could not finalize import: {error}"))?;
        for entry in staged_entries {
            let entry = entry.map_err(|error| format!("could not finalize import: {error}"))?;
            let target = destination.join(entry.file_name());
            fs::rename(entry.path(), &target)
                .map_err(|error| format!("could not finish importing project: {error}"))?;
            moved.push(target);
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = commit_result {
        for path in moved.iter().rev() {
            let _ = fs::remove_dir_all(path);
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }
    Ok(destination)
}

struct ValidatedEntry {
    name: String,
    path: PathBuf,
    is_directory: bool,
}

fn validate_archive_entries(archive: &mut ZipArchive<File>) -> Result<Vec<ValidatedEntry>, String> {
    let mut entries = Vec::with_capacity(archive.len());
    let mut seen = HashMap::<String, bool>::new();
    let mut has_root_index = false;

    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("invalid zip archive: {error}"))?;
        let name = entry.name().to_string();
        let is_directory = entry.is_dir();
        if let Some(mode) = entry.unix_mode() {
            let kind = mode & 0o170000;
            if kind != 0 && kind != 0o100000 && kind != 0o040000 {
                return Err(format!(
                    "unsupported link or special file in archive: {name}"
                ));
            }
            if (kind == 0o040000) != is_directory && kind != 0 {
                return Err(format!("archive entry type is inconsistent: {name}"));
            }
        }
        let path = safe_relative_path(&name, is_directory)?;
        let key = path_key(&path);
        if seen.insert(key, is_directory).is_some() {
            return Err(format!("archive contains a duplicate path: {name}"));
        }
        if name == INDEX_FILE_NAME && !is_directory {
            has_root_index = true;
        }
        entries.push(ValidatedEntry {
            name,
            path,
            is_directory,
        });
    }

    if !has_root_index {
        return Err(format!("the archive must contain a root {INDEX_FILE_NAME}"));
    }
    for entry in &entries {
        let mut parent = entry.path.parent();
        while let Some(path) = parent {
            if !path.as_os_str().is_empty() && seen.get(&path_key(path)) == Some(&false) {
                return Err(format!("archive path is below a file: {}", entry.name));
            }
            parent = path.parent();
        }
        if !entry.is_directory {
            let prefix = format!("{}/", path_key(&entry.path));
            if seen.keys().any(|path| path.starts_with(&prefix)) {
                return Err(format!(
                    "archive file is also used as a folder: {}",
                    entry.name
                ));
            }
        }
    }
    Ok(entries)
}

fn safe_relative_path(name: &str, is_directory: bool) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.starts_with('/')
        || name.contains('\\')
        || name.contains(':')
        || name.contains('\0')
    {
        return Err(format!("unsafe path in archive: {name}"));
    }
    let trimmed = if is_directory {
        name.strip_suffix('/').unwrap_or(name)
    } else {
        name
    };
    let segments = trimmed.split('/').collect::<Vec<_>>();
    if segments.is_empty()
        || segments.iter().any(|segment| {
            segment.is_empty()
                || *segment == "."
                || *segment == ".."
                || segment.ends_with('.')
                || segment.ends_with(' ')
                || segment
                    .chars()
                    .any(|character| "<>\"|?*".contains(character))
        })
    {
        return Err(format!("unsafe path in archive: {name}"));
    }
    let mut path = PathBuf::new();
    for segment in segments {
        path.push(segment);
    }
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!("unsafe path in archive: {name}"));
    }
    Ok(path)
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/").to_lowercase()
}

fn zip_name(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(name) => Some(name.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = fs::canonicalize(left).unwrap_or_else(|_| left.to_path_buf());
    let right = fs::canonicalize(right).unwrap_or_else(|_| right.to_path_buf());
    #[cfg(windows)]
    {
        path_key(&left) == path_key(&right)
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn directory_size(path: &Path) -> io::Result<u64> {
    if !path.exists() {
        return Ok(0);
    }
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() {
        return Ok(0);
    }
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    if !metadata.is_dir() {
        return Ok(0);
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(path)? {
        total = total.saturating_add(directory_size(&entry?.path())?);
    }
    Ok(total)
}

fn temporary_path(destination: &Path) -> PathBuf {
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project.zip");
    destination.with_file_name(format!(".{name}.{}.{}.tmp", std::process::id(), counter))
}

fn create_stage_directory(destination: &Path) -> Result<PathBuf, String> {
    for _ in 0..100 {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = destination.join(format!(".hive-import-{}-{counter}", std::process::id()));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("could not prepare import folder: {error}")),
        }
    }
    Err("could not choose a temporary import folder".to_string())
}

struct RemoveDirectoryOnDrop(Option<PathBuf>);

impl Drop for RemoveDirectoryOnDrop {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = fs::remove_dir_all(path);
        }
    }
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::{extract_project_archive, write_project_archive};
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_directory(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "hive-export-{label}-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).expect("create test directory");
        path
    }

    #[test]
    fn project_archive_round_trip_includes_project_data_and_omits_backups() {
        let root = test_directory("round-trip");
        let source = root.join("source");
        let destination = root.join("imported");
        fs::create_dir_all(source.join("notes")).expect("create notes");
        fs::create_dir_all(source.join("data")).expect("create data folder");
        fs::create_dir_all(source.join(".hive/removed")).expect("create retained project data");
        fs::create_dir_all(source.join(".hive/backups/snapshot-1")).expect("create backups");
        fs::create_dir_all(&destination).expect("create destination");
        let board_index = br#"{"version":1,"notes":[],"trash":[{"id":"trash-entry"}],"archive":[{"id":"archive-entry"}]}"#;
        fs::write(source.join("board.json"), board_index).expect("write board index");
        fs::write(source.join("notes/one.md"), "note body").expect("write note body");
        fs::write(source.join("data/attachment.bin"), [0_u8, 1, 2, 255]).expect("write other data");
        fs::write(
            source.join(".hive/removed/deleted.md"),
            "retained note file",
        )
        .expect("write retained project data");
        fs::write(
            source.join(".hive/backups/snapshot-1/board.json"),
            "old snapshot",
        )
        .expect("write backup");
        let archive = root.join("project.zip");

        write_project_archive(&source, &archive).expect("export project");
        extract_project_archive(&archive, &destination).expect("import project");

        assert_eq!(
            fs::read(destination.join("board.json")).expect("read imported index"),
            board_index
        );
        assert_eq!(
            fs::read_to_string(destination.join("notes/one.md")).expect("read imported note"),
            "note body"
        );
        assert_eq!(
            fs::read(destination.join("data/attachment.bin")).expect("read imported data"),
            [0_u8, 1, 2, 255]
        );
        assert_eq!(
            fs::read_to_string(destination.join(".hive/removed/deleted.md"))
                .expect("read retained project data"),
            "retained note file"
        );
        assert!(!destination.join(".hive/backups").exists());
        fs::remove_dir_all(root).expect("remove test data");
    }

    #[test]
    fn import_rejects_zip_slip_before_writing_any_destination_files() {
        let root = test_directory("zip-slip");
        let destination = root.join("destination");
        fs::create_dir_all(&destination).expect("create destination");
        let archive_path = root.join("unsafe.zip");
        let file = fs::File::create(&archive_path).expect("create archive");
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        archive
            .start_file("board.json", options)
            .expect("add board index");
        archive
            .write_all(br#"{"version":1,"notes":[]}"#)
            .expect("write board index");
        archive
            .start_file("../outside.txt", options)
            .expect("add traversal entry");
        archive
            .write_all(b"should not escape")
            .expect("write traversal entry");
        archive.finish().expect("finish archive");
        let outside = root.join("outside.txt");

        assert!(extract_project_archive(&archive_path, &destination).is_err());
        assert!(!outside.exists());
        assert_eq!(
            fs::read_dir(&destination)
                .expect("read destination")
                .count(),
            0
        );
        fs::remove_dir_all(root).expect("remove test data");
    }
}
