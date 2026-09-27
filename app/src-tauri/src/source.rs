use std::fs;
use std::io;

/// Check whether a saved Source path currently points to a regular file.
/// The file contents are never read by this command.
#[tauri::command]
pub fn source_file_exists(file_path: String) -> Result<bool, String> {
    match fs::metadata(file_path) {
        Ok(metadata) => Ok(metadata.is_file()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not check source file: {error}")),
    }
}
