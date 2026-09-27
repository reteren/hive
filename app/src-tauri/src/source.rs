use std::fs;
use std::io;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Check whether a saved Source path currently points to a regular file.
/// The file contents are never read by this command.
#[tauri::command]
pub fn source_path_exists(file_path: String) -> Result<bool, String> {
    path_exists(Path::new(&file_path))
}

#[tauri::command]
pub fn source_open_path(app: AppHandle, file_path: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    if !path.is_absolute() {
        return Err("source path must be absolute".to_string());
    }
    if !path_exists(path)? {
        return Err("source path does not exist".to_string());
    }

    app.opener()
        .open_path(file_path, None::<&str>)
        .map_err(|error| format!("could not open source path: {error}"))
}

fn path_exists(path: &Path) -> Result<bool, String> {
    match fs::metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not check source path: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::path_exists;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_path() -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!("hive-source-{}-{stamp}", std::process::id()))
    }

    #[test]
    fn availability_includes_files_and_directories_but_not_missing_paths() {
        let directory = unique_temp_path();
        fs::create_dir_all(&directory).expect("temporary directory should be created");
        let file = directory.join("source.txt");
        fs::write(&file, "source").expect("temporary source file should be written");
        let missing = directory.join("missing.txt");

        assert!(path_exists(&directory).expect("directory should be inspectable"));
        assert!(path_exists(&file).expect("file should be inspectable"));
        assert!(!path_exists(&missing).expect("missing path should be a valid negative result"));

        fs::remove_dir_all(directory).expect("temporary files should be cleaned up");
    }
}
