use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE_NAME: &str = "view-settings.json";
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn load_view_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    match fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("could not read view settings: {error}")),
    }
}

#[tauri::command]
pub fn save_view_settings(app: AppHandle, contents: String) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("view settings must be valid JSON: {error}"))?;
    if !value.is_object() {
        return Err("view settings must be a JSON object".to_string());
    }

    let contents = serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("could not encode view settings: {error}"))?;
    let path = settings_path(&app)?;
    atomic_write(&path, &contents).map_err(|error| format!("could not save view settings: {error}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("could not resolve the app config directory: {error}"))
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "settings path has no parent")
    })?;
    fs::create_dir_all(parent)?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("view-settings.json");
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary_path = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        counter
    ));

    let mut temporary_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary_path)?;
    let write_result = temporary_file
        .write_all(contents)
        .and_then(|()| temporary_file.sync_all());
    drop(temporary_file);

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temporary_path, path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::atomic_write;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    #[test]
    fn atomic_write_replaces_existing_settings_file() {
        let test_dir = std::env::temp_dir().join(format!(
            "hive-settings-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&test_dir).expect("create test directory");
        let path = test_dir.join("view-settings.json");
        fs::write(&path, b"old settings").expect("write initial settings");

        atomic_write(&path, b"new settings").expect("atomically replace settings");

        assert_eq!(
            fs::read(&path).expect("read replaced settings"),
            b"new settings"
        );
        let entries = fs::read_dir(&test_dir)
            .expect("read test directory")
            .count();
        assert_eq!(entries, 1, "temporary file should be removed after rename");
        fs::remove_dir_all(test_dir).expect("remove test directory");
    }

    #[test]
    fn failed_atomic_write_leaves_existing_target_untouched() {
        let test_dir = std::env::temp_dir().join(format!(
            "hive-settings-failure-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&test_dir).expect("create test directory");
        let path = test_dir.join("view-settings.json");
        fs::create_dir_all(&path).expect("create a target that cannot be replaced by a file");
        let sentinel = path.join("last-good");
        fs::write(&sentinel, b"keep this").expect("write sentinel");

        assert!(atomic_write(&path, b"new settings").is_err());
        assert_eq!(fs::read(&sentinel).expect("read sentinel"), b"keep this");
        let entries = fs::read_dir(&test_dir)
            .expect("read test directory")
            .count();
        assert_eq!(entries, 1, "temporary file should be removed after failure");
        fs::remove_dir_all(test_dir).expect("remove test directory");
    }
}
