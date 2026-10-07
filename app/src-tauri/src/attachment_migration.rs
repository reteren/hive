use crate::attachments;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const INDEX_FILE: &str = "board.json";
const JOURNAL_FILE: &str = ".hive/attachment-migration.json";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationJournal {
    mappings: HashMap<String, String>,
}

/// Finish an interrupted attachment rename before the board is parsed or exposed to the UI.
pub(crate) fn migrate_attachments(root: &Path) -> Result<(), String> {
    let root = fs::canonicalize(root).map_err(|error| {
        format!("could not resolve project folder for attachment migration: {error}")
    })?;
    let hive_directory = root.join(".hive");
    match fs::symlink_metadata(&hive_directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(format!(
                "refusing to inspect non-directory project path {}",
                hive_directory.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "could not inspect {}: {error}",
                hive_directory.display()
            ))
        }
    }
    let attachments_dir = attachments::ensure_attachment_directory(&root)?;
    let journal_path = root.join(JOURNAL_FILE);
    match fs::symlink_metadata(&journal_path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err("attachment migration journal is not a regular file".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "could not inspect attachment migration journal: {error}"
            ))
        }
    }
    let journal = match fs::read(&journal_path) {
        Ok(contents) => {
            let journal: MigrationJournal = serde_json::from_slice(&contents)
                .map_err(|error| format!("attachment migration journal is invalid: {error}"))?;
            validate_journal(&journal)?;
            journal
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let (index, _) = crate::board_store::read_document(&root).map_err(|error| {
                format!("could not read the board for attachment migration: {error}")
            })?;
            let mut references = Vec::new();
            collect_legacy_references(&index, "attachment", &mut HashSet::new(), &mut references);
            collect_markdown_references(&root, &mut references)?;

            let mut mappings = HashMap::new();
            let mut allocated = HashSet::new();
            for (old, name) in references {
                let source = attachments_dir.join(&old);
                if !is_regular_file(&source)? {
                    continue;
                }
                let extension = old
                    .rsplit_once('.')
                    .map(|(_, extension)| extension)
                    .unwrap_or("bin");
                let desired = attachments::readable_attachment_name(&name, Some(extension));
                let target = choose_target(&attachments_dir, &source, &desired, &allocated)?;
                allocated.insert(target.to_lowercase());
                mappings.insert(old, target);
            }
            if mappings.is_empty() {
                return Ok(());
            }
            let journal = MigrationJournal { mappings };
            write_json_atomically(&journal_path, &journal)?;
            journal
        }
        Err(error) => {
            return Err(format!(
                "could not inspect attachment migration journal: {error}"
            ))
        }
    };

    for (old, new) in &journal.mappings {
        let source = attachments_dir.join(old);
        let target = attachments_dir.join(new);
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                return Err(format!(
                    "attachment migration target {new} is not a regular file"
                ));
            }
            Ok(_) => {
                if is_regular_file(&source)? && !files_equal(&source, &target)? {
                    return Err(format!(
                        "attachment migration target {new} conflicts with {old}"
                    ));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if is_regular_file(&source)? {
                    install_copy(&source, &target)?;
                } else {
                    return Err(format!("attachment migration lost both {old} and {new}"));
                }
            }
            Err(error) => return Err(format!("could not inspect migration target {new}: {error}")),
        }
    }

    let index_path = root.join(INDEX_FILE);
    let (mut index, _) = crate::board_store::read_document(&root)?;
    if rewrite_json(&mut index, &journal.mappings) {
        if crate::board_store::is_legacy(&root)? {
            let contents = serde_json::to_vec_pretty(&index)
                .map_err(|error| format!("could not encode board.json: {error}"))?;
            write_atomically(&index_path, &contents)?;
        } else {
            let plan = crate::board_store::plan_write(&root, &index, None)?;
            crate::board_store::apply_plan(&plan)?;
        }
    }

    let mut markdown_files = Vec::new();
    collect_project_markdown_files(&root, &mut markdown_files)?;
    for path in markdown_files {
        let contents = fs::read(&path)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        let text = String::from_utf8(contents)
            .map_err(|error| format!("{} is not valid UTF-8: {error}", path.display()))?;
        let rewritten = rewrite_inline_tokens(&text, &journal.mappings);
        if rewritten != text {
            write_atomically(&path, rewritten.as_bytes())?;
        }
    }

    let mut pending_deletes = false;
    for old in journal.mappings.keys() {
        let path = attachments_dir.join(old);
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            // The new copy is already installed and every reference rewrite succeeded. A player
            // may still hold the old file without delete sharing, so retry cleanup on the next
            // open while allowing this project to open with its valid new references.
            Err(_) => pending_deletes = true,
        }
    }
    if pending_deletes {
        return Ok(());
    }
    fs::remove_file(&journal_path)
        .map_err(|error| format!("could not clear attachment migration journal: {error}"))?;
    Ok(())
}

fn validate_journal(journal: &MigrationJournal) -> Result<(), String> {
    for (old, new) in &journal.mappings {
        if !attachments::is_legacy_hash_attachment(old) {
            return Err(
                "attachment migration journal contains an invalid old file name".to_string(),
            );
        }
        attachments::validate_attachment_filename(new)?;
    }
    Ok(())
}

fn collect_legacy_references(
    value: &Value,
    inherited_kind: &str,
    seen: &mut HashSet<String>,
    output: &mut Vec<(String, String)>,
) {
    match value {
        Value::Object(object) => {
            let kind = object
                .get("kind")
                .or_else(|| object.get("type"))
                .and_then(Value::as_str)
                .unwrap_or(inherited_kind);
            if let Some(file) = object.get("file").and_then(Value::as_str) {
                if attachments::is_legacy_hash_attachment(file) && seen.insert(file.to_string()) {
                    let name = object
                        .get("name")
                        .and_then(Value::as_str)
                        .filter(|name| !name.trim().is_empty())
                        .map(str::to_owned)
                        .unwrap_or_else(|| {
                            format!(
                                "{} {}.{}",
                                kind_label(kind),
                                seen.len(),
                                file.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("bin")
                            )
                        });
                    output.push((file.to_string(), name));
                }
            }
            for child in object.values() {
                collect_legacy_references(child, kind, seen, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_legacy_references(item, inherited_kind, seen, output);
            }
        }
        _ => {}
    }
}

fn kind_label(kind: &str) -> &str {
    match kind.to_ascii_lowercase().as_str() {
        "image" => "Image",
        "video" => "Video",
        "audio" => "Audio",
        "pdf" => "PDF",
        "text" | "format" => "Text",
        _ => "Attachment",
    }
}

fn collect_markdown_references(
    root: &Path,
    output: &mut Vec<(String, String)>,
) -> Result<(), String> {
    let mut files = Vec::new();
    collect_project_markdown_files(root, &mut files)?;
    let mut seen = output
        .iter()
        .map(|(old, _)| old.clone())
        .collect::<HashSet<_>>();
    for path in files {
        let contents = fs::read_to_string(&path)
            .map_err(|error| format!("could not read {}: {error}", path.display()))?;
        let mut remaining = contents.as_str();
        while let Some(index) = remaining.find("att:") {
            let token = &remaining[index + 4..];
            let end = token
                .find(|character: char| {
                    character == ')' || character == '}' || character.is_whitespace()
                })
                .unwrap_or(token.len());
            let filename = &token[..end];
            if attachments::is_legacy_hash_attachment(filename) && seen.insert(filename.to_string())
            {
                let count = seen.len();
                let extension = filename
                    .rsplit_once('.')
                    .map(|(_, extension)| extension)
                    .unwrap_or("bin");
                output.push((filename.to_string(), format!("Image {count}.{extension}")));
            }
            remaining = &token[end..];
            if remaining.is_empty() {
                break;
            }
        }
    }
    Ok(())
}

fn collect_project_markdown_files(root: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    collect_markdown_files(&root.join("notes"), output)?;
    let hive_directory = root.join(".hive");
    match fs::symlink_metadata(&hive_directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(format!(
                "refusing to inspect non-directory project path {}",
                hive_directory.display()
            ));
        }
        Ok(_) => collect_markdown_files(&hive_directory.join("removed"), output),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "could not inspect {}: {error}",
            hive_directory.display()
        )),
    }
}

fn collect_markdown_files(directory: &Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(format!(
                "refusing to inspect non-directory project path {}",
                directory.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "could not inspect {}: {error}",
                directory.display()
            ))
        }
    }
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "could not inspect {}: {error}",
                directory.display()
            ))
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| format!("could not inspect project file: {error}"))?;
        let kind = entry
            .file_type()
            .map_err(|error| format!("could not inspect {}: {error}", entry.path().display()))?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            collect_markdown_files(&entry.path(), output)?;
        } else if kind.is_file()
            && entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
        {
            output.push(entry.path());
        }
    }
    Ok(())
}

fn choose_target(
    directory: &Path,
    source: &Path,
    desired: &str,
    allocated: &HashSet<String>,
) -> Result<String, String> {
    for collision in 1..=100_000 {
        let candidate = attachments::attachment_name_with_collision(desired, collision);
        attachments::validate_attachment_filename(&candidate)?;
        if source
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case(&candidate))
        {
            continue;
        }
        if allocated.contains(&candidate.to_lowercase()) {
            continue;
        }
        let existing = find_case_insensitive(directory, &candidate)?;
        if let Some(existing) = existing {
            if !is_regular_file(&directory.join(&existing))? {
                return Err(format!(
                    "attachment migration target {existing} is not a regular file"
                ));
            }
            if files_equal(source, &directory.join(&existing))? {
                return Ok(existing);
            }
            continue;
        }
        return Ok(candidate);
    }
    Err("could not choose a unique attachment file name during migration".to_string())
}

fn find_case_insensitive(directory: &Path, filename: &str) -> Result<Option<String>, String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("could not inspect attachments folder: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("could not inspect attachments folder: {error}"))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.to_lowercase() == filename.to_lowercase() {
            return Ok(Some(name));
        }
    }
    Ok(None)
}

fn is_regular_file(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.is_file() && !metadata.file_type().is_symlink()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not inspect {}: {error}", path.display())),
    }
}

fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let left_meta = fs::metadata(left)
        .map_err(|error| format!("could not inspect {}: {error}", left.display()))?;
    let right_meta = fs::metadata(right)
        .map_err(|error| format!("could not inspect {}: {error}", right.display()))?;
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    let mut left = fs::File::open(left)
        .map_err(|error| format!("could not read migrated attachment: {error}"))?;
    let mut right = fs::File::open(right)
        .map_err(|error| format!("could not read existing attachment: {error}"))?;
    let mut left_buffer = [0_u8; 64 * 1024];
    let mut right_buffer = [0_u8; 64 * 1024];
    loop {
        let left_count = left
            .read(&mut left_buffer)
            .map_err(|error| format!("could not read migrated attachment: {error}"))?;
        let right_count = right
            .read(&mut right_buffer)
            .map_err(|error| format!("could not read existing attachment: {error}"))?;
        if left_count != right_count || left_buffer[..left_count] != right_buffer[..right_count] {
            return Ok(false);
        }
        if left_count == 0 {
            return Ok(true);
        }
    }
}

fn install_copy(source: &Path, target: &Path) -> Result<(), String> {
    let temp = target.with_file_name(format!(
        ".{}.{}.{}.migration.tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("attachment"),
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut input = fs::File::open(source)
            .map_err(|error| format!("could not read old attachment: {error}"))?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("could not stage attachment migration: {error}"))?;
        io::copy(&mut input, &mut output)
            .map_err(|error| format!("could not copy old attachment: {error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("could not finish attachment copy: {error}"))?;
        drop(output);
        match fs::hard_link(&temp, target) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if is_regular_file(target)? && files_equal(source, target)? {
                    Ok(())
                } else {
                    Err(format!(
                        "readable attachment target {} conflicts with the old file",
                        target.display()
                    ))
                }
            }
            Err(error) => Err(format!("could not install readable attachment: {error}")),
        }
    })();
    let _ = fs::remove_file(temp);
    result
}

fn rewrite_json(value: &mut Value, mappings: &HashMap<String, String>) -> bool {
    match value {
        Value::Object(object) => {
            let mut changed = false;
            if let Some(Value::String(file)) = object.get_mut("file") {
                if let Some(new) = mappings.get(file) {
                    *file = new.clone();
                    changed = true;
                }
            }
            for child in object.values_mut() {
                changed |= rewrite_json(child, mappings);
            }
            changed
        }
        Value::Array(items) => items.iter_mut().fold(false, |changed, item| {
            rewrite_json(item, mappings) || changed
        }),
        Value::String(text) => {
            let rewritten = rewrite_inline_tokens(text, mappings);
            if rewritten != *text {
                *text = rewritten;
                true
            } else {
                false
            }
        }
        _ => false,
    }
}

fn rewrite_inline_tokens(text: &str, mappings: &HashMap<String, String>) -> String {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(relative) = text[cursor..].find("att:") {
        let start = cursor + relative;
        let token_start = start + 4;
        let bytes = text.as_bytes();
        let mut end = token_start;
        while end < bytes.len()
            && !bytes[end].is_ascii_whitespace()
            && bytes[end] != b')'
            && bytes[end] != b'}'
            && bytes[end] != b'\r'
            && bytes[end] != b'\n'
        {
            end += 1;
        }
        output.push_str(&text[cursor..token_start]);
        let token = &text[token_start..end];
        if let Some(new) = mappings.get(token) {
            output.push_str(&encode_token(new));
        } else {
            output.push_str(token);
        }
        cursor = end;
    }
    output.push_str(&text[cursor..]);
    output
}

fn encode_token(value: &str) -> String {
    let mut output = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'-' | b'_' | b'.' | b'~') {
            output.push(*byte as char);
        } else {
            output.push_str(&format!("%{byte:02X}"));
        }
    }
    output
}

fn write_json_atomically<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("could not encode migration journal: {error}"))?;
    write_atomically(path, &bytes)
}

fn write_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "project file has no parent folder".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create project folder: {error}"))?;
    let temp = path.with_file_name(format!(
        ".{}.{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("project-file"),
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("could not stage project file update: {error}"))?;
        file.write_all(contents)
            .map_err(|error| format!("could not write project file update: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("could not finish project file update: {error}"))?;
        drop(file);
        replace_file(&temp, path)
            .map_err(|error| format!("could not atomically update {}: {error}", path.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
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
    use super::{install_copy, migrate_attachments, MigrationJournal};
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_ID: AtomicU64 = AtomicU64::new(0);

    fn project(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "hive-attachment-migration-{label}-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(path.join("attachments")).unwrap();
        fs::create_dir_all(path.join("notes")).unwrap();
        fs::create_dir_all(path.join(".hive/removed")).unwrap();
        path
    }

    #[test]
    fn migrates_board_trash_archive_and_inline_markdown_idempotently() {
        let root = project("complete");
        let old = format!("{}.png", "a".repeat(64));
        fs::write(root.join("attachments").join(&old), b"image").unwrap();
        fs::write(root.join("board.json"), format!(r#"{{"notes":[{{"type":"image","name":"photo.png","image":{{"file":"{old}","name":"photo.png","mime":"image/png","size":5,"naturalWidth":1,"naturalHeight":1}}}}],"trash":[{{"media":{{"file":"{old}","name":"photo.png","mime":"image/png","size":5,"kind":"image"}}}}],"archive":[{{"image":{{"file":"{old}","name":"photo.png","mime":"image/png","size":5,"kind":"image"}}}}]}}"#)).unwrap();
        fs::write(root.join("notes/one.md"), format!("![photo](att:{old})")).unwrap();
        fs::write(
            root.join(".hive/removed/deleted.md"),
            format!("![old](att:{old})"),
        )
        .unwrap();

        migrate_attachments(&root).unwrap();
        migrate_attachments(&root).unwrap();

        let index = fs::read_to_string(root.join("board.json")).unwrap();
        assert!(index.matches("photo.png").count() >= 3);
        assert!(!index.contains(&old));
        assert_eq!(
            fs::read(root.join("attachments/photo.png")).unwrap(),
            b"image"
        );
        assert!(!root.join("attachments").join(old).exists());
        assert_eq!(
            fs::read_to_string(root.join("notes/one.md")).unwrap(),
            "![photo](att:photo.png)"
        );
        assert_eq!(
            fs::read_to_string(root.join(".hive/removed/deleted.md")).unwrap(),
            "![old](att:photo.png)"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resumes_after_target_copy_before_reference_rewrite() {
        let root = project("resume");
        let old = format!("{}.pdf", "b".repeat(64));
        let new = "report.pdf".to_string();
        fs::write(root.join("attachments").join(&old), b"pdf bytes").unwrap();
        fs::hard_link(
            root.join("attachments").join(&old),
            root.join("attachments").join(&new),
        )
        .unwrap();
        fs::write(root.join("board.json"), format!(r#"{{"notes":[],"trash":[{{"media":{{"file":"{old}","name":"report.pdf","mime":"application/pdf","size":9,"kind":"pdf"}}}}]}}"#)).unwrap();
        let journal = MigrationJournal {
            mappings: HashMap::from([(old.clone(), new.clone())]),
        };
        fs::create_dir_all(root.join(".hive")).unwrap();
        fs::write(
            root.join(".hive/attachment-migration.json"),
            serde_json::to_vec(&journal).unwrap(),
        )
        .unwrap();

        migrate_attachments(&root).unwrap();

        assert!(fs::read_to_string(root.join("board.json"))
            .unwrap()
            .contains("report.pdf"));
        assert!(!root.join("attachments").join(old).exists());
        assert!(root.join("attachments").join(new).exists());
        assert!(!root.join(".hive/attachment-migration.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preserves_empty_inline_tokens_while_rewriting_legacy_references() {
        let root = project("empty-inline-token");
        let old = format!("{}.png", "c".repeat(64));
        fs::write(root.join("attachments").join(&old), b"image").unwrap();
        fs::write(
            root.join("board.json"),
            format!(r#"{{"notes":[{{"type":"image","name":"photo.png","image":{{"file":"{old}","name":"photo.png","mime":"image/png","size":5,"naturalWidth":1,"naturalHeight":1}}}}],"description":"literal att:"}}"#),
        )
        .unwrap();
        let markdown = format!("![photo](att:{old})\nraw att:\n![empty](att:)\n");
        fs::write(root.join("notes/one.md"), &markdown).unwrap();

        migrate_attachments(&root).unwrap();

        let index = fs::read_to_string(root.join("board.json")).unwrap();
        assert!(index.contains("literal att:"));
        assert!(fs::read_to_string(root.join("notes/one.md"))
            .unwrap()
            .contains("raw att:\n![empty](att:)\n"));
        assert!(!root.join("attachments").join(old).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn allocates_a_suffix_for_unicode_case_collisions() {
        let root = project("unicode-case-collision");
        let old = format!("{}.png", "e".repeat(64));
        fs::write(root.join("attachments").join(&old), b"migrated image").unwrap();
        fs::write(root.join("attachments/ПОРТРЕТ.png"), b"existing image").unwrap();
        fs::write(
            root.join("board.json"),
            format!(r#"{{"notes":[{{"type":"image","image":{{"file":"{old}","name":"портрет.png","mime":"image/png","size":14,"naturalWidth":1,"naturalHeight":1}}}}]}}"#),
        )
        .unwrap();

        migrate_attachments(&root).unwrap();

        let index = fs::read_to_string(root.join("board.json")).unwrap();
        assert!(index.contains("портрет (2).png"));
        assert_eq!(
            fs::read(root.join("attachments/портрет (2).png")).unwrap(),
            b"migrated image"
        );
        assert_eq!(
            fs::read(root.join("attachments/ПОРТРЕТ.png")).unwrap(),
            b"existing image"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_a_readable_target_that_appears_with_different_contents() {
        let root = project("target-race");
        let source = root.join("attachments/old-hash.png");
        let target = root.join("attachments/photo.png");
        fs::write(&source, b"old attachment bytes").unwrap();
        fs::write(&target, b"different target bytes").unwrap();

        assert!(install_copy(&source, &target).is_err());
        assert_eq!(fs::read(&source).unwrap(), b"old attachment bytes");
        assert_eq!(fs::read(&target).unwrap(), b"different target bytes");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn keeps_journal_and_opens_when_old_attachment_cannot_be_deleted_yet() {
        use std::fs::OpenOptions;
        use std::os::windows::fs::OpenOptionsExt;

        let root = project("locked-old-file");
        let old = format!("{}.mp4", "d".repeat(64));
        let old_path = root.join("attachments").join(&old);
        fs::write(&old_path, b"video").unwrap();
        fs::write(
            root.join("board.json"),
            format!(r#"{{"notes":[{{"kind":"video","media":{{"file":"{old}","name":"clip.mp4","mime":"video/mp4","size":5,"kind":"video"}}}}]}}"#),
        )
        .unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(0x1) // FILE_SHARE_READ, deliberately excluding FILE_SHARE_DELETE
            .open(&old_path)
            .unwrap();

        migrate_attachments(&root).unwrap();
        assert!(old_path.exists());
        assert!(root.join("attachments/clip.mp4").exists());
        assert!(root.join(".hive/attachment-migration.json").exists());

        drop(lock);
        migrate_attachments(&root).unwrap();
        assert!(!old_path.exists());
        assert!(!root.join(".hive/attachment-migration.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}

