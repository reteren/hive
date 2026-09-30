use crate::project::{self, ProjectState};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, State};

const ATTACHMENTS_DIRECTORY: &str = "attachments";
const MAX_ATTACHMENT_BYTES: u64 = 200 * 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static ASSET_DIRECTORIES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentImport {
    pub file: String,
    pub mime: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ImageFormat {
    extension: &'static str,
    mime: &'static str,
}

const PNG: ImageFormat = ImageFormat {
    extension: "png",
    mime: "image/png",
};
const JPEG: ImageFormat = ImageFormat {
    extension: "jpg",
    mime: "image/jpeg",
};
const GIF: ImageFormat = ImageFormat {
    extension: "gif",
    mime: "image/gif",
};
const WEBP: ImageFormat = ImageFormat {
    extension: "webp",
    mime: "image/webp",
};
const BMP: ImageFormat = ImageFormat {
    extension: "bmp",
    mime: "image/bmp",
};

#[tauri::command]
pub fn attachment_import_bytes(
    state: State<'_, ProjectState>,
    bytes: Vec<u8>,
    name: Option<String>,
    mime: Option<String>,
) -> Result<AttachmentImport, String> {
    let root = project::active_project_root(&state)?;
    let _ = mime;
    import_bytes_at(&root, &bytes, name.as_deref())
}

#[tauri::command]
pub fn attachment_import_path(
    state: State<'_, ProjectState>,
    path: String,
) -> Result<AttachmentImport, String> {
    let root = project::active_project_root(&state)?;
    import_path_at(&root, Path::new(&path))
}

#[tauri::command]
pub fn attachment_directory(state: State<'_, ProjectState>) -> Result<String, String> {
    let root = project::active_project_root(&state)?;
    ensure_attachment_directory(&root).map(|path| path.to_string_lossy().into_owned())
}

pub(crate) fn ensure_attachment_directory(root: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("could not resolve project folder: {error}"))?;
    let directory = root.join(ATTACHMENTS_DIRECTORY);
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(format!(
                "refusing non-directory or symbolic link {}",
                directory.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(&directory)
                .map_err(|error| format!("could not create attachments folder: {error}"))?;
        }
        Err(error) => return Err(format!("could not inspect attachments folder: {error}")),
    }
    Ok(directory)
}

pub(crate) fn refresh_asset_protocol_scope(
    app: &AppHandle,
    project_root: &Path,
) -> Result<(), String> {
    let directory = ensure_attachment_directory(project_root)?;
    let allowed = ASSET_DIRECTORIES.get_or_init(|| Mutex::new(HashSet::new()));
    let mut allowed = allowed
        .lock()
        .map_err(|_| "asset protocol scope is unavailable")?;
    if !allowed.contains(&directory) {
        // Tauri's protocol scope is additive and cannot un-forbid paths. Keep each session-opened
        // project attachment folder allowed so users can switch back to it and still see images.
        app.asset_protocol_scope()
            .allow_directory(&directory, false)
            .map_err(|error| format!("could not allow project attachments: {error}"))?;
        allowed.insert(directory);
    }
    Ok(())
}

fn import_path_at(root: &Path, source: &Path) -> Result<AttachmentImport, String> {
    let metadata =
        fs::metadata(source).map_err(|error| format!("could not read image file: {error}"))?;
    if !metadata.is_file() {
        return Err("The selected image path is not a regular file.".to_string());
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES {
        return Err("Image exceeds the 200 MB limit.".to_string());
    }
    let bytes = fs::read(source).map_err(|error| format!("could not read image file: {error}"))?;
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err("Image exceeds the 200 MB limit.".to_string());
    }
    let name = source.file_name().and_then(|value| value.to_str());
    import_bytes_at(root, &bytes, name)
}

fn import_bytes_at(
    root: &Path,
    bytes: &[u8],
    name: Option<&str>,
) -> Result<AttachmentImport, String> {
    if bytes.len() as u64 > MAX_ATTACHMENT_BYTES {
        return Err("Image exceeds the 200 MB limit.".to_string());
    }
    let format = detect_format(bytes).ok_or_else(|| unsupported_file_type(name))?;
    let hash = sha256_hex(bytes);
    let filename = format!("{hash}.{}", format.extension);
    validate_attachment_filename(&filename)?;
    let directory = ensure_attachment_directory(root)?;
    let target = directory.join(&filename);

    if fs::symlink_metadata(&target).is_ok() {
        verify_existing_attachment(&target, &hash)?;
    } else {
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temporary = directory.join(format!(".{filename}.{}.{counter}.tmp", std::process::id()));
        let write_result = (|| {
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|error| format!("could not create temporary attachment: {error}"))?;
            output
                .write_all(bytes)
                .map_err(|error| format!("could not write attachment: {error}"))?;
            output
                .sync_all()
                .map_err(|error| format!("could not finish attachment: {error}"))?;
            drop(output);
            match fs::hard_link(&temporary, &target) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                    verify_existing_attachment(&target, &hash)
                }
                Err(error) => Err(format!("could not install attachment atomically: {error}")),
            }
        })();
        let _ = fs::remove_file(&temporary);
        write_result?;
    }

    let size = fs::symlink_metadata(&target)
        .map_err(|error| format!("could not inspect stored attachment: {error}"))?
        .len();
    Ok(AttachmentImport {
        file: filename,
        mime: format.mime.to_string(),
        size,
        name: display_name(name),
    })
}

pub(crate) fn verify_existing_attachment(path: &Path, expected_hash: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect stored attachment: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("stored attachment is not a regular file".to_string());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("could not verify stored attachment: {error}"))?;
    if sha256_hex(&bytes) != expected_hash {
        return Err("stored attachment content does not match its name".to_string());
    }
    Ok(())
}

pub(crate) fn validate_attachment_filename(file: &str) -> Result<(), String> {
    let Some((hash, extension)) = file.rsplit_once('.') else {
        return Err("attachment file name is invalid".to_string());
    };
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        || !matches!(extension, "png" | "jpg" | "gif" | "webp" | "bmp")
    {
        return Err("attachment file name is invalid".to_string());
    }
    Ok(())
}

fn detect_format(bytes: &[u8]) -> Option<ImageFormat> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(PNG);
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some(JPEG);
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some(GIF);
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some(WEBP);
    }
    if bytes.starts_with(b"BM") {
        return Some(BMP);
    }
    None
}

fn unsupported_file_type(name: Option<&str>) -> String {
    let extension = name
        .and_then(|name| Path::new(name).extension())
        .and_then(|extension| extension.to_str())
        .filter(|extension| !extension.is_empty())
        .unwrap_or("unknown");
    format!(
        "Unsupported file type: {}. Supported: PNG, JPEG, GIF, WebP, BMP",
        extension.to_lowercase()
    )
}

fn display_name(name: Option<&str>) -> Option<String> {
    name.and_then(|name| Path::new(name).file_name())
        .and_then(|name| name.to_str())
        .map(|name| {
            name.chars()
                .filter(|character| !character.is_control())
                .take(255)
                .collect::<String>()
        })
        .filter(|name| !name.trim().is_empty())
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::{detect_format, import_bytes_at, validate_attachment_filename};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "hive-attachments-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn detects_the_supported_image_magic_bytes() {
        assert_eq!(detect_format(b"\x89PNG\r\n\x1a\nrest"), Some(super::PNG));
        assert_eq!(detect_format(&[0xff, 0xd8, 0xff, 0]), Some(super::JPEG));
        assert_eq!(detect_format(b"GIF89a"), Some(super::GIF));
        assert_eq!(detect_format(b"RIFFxxxxWEBP"), Some(super::WEBP));
        assert_eq!(detect_format(b"BMxx"), Some(super::BMP));
        assert_eq!(detect_format(b"<svg/>"), None);
    }

    #[test]
    fn importing_identical_bytes_reuses_one_content_addressed_file() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create project root");
        let bytes = b"\x89PNG\r\n\x1a\nsmall image";
        let first = import_bytes_at(&root, bytes, Some("first.png")).expect("import first");
        let second = import_bytes_at(&root, bytes, Some("second.png")).expect("import duplicate");
        assert_eq!(first.file, second.file);
        assert_ne!(first.name, second.name);
        assert_eq!(
            fs::read(root.join("attachments").join(&first.file)).expect("read stored"),
            bytes
        );
        assert_eq!(
            fs::read_dir(root.join("attachments"))
                .expect("list attachments")
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn rejects_invalid_attachment_names_before_path_use() {
        for name in [
            "../escape.png",
            "..\\escape.png",
            "short.png",
            &format!("{}.svg", "a".repeat(64)),
            &format!("{}.PNG", "a".repeat(64)),
        ] {
            assert!(
                validate_attachment_filename(name).is_err(),
                "accepted {name}"
            );
        }
        assert!(validate_attachment_filename(&format!("{}.png", "a".repeat(64))).is_ok());
    }

    #[test]
    fn refuses_a_symlink_attachments_directory() {
        let root = test_root();
        let outside = root.with_extension("outside");
        fs::create_dir_all(&root).expect("create root");
        fs::create_dir_all(&outside).expect("create outside");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&outside, root.join("attachments")).expect("create link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, root.join("attachments")).expect("create link");
        assert!(import_bytes_at(&root, b"\x89PNG\r\n\x1a\nsmall", None).is_err());
        assert_eq!(fs::read_dir(&outside).expect("list outside").count(), 0);
        fs::remove_dir_all(root).expect("remove root");
        fs::remove_dir_all(outside).expect("remove outside");
    }
}
