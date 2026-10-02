use std::fs;
use std::path::Path;

const MAX_DROPPED_TEXT_BYTES: u64 = 20 * 1024 * 1024;

/// Read a dropped Markdown file without copying it into the project's attachment pool.
#[tauri::command]
pub fn read_dropped_text(path: String) -> Result<String, String> {
    read_text(Path::new(&path))
}

fn read_text(path: &Path) -> Result<String, String> {
    if !path.is_absolute() {
        return Err("Dropped text file path must be absolute.".to_string());
    }
    let metadata = fs::metadata(path).map_err(|error| format!("Could not read dropped text file: {error}"))?;
    if !metadata.is_file() {
        return Err("Dropped text path must be a regular file.".to_string());
    }
    if metadata.len() > MAX_DROPPED_TEXT_BYTES {
        return Err("Dropped text file exceeds the 20 MB limit.".to_string());
    }
    let bytes = fs::read(path).map_err(|error| format!("Could not read dropped text file: {error}"))?;
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
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
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
