use serde::Serialize;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter};

const MAX_DROPPED_TEXT_BYTES: u64 = 20 * 1024 * 1024;
const MAX_BATCH_TEXT_BYTES: usize = 64 * 1024 * 1024;
const IMPORT_PROGRESS_EVENT: &str = "attachment-import-progress";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedTextBatchItem {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedTextBatch {
    pub items: Vec<DroppedTextBatchItem>,
    pub processed: usize,
    pub cancelled: bool,
}

/// Read a dropped Markdown file without copying it into the project's attachment pool.
#[tauri::command]
pub async fn read_dropped_text(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || read_text(Path::new(&path)))
        .await
        .map_err(|error| format!("Text import worker failed: {error}"))?
}

/// Read a bounded group of Markdown files off the UI thread and stream file-level progress.
#[tauri::command]
pub async fn read_dropped_text_batch(
    app: AppHandle,
    import_id: String,
    paths: Vec<String>,
    progress_offset: usize,
    total_count: usize,
) -> Result<DroppedTextBatch, String> {
    if paths.len() > crate::attachments::MAX_ATTACHMENT_IMPORT_BATCH {
        return Err(format!(
            "Text import batches are limited to {} files.",
            crate::attachments::MAX_ATTACHMENT_IMPORT_BATCH
        ));
    }
    let cancellation = crate::attachments::import_cancellation_token(&import_id)?;
    let app_for_work = app.clone();
    let job = tauri::async_runtime::spawn_blocking(move || {
        let mut items = Vec::with_capacity(paths.len());
        let mut batch_bytes = 0usize;
        let mut succeeded = 0usize;
        let mut failed = 0usize;
        let mut cancelled = false;
        for (index, path) in paths.into_iter().enumerate() {
            if cancellation.load(std::sync::atomic::Ordering::Acquire) {
                cancelled = true;
                break;
            }
            let result = read_text(Path::new(&path));
            if let Ok(text) = result.as_ref() {
                if !items.is_empty()
                    && batch_bytes.saturating_add(text.len()) > MAX_BATCH_TEXT_BYTES
                {
                    break;
                }
                batch_bytes = batch_bytes.saturating_add(text.len());
                succeeded += 1;
            } else {
                failed += 1;
            }
            let (text, error) = match result {
                Ok(text) => (Some(text), None),
                Err(error) => (None, Some(error)),
            };
            items.push(DroppedTextBatchItem {
                path: path.clone(),
                text,
                error,
            });
            let payload = crate::attachments::AttachmentImportProgressEvent {
                import_id: import_id.clone(),
                completed: progress_offset + index + 1,
                total: total_count,
                succeeded,
                failed,
                current_file: path.rsplit(['/', '\\']).next().unwrap_or(&path).to_string(),
            };
            let _ = app_for_work.emit(IMPORT_PROGRESS_EVENT, payload);
        }
        DroppedTextBatch {
            processed: items.len(),
            items,
            cancelled,
        }
    });
    job.await
        .map_err(|error| format!("Text import worker failed: {error}"))
}

fn read_text(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("Dropped text file path must be absolute.".to_string());
    }
    let metadata =
        fs::metadata(path).map_err(|error| format!("Could not read dropped text file: {error}"))?;
    if !metadata.is_file() {
        return Err("Dropped text path must be a regular file.".to_string());
    }
    if metadata.len() > MAX_DROPPED_TEXT_BYTES {
        return Err("Dropped text file exceeds the 20 MB limit.".to_string());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Could not read dropped text file: {error}"))?;
    if bytes.len() as u64 > MAX_DROPPED_TEXT_BYTES {
        return Err("Dropped text file exceeds the 20 MB limit.".to_string());
    }
    let content = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(&bytes);
    String::from_utf8(content.to_vec())
        .map_err(|_| "Dropped text file must be UTF-8 (a UTF-8 BOM is accepted).".to_string())
}

#[cfg(test)]
mod tests {
    use super::{read_text, MAX_DROPPED_TEXT_BYTES};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reads_plain_and_bom_utf8_without_copying() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("hive-dropped-text-{stamp}"));
        fs::create_dir(&directory).unwrap();
        let file = directory.join("note.md");
        fs::write(&file, "Привет\n").unwrap();
        assert_eq!(read_text(&file).unwrap(), "Привет\n");
        fs::write(&file, b"\xef\xbb\xbfhello").unwrap();
        assert_eq!(read_text(&file).unwrap(), "hello");
        fs::write(&file, [0xff]).unwrap();
        assert!(read_text(&file).unwrap_err().contains("UTF-8"));
        assert!(read_text(&directory).unwrap_err().contains("regular file"));
        let oversized = fs::File::create(&file).unwrap();
        oversized.set_len(MAX_DROPPED_TEXT_BYTES + 1).unwrap();
        drop(oversized);
        assert!(read_text(&file).unwrap_err().contains("20 MB"));
        fs::remove_dir_all(directory).unwrap();
    }
}
