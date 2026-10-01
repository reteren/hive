use crate::project::{self, ProjectState};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager, State};

const ATTACHMENTS_DIRECTORY: &str = "attachments";
const MAX_SMALL_ATTACHMENT_BYTES: u64 = 200 * 1024 * 1024;
const MAX_LARGE_MEDIA_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const STREAM_BUFFER_BYTES: usize = 64 * 1024;
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
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

#[derive(Clone, Debug, PartialEq, Eq)]
struct MediaDescriptor {
    kind: &'static str,
    extension: String,
    mime: &'static str,
    limit: u64,
}

impl MediaDescriptor {
    fn image(format: ImageFormat) -> Self {
        Self {
            kind: "image",
            extension: format.extension.to_string(),
            mime: format.mime,
            limit: MAX_SMALL_ATTACHMENT_BYTES,
        }
    }

    fn text(extension: &str) -> Result<Self, String> {
        if !is_text_extension(extension) {
            return Err("The text file extension is not supported.".to_string());
        }
        Ok(Self {
            kind: "text",
            extension: extension.to_string(),
            mime: if extension == "json" {
                "application/json"
            } else {
                "text/plain"
            },
            limit: MAX_SMALL_ATTACHMENT_BYTES,
        })
    }

    fn audio(extension: &str, mime: &'static str) -> Self {
        Self {
            kind: "audio",
            extension: extension.to_string(),
            mime,
            limit: MAX_LARGE_MEDIA_BYTES,
        }
    }

    fn video(extension: &str, mime: &'static str) -> Self {
        Self {
            kind: "video",
            extension: extension.to_string(),
            mime,
            limit: MAX_LARGE_MEDIA_BYTES,
        }
    }

    fn pdf() -> Self {
        Self {
            kind: "pdf",
            extension: "pdf".to_string(),
            mime: "application/pdf",
            limit: MAX_SMALL_ATTACHMENT_BYTES,
        }
    }
}

#[tauri::command]
pub fn attachment_import_bytes(
    state: State<'_, ProjectState>,
    bytes: Vec<u8>,
    name: Option<String>,
    mime: Option<String>,
    kind_hint: Option<String>,
) -> Result<AttachmentImport, String> {
    let root = project::active_project_root(&state)?;
    import_supported_bytes(
        &root,
        &bytes,
        name.as_deref(),
        mime.as_deref(),
        kind_hint.as_deref(),
    )
}

#[tauri::command]
pub fn attachment_import_path(
    state: State<'_, ProjectState>,
    path: String,
    kind_hint: Option<String>,
) -> Result<AttachmentImport, String> {
    let root = project::active_project_root(&state)?;
    import_path_at(&root, Path::new(&path), kind_hint.as_deref())
}

#[tauri::command]
pub fn attachment_directory(state: State<'_, ProjectState>) -> Result<String, String> {
    let root = project::active_project_root(&state)?;
    ensure_attachment_directory(&root).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn attachment_write_text(
    state: State<'_, ProjectState>,
    text: String,
    extension: String,
    name: String,
) -> Result<AttachmentImport, String> {
    let root = project::active_project_root(&state)?;
    let extension = extension.to_ascii_lowercase();
    if !is_text_extension(&extension) {
        return Err("The text file extension is not supported.".to_string());
    }
    let bytes = text.as_bytes();
    let descriptor = MediaDescriptor::text(&extension)?;
    check_size(bytes.len() as u64, &descriptor)?;
    store_bytes_at(&root, bytes, Some(&name), descriptor)
}

#[tauri::command]
pub fn attachment_export(
    state: State<'_, ProjectState>,
    file: String,
    destination: String,
) -> Result<(), String> {
    validate_attachment_filename(&file)?;
    if destination.trim().is_empty() {
        return Err("The export destination is empty.".to_string());
    }
    let root = project::active_project_root(&state)?;
    let source = ensure_attachment_directory(&root)?.join(file);
    ensure_regular_attachment(&source)?;
    let destination = PathBuf::from(destination);
    if destination == source {
        return Err("The export destination cannot replace the project attachment.".to_string());
    }
    fs::copy(&source, &destination)
        .map(|_| ())
        .map_err(|error| format!("could not export attachment: {error}"))
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

fn import_path_at(
    root: &Path,
    source: &Path,
    kind_hint: Option<&str>,
) -> Result<AttachmentImport, String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("could not read selected file: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("The selected path is not a regular file.".to_string());
    }
    let name = source.file_name().and_then(|value| value.to_str());
    let mut input =
        File::open(source).map_err(|error| format!("could not open selected file: {error}"))?;
    let mut prefix = [0_u8; 64];
    let prefix_len = input
        .read(&mut prefix)
        .map_err(|error| format!("could not read selected file: {error}"))?;
    input
        .seek(SeekFrom::Start(0))
        .map_err(|error| format!("could not seek selected file: {error}"))?;
    let descriptor = detect_media_descriptor(&prefix[..prefix_len], name, None, kind_hint)?;
    check_size(metadata.len(), &descriptor)?;

    let directory = ensure_attachment_directory(root)?;
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = directory.join(format!(".import.{}.{}.tmp", std::process::id(), counter));
    let result = (|| {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("could not create temporary attachment: {error}"))?;
        let mut hasher = Sha256::new();
        let mut total = 0_u64;
        let mut text_validator = (descriptor.kind == "text").then(Utf8StreamValidator::default);
        let mut buffer = [0_u8; STREAM_BUFFER_BYTES];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|error| format!("could not read selected file: {error}"))?;
            if count == 0 {
                break;
            }
            let chunk = &buffer[..count];
            total = total.saturating_add(count as u64);
            check_size(total, &descriptor)?;
            if let Some(validator) = text_validator.as_mut() {
                if !validator.push(chunk) {
                    return Err("Text file is not valid UTF-8.".to_string());
                }
            }
            hasher.update(chunk);
            output
                .write_all(chunk)
                .map_err(|error| format!("could not write temporary attachment: {error}"))?;
        }
        if text_validator.is_some_and(|validator| !validator.finish()) {
            return Err("Text file is not valid UTF-8.".to_string());
        }
        output
            .sync_all()
            .map_err(|error| format!("could not finish temporary attachment: {error}"))?;
        drop(output);
        let hash = digest_hex(hasher.finalize());
        install_temporary(&temporary, &directory, &hash, &descriptor)?;
        Ok(attachment_result(&hash, name, &descriptor, total))
    })();
    let _ = fs::remove_file(&temporary);
    result
}

fn import_supported_bytes(
    root: &Path,
    bytes: &[u8],
    name: Option<&str>,
    mime_hint: Option<&str>,
    kind_hint: Option<&str>,
) -> Result<AttachmentImport, String> {
    let descriptor = detect_media_descriptor(bytes, name, mime_hint, kind_hint)?;
    check_size(bytes.len() as u64, &descriptor)?;
    if descriptor.kind == "text" && std::str::from_utf8(bytes).is_err() {
        return Err("Text file is not valid UTF-8.".to_string());
    }
    store_bytes_at(root, bytes, name, descriptor)
}

#[cfg(test)]
fn import_bytes_at(
    root: &Path,
    bytes: &[u8],
    name: Option<&str>,
) -> Result<AttachmentImport, String> {
    let format = detect_format(bytes).ok_or_else(|| unsupported_file_type(name))?;
    store_bytes_at(root, bytes, name, MediaDescriptor::image(format))
}

fn store_bytes_at(
    root: &Path,
    bytes: &[u8],
    name: Option<&str>,
    descriptor: MediaDescriptor,
) -> Result<AttachmentImport, String> {
    if bytes.len() as u64 > descriptor.limit {
        return Err(limit_error(&descriptor));
    }
    let directory = ensure_attachment_directory(root)?;
    let hash = sha256_hex(bytes);
    let temporary = write_temporary(&directory, bytes)?;
    let result = install_temporary(&temporary, &directory, &hash, &descriptor);
    let _ = fs::remove_file(&temporary);
    result?;
    Ok(attachment_result(
        &hash,
        name,
        &descriptor,
        bytes.len() as u64,
    ))
}

fn write_temporary(directory: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = directory.join(format!(".import.{}.{}.tmp", std::process::id(), counter));
    let result = (|| {
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("could not create temporary attachment: {error}"))?;
        output
            .write_all(bytes)
            .map_err(|error| format!("could not write temporary attachment: {error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("could not finish temporary attachment: {error}"))?;
        Ok(temporary.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn install_temporary(
    temporary: &Path,
    directory: &Path,
    hash: &str,
    descriptor: &MediaDescriptor,
) -> Result<(), String> {
    let filename = format!("{hash}.{}", descriptor.extension);
    validate_attachment_filename(&filename)?;
    let target = directory.join(&filename);
    if fs::symlink_metadata(&target).is_ok() {
        return verify_existing_attachment(&target, hash);
    }
    match fs::rename(temporary, &target) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            verify_existing_attachment(&target, hash)
        }
        Err(error) => Err(format!("could not install attachment atomically: {error}")),
    }
}

fn attachment_result(
    hash: &str,
    name: Option<&str>,
    descriptor: &MediaDescriptor,
    size: u64,
) -> AttachmentImport {
    AttachmentImport {
        file: format!("{hash}.{}", descriptor.extension),
        mime: descriptor.mime.to_string(),
        size,
        name: display_name(name),
        kind: Some(descriptor.kind.to_string()),
    }
}

pub(crate) fn verify_existing_attachment(path: &Path, expected_hash: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect stored attachment: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("stored attachment is not a regular file".to_string());
    }
    if hash_file(path)? != expected_hash {
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
        || !is_supported_attachment_extension(extension)
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

fn detect_media_descriptor(
    bytes: &[u8],
    name: Option<&str>,
    mime_hint: Option<&str>,
    kind_hint: Option<&str>,
) -> Result<MediaDescriptor, String> {
    if let Some(format) = detect_format(bytes) {
        return Ok(MediaDescriptor::image(format));
    }
    if bytes.starts_with(b"%PDF-") {
        return Ok(MediaDescriptor::pdf());
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Ok(MediaDescriptor::audio("wav", "audio/wav"));
    }
    if bytes.starts_with(b"OggS") {
        return Ok(MediaDescriptor::audio("ogg", "audio/ogg"));
    }
    if bytes.starts_with(b"fLaC") {
        return Ok(MediaDescriptor::audio("flac", "audio/flac"));
    }
    if bytes.starts_with(b"ID3") || is_mp3_frame_sync(bytes) {
        return Ok(MediaDescriptor::audio("mp3", "audio/mpeg"));
    }

    let extension = name
        .and_then(|value| Path::new(value).extension())
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let hinted_kind = kind_hint
        .filter(|kind| matches!(*kind, "audio" | "video"))
        .or_else(|| {
            mime_hint
                .and_then(|mime| mime.split_once('/'))
                .map(|(kind, _)| kind)
        })
        .or_else(|| {
            if matches!(extension.as_str(), "m4a" | "m4b" | "mka" | "weba") {
                Some("audio")
            } else if matches!(extension.as_str(), "mp4" | "mov" | "mkv" | "webm") {
                Some("video")
            } else {
                None
            }
        });

    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        let audio_brand = matches!(
            brand,
            b"M4A " | b"M4B " | b"M4P " | b"F4A " | b"F4B " | b"mp4a"
        );
        if audio_brand
            || hinted_kind == Some("audio")
            || matches!(extension.as_str(), "m4a" | "m4b")
        {
            let extension = if extension == "m4b" { "m4b" } else { "m4a" };
            return Ok(MediaDescriptor::audio(extension, "audio/mp4"));
        }
        return Ok(MediaDescriptor::video("mp4", "video/mp4"));
    }

    if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        if hinted_kind == Some("audio") || matches!(extension.as_str(), "mka" | "weba") {
            return Ok(MediaDescriptor::audio("webm", "audio/webm"));
        }
        return Ok(MediaDescriptor::video("webm", "video/webm"));
    }

    if let Some(extension) = is_text_extension_name(name) {
        return MediaDescriptor::text(&extension)
            .map_err(|_| "The text file extension is not supported.".to_string());
    }
    Err(unsupported_file_type(name))
}

fn is_mp3_frame_sync(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0
}

fn is_text_extension_name(name: Option<&str>) -> Option<String> {
    let extension = name
        .and_then(|name| Path::new(name).extension())
        .and_then(|extension| extension.to_str())?;
    let extension = extension.to_ascii_lowercase();
    if is_text_extension(&extension) {
        Some(extension)
    } else {
        None
    }
}

fn is_text_extension(extension: &str) -> bool {
    matches!(
        extension,
        "txt"
            | "md"
            | "json"
            | "py"
            | "js"
            | "ts"
            | "css"
            | "html"
            | "xml"
            | "yaml"
            | "yml"
            | "toml"
            | "csv"
            | "ini"
            | "sql"
            | "sh"
            | "ps1"
            | "rs"
            | "c"
            | "cpp"
            | "h"
            | "cs"
            | "java"
            | "go"
            | "lua"
            | "log"
    )
}

fn is_supported_attachment_extension(extension: &str) -> bool {
    matches!(
        extension,
        "png"
            | "jpg"
            | "gif"
            | "webp"
            | "bmp"
            | "pdf"
            | "mp3"
            | "wav"
            | "ogg"
            | "oga"
            | "flac"
            | "m4a"
            | "m4b"
            | "mka"
            | "weba"
            | "mp4"
            | "mov"
            | "mkv"
            | "webm"
    ) || is_text_extension(extension)
}

fn limit_error(descriptor: &MediaDescriptor) -> String {
    if descriptor.kind == "audio" || descriptor.kind == "video" {
        "Media exceeds the 2 GB limit.".to_string()
    } else {
        format!(
            "{} exceeds the 200 MB limit.",
            if descriptor.kind == "text" {
                "Text file"
            } else {
                "File"
            }
        )
    }
}

fn check_size(size: u64, descriptor: &MediaDescriptor) -> Result<(), String> {
    if size > descriptor.limit {
        Err(limit_error(descriptor))
    } else {
        Ok(())
    }
}

#[derive(Default)]
struct Utf8StreamValidator {
    pending: Vec<u8>,
}

impl Utf8StreamValidator {
    fn push(&mut self, bytes: &[u8]) -> bool {
        self.pending.extend_from_slice(bytes);
        match std::str::from_utf8(&self.pending) {
            Ok(_) => {
                self.pending.clear();
                true
            }
            Err(error) if error.error_len().is_none() => {
                let incomplete_start = error.valid_up_to();
                self.pending.drain(..incomplete_start);
                true
            }
            Err(_) => false,
        }
    }

    fn finish(&self) -> bool {
        std::str::from_utf8(&self.pending).is_ok()
    }
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file =
        File::open(path).map_err(|error| format!("could not verify stored attachment: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; STREAM_BUFFER_BYTES];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("could not verify stored attachment: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(digest_hex(hasher.finalize()))
}

fn digest_hex(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn ensure_regular_attachment(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect attachment: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("attachment is not a regular file".to_string());
    }
    Ok(())
}

fn unsupported_file_type(name: Option<&str>) -> String {
    let extension = name
        .and_then(|name| Path::new(name).extension())
        .and_then(|extension| extension.to_str())
        .filter(|extension| !extension.is_empty())
        .unwrap_or("unknown");
    format!(
        "Unsupported file type: {}. Supported: PNG, JPEG, GIF, WebP, BMP, PDF, text formats, MP3, WAV, OGG, FLAC, M4A, MP4, WebM",
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
    use super::{
        check_size, detect_format, detect_media_descriptor, import_bytes_at, import_path_at,
        import_supported_bytes, sha256_hex, validate_attachment_filename, MediaDescriptor,
        MAX_LARGE_MEDIA_BYTES, MAX_SMALL_ATTACHMENT_BYTES,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
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
    fn detects_non_image_media_by_magic_and_resolves_ambiguous_containers_with_hints() {
        assert_eq!(
            detect_media_descriptor(b"%PDF-1.7", Some("scan.pdf"), None, None)
                .unwrap()
                .kind,
            "pdf"
        );
        assert_eq!(
            detect_media_descriptor(b"ID3\x04\0\0", Some("track.mp3"), None, None)
                .unwrap()
                .mime,
            "audio/mpeg"
        );
        assert_eq!(
            detect_media_descriptor(&[0xff, 0xfb, 0x90], Some("track.mp3"), None, None)
                .unwrap()
                .kind,
            "audio"
        );
        assert_eq!(
            detect_media_descriptor(b"RIFF1234WAVE", Some("track.wav"), None, None)
                .unwrap()
                .mime,
            "audio/wav"
        );
        assert_eq!(
            detect_media_descriptor(b"OggS", Some("track.ogg"), None, None)
                .unwrap()
                .mime,
            "audio/ogg"
        );
        assert_eq!(
            detect_media_descriptor(b"fLaC", Some("track.flac"), None, None)
                .unwrap()
                .mime,
            "audio/flac"
        );
        assert_eq!(
            detect_media_descriptor(b"\x00\x00\x00\x18ftypM4A ", Some("track.m4a"), None, None)
                .unwrap()
                .kind,
            "audio"
        );
        assert_eq!(
            detect_media_descriptor(b"\x00\x00\x00\x18ftypisom", Some("clip.mp4"), None, None)
                .unwrap()
                .kind,
            "video"
        );
        let ebml = b"\x1a\x45\xdf\xa3";
        assert_eq!(
            detect_media_descriptor(ebml, Some("track.mka"), None, None)
                .unwrap()
                .kind,
            "audio"
        );
        assert_eq!(
            detect_media_descriptor(ebml, Some("clip.mkv"), None, None)
                .unwrap()
                .kind,
            "video"
        );
        assert_eq!(
            detect_media_descriptor(ebml, Some("recording.webm"), Some("audio/webm"), None)
                .unwrap()
                .kind,
            "audio"
        );
    }

    #[test]
    fn applies_limits_by_media_kind_and_rejects_invalid_utf8_text() {
        let pdf = MediaDescriptor::pdf();
        let text = MediaDescriptor::text("py").unwrap();
        let audio = MediaDescriptor::audio("mp3", "audio/mpeg");
        let video = MediaDescriptor::video("mp4", "video/mp4");
        assert_eq!(pdf.limit, MAX_SMALL_ATTACHMENT_BYTES);
        assert_eq!(text.limit, MAX_SMALL_ATTACHMENT_BYTES);
        assert_eq!(audio.limit, MAX_LARGE_MEDIA_BYTES);
        assert_eq!(video.limit, MAX_LARGE_MEDIA_BYTES);
        assert!(check_size(MAX_SMALL_ATTACHMENT_BYTES, &pdf).is_ok());
        assert!(check_size(MAX_SMALL_ATTACHMENT_BYTES + 1, &pdf).is_err());
        assert!(check_size(MAX_LARGE_MEDIA_BYTES, &audio).is_ok());
        assert!(check_size(MAX_LARGE_MEDIA_BYTES + 1, &video).is_err());
        assert!(import_supported_bytes(
            Path::new("."),
            &[0xc3, 0x28],
            Some("broken.py"),
            None,
            None
        )
        .unwrap_err()
        .contains("UTF-8"));
    }

    #[test]
    fn streams_path_import_and_hashes_the_complete_file() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create project root");
        let source = root.join("source.mp4");
        let mut bytes = b"\0\0\0\x18ftypisom".to_vec();
        bytes.extend(std::iter::repeat(0x5a).take(192 * 1024));
        fs::write(&source, &bytes).expect("write source media");

        let imported = import_path_at(&root, &source, Some("video")).expect("stream import");

        assert_eq!(imported.kind.as_deref(), Some("video"));
        assert_eq!(imported.file, format!("{}.mp4", sha256_hex(&bytes)));
        assert_eq!(
            fs::read(root.join("attachments").join(&imported.file)).expect("read imported"),
            bytes
        );
        fs::remove_dir_all(root).expect("remove fixture");
    }

    #[test]
    fn streams_utf8_across_the_buffer_boundary() {
        let root = test_root();
        fs::create_dir_all(&root).expect("create project root");
        let source = root.join("notes.txt");
        let mut bytes = vec![b'a'; super::STREAM_BUFFER_BYTES - 1];
        bytes.extend_from_slice("é".as_bytes());
        fs::write(&source, &bytes).expect("write text source");

        let imported = import_path_at(&root, &source, None).expect("import split UTF-8 character");

        assert_eq!(imported.kind.as_deref(), Some("text"));
        assert_eq!(
            fs::read(root.join("attachments").join(imported.file)).expect("read text"),
            bytes
        );
        fs::remove_dir_all(root).expect("remove fixture");
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
