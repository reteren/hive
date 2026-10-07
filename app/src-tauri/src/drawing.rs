use crate::project::{active_project_root, ProjectState};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::State;

const DRAWING_DIRECTORY: &str = "drawing";
const TILES_DIRECTORY: &str = "tiles";
const INDEX_FILE: &str = "drawing.json";
const TILE_PX: u32 = 512;
const PX_PER_UNIT: u32 = 20;
const MAX_COORDINATE: i64 = 10_000_000;
/// Resolution pyramid levels (see app/src/drawing/types.ts): level L has 20 / 2^L px per unit.
const MIN_LEVEL: i64 = -3;
const MAX_LEVEL: i64 = 6;
const MAX_TILE_BYTES: usize = 4 * 1024 * 1024;
const MAX_INDEX_BYTES: u64 = 8 * 1024 * 1024;
const PNG_MAGIC: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);
static SAVE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawingIndex {
    version: u8,
    px_per_unit: u32,
    tile_size_px: u32,
    tiles: Vec<String>,
    /// Set once the tile list is taken from the files in drawing/tiles instead of this index, so
    /// two people drawing in different places never edit the same file (Git).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    tiles_from_files: bool,
}

#[derive(Serialize)]
pub struct DrawingLoadResponse {
    index: Option<DrawingIndex>,
}

#[derive(Deserialize)]
pub struct DrawingTileChange {
    key: String,
    png: Option<Vec<u8>>,
}

#[tauri::command]
pub fn drawing_load(state: State<'_, ProjectState>) -> Result<DrawingLoadResponse, String> {
    let root = active_project_root(&state)?;
    let index = load_index_at(&root)?;
    crate::board_watch::reset_drawing(&root);
    Ok(DrawingLoadResponse {
        index,
    })
}

/// Raw PNG bytes (an ArrayBuffer on the JS side, not a JSON number array: loading a big drawing
/// used to spend most of its time serialising tiles as numbers).
#[tauri::command]
pub fn drawing_read_tile(
    state: State<'_, ProjectState>,
    key: String,
) -> Result<tauri::ipc::Response, String> {
    read_tile_at(&active_project_root(&state)?, &key).map(tauri::ipc::Response::new)
}

#[tauri::command]
pub fn drawing_save(
    state: State<'_, ProjectState>,
    changes: Vec<DrawingTileChange>,
    index: DrawingIndex,
) -> Result<(), String> {
    save_at(&active_project_root(&state)?, &changes, &index)
}

/// Tile key: "col:row" (level 0) or "level:col:row" (level != 0). Returns (level, col, row).
fn validate_key(key: &str) -> Result<(i64, i64, i64), String> {
    let parts: Vec<&str> = key.split(':').collect();
    let (level, col, row) = match parts.as_slice() {
        [col, row] => ("0", *col, *row),
        [level, col, row] => (*level, *col, *row),
        _ => return Err("invalid drawing tile key".to_string()),
    };
    let level = level
        .parse::<i64>()
        .map_err(|_| "invalid drawing tile level")?;
    let col = col
        .parse::<i64>()
        .map_err(|_| "invalid drawing tile column")?;
    let row = row.parse::<i64>().map_err(|_| "invalid drawing tile row")?;
    let canonical = if level == 0 {
        format!("{col}:{row}")
    } else {
        format!("{level}:{col}:{row}")
    };
    if !(MIN_LEVEL..=MAX_LEVEL).contains(&level)
        || !(-MAX_COORDINATE..=MAX_COORDINATE).contains(&col)
        || !(-MAX_COORDINATE..=MAX_COORDINATE).contains(&row)
        || canonical != key
    {
        return Err(
            "drawing tile key is outside the allowed range or is not canonical".to_string(),
        );
    }
    Ok((level, col, row))
}

fn tile_path(root: &Path, key: &str) -> Result<PathBuf, String> {
    let (level, col, row) = validate_key(key)?;
    let name = if level == 0 {
        format!("{col}_{row}.png")
    } else {
        format!("L{level}_{col}_{row}.png")
    };
    Ok(root
        .join(DRAWING_DIRECTORY)
        .join(TILES_DIRECTORY)
        .join(name))
}

fn validate_index(index: &DrawingIndex) -> Result<(), String> {
    if index.version != 1 || index.px_per_unit != PX_PER_UNIT || index.tile_size_px != TILE_PX {
        return Err("unsupported drawing index version or raster dimensions".to_string());
    }
    let mut keys = HashSet::with_capacity(index.tiles.len());
    for key in &index.tiles {
        validate_key(key)?;
        if !keys.insert(key) {
            return Err(format!("duplicate drawing tile key: {key}"));
        }
    }
    Ok(())
}

fn validate_png(png: &[u8]) -> Result<(), String> {
    if png.len() > MAX_TILE_BYTES {
        return Err("drawing tile exceeds the 4 MB limit".to_string());
    }
    if !png.starts_with(PNG_MAGIC) {
        return Err("drawing tile is not a PNG".to_string());
    }
    Ok(())
}

fn load_index_at(root: &Path) -> Result<Option<DrawingIndex>, String> {
    let drawing = root.join(DRAWING_DIRECTORY);
    if !check_directory(&drawing, false)? {
        return Ok(None);
    }
    let path = drawing.join(INDEX_FILE);
    if !check_regular_file(&path)? {
        return Ok(None);
    }
    if fs::metadata(&path)
        .map_err(|error| format!("could not inspect drawing index: {error}"))?
        .len()
        > MAX_INDEX_BYTES
    {
        return Err("drawing index exceeds the 8 MB limit".to_string());
    }
    let bytes =
        fs::read(&path).map_err(|error| format!("could not read drawing index: {error}"))?;
    let mut index: DrawingIndex = serde_json::from_slice(&bytes)
        .map_err(|error| format!("drawing index is invalid: {error}"))?;
    validate_index(&index)?;
    let tiles = drawing.join(TILES_DIRECTORY);
    if !index.tiles_from_files {
        // One-time switch: tiles the old list did not mention are leftovers of erased drawings.
        let listed: HashSet<String> = index.tiles.iter().cloned().collect();
        for key in tile_keys_on_disk(&tiles) {
            if !listed.contains(&key) {
                let _ = fs::remove_file(tile_path(root, &key)?);
            }
        }
        let meta = DrawingIndex { tiles: Vec::new(), tiles_from_files: true, ..index.clone() };
        let encoded = serde_json::to_vec(&meta)
            .map_err(|error| format!("could not encode drawing index: {error}"))?;
        atomic_write(&path, &encoded)?;
    }
    index.tiles = tile_keys_on_disk(&tiles);
    index.tiles_from_files = true;
    validate_index(&index)?;
    Ok(Some(index))
}

/// Tile keys of the PNG files in drawing/tiles ("col:row" for level 0, "level:col:row" otherwise).
fn tile_keys_on_disk(tiles: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(tiles) else { return Vec::new() };
    let mut keys: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stem = name.strip_suffix(".png")?;
            let key = match stem.strip_prefix('L') {
                Some(rest) => rest.replace('_', ":"),
                None => stem.replace('_', ":"),
            };
            (validate_key(&key).is_ok() && tile_path_matches(tiles, &key, &name)).then_some(key)
        })
        .collect();
    keys.sort();
    keys
}

fn tile_path_matches(tiles: &Path, key: &str, name: &str) -> bool {
    tiles
        .parent()
        .and_then(Path::parent)
        .and_then(|root| tile_path(root, key).ok())
        .and_then(|path| path.file_name().map(|file| file.to_string_lossy() == name))
        .unwrap_or(false)
}

pub(crate) fn health_findings(root: &Path) -> Vec<String> {
    let drawing = root.join(DRAWING_DIRECTORY);
    let mut findings = Vec::new();
    let index = match load_index_at(root) {
        Ok(Some(index)) => index,
        Ok(None) => {
            if drawing.exists() {
                findings.push("Drawing index is missing".to_string());
            }
            return findings;
        }
        Err(error) => {
            findings.push(format!("Drawing index: {error}"));
            return findings;
        }
    };
    let tiles = drawing.join(TILES_DIRECTORY);
    match check_directory(&tiles, false) {
        Ok(true) => {}
        Ok(false) => {
            for key in index.tiles {
                findings.push(format!("Missing drawing tile: {key}"));
            }
            return findings;
        }
        Err(error) => {
            findings.push(format!("Drawing tiles: {error}"));
            return findings;
        }
    }
    for key in index.tiles {
        let path = match tile_path(root, &key) {
            Ok(path) => path,
            Err(error) => {
                findings.push(format!("Drawing tile {key}: {error}"));
                continue;
            }
        };
        match check_regular_file(&path) {
            Ok(true) => {}
            Ok(false) => findings.push(format!("Missing drawing tile: {key}")),
            Err(error) => findings.push(format!("Drawing tile {key}: {error}")),
        }
    }
    findings
}

fn read_tile_at(root: &Path, key: &str) -> Result<Vec<u8>, String> {
    let path = tile_path(root, key)?;
    check_directory(&root.join(DRAWING_DIRECTORY), false)?;
    check_directory(&root.join(DRAWING_DIRECTORY).join(TILES_DIRECTORY), false)?;
    if !check_regular_file(&path)? {
        return Err(format!("drawing tile {key} is missing"));
    }
    if fs::metadata(&path)
        .map_err(|error| format!("could not inspect drawing tile: {error}"))?
        .len()
        > MAX_TILE_BYTES as u64
    {
        return Err("drawing tile exceeds the 4 MB limit".to_string());
    }
    let png =
        fs::read(&path).map_err(|error| format!("could not read drawing tile {key}: {error}"))?;
    validate_png(&png)?;
    Ok(png)
}

fn save_at(root: &Path, changes: &[DrawingTileChange], index: &DrawingIndex) -> Result<(), String> {
    let _guard = SAVE_LOCK
        .lock()
        .map_err(|_| "drawing save lock is unavailable")?;
    validate_index(index)?;
    let listed: HashSet<&str> = index.tiles.iter().map(String::as_str).collect();
    let mut changed = HashSet::new();
    for change in changes {
        validate_key(&change.key)?;
        if !changed.insert(change.key.as_str()) {
            return Err(format!("duplicate drawing tile change: {}", change.key));
        }
        if change.png.is_some() != listed.contains(change.key.as_str()) {
            return Err(format!(
                "drawing index disagrees with tile change {}",
                change.key
            ));
        }
        if let Some(png) = &change.png {
            validate_png(png)?;
        }
    }
    // The tile list lives in the file names; drawing.json only keeps the format (see tiles_from_files).
    let meta = DrawingIndex { tiles: Vec::new(), tiles_from_files: true, ..index.clone() };
    let bytes = serde_json::to_vec(&meta)
        .map_err(|error| format!("could not encode drawing index: {error}"))?;
    if bytes.len() as u64 > MAX_INDEX_BYTES {
        return Err("drawing index exceeds the 8 MB limit".to_string());
    }
    let drawing = root.join(DRAWING_DIRECTORY);
    let tiles = drawing.join(TILES_DIRECTORY);
    check_directory(&drawing, true)?;
    check_directory(&tiles, true)?;
    let targets = changes
        .iter()
        .map(|change| tile_path(root, &change.key))
        .collect::<Result<Vec<_>, _>>()?;
    let index_path = drawing.join(INDEX_FILE);
    check_regular_file(&index_path)?;
    for path in &targets {
        check_regular_file(path)?;
    }
    for (change, path) in changes.iter().zip(targets) {
        let file_name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        crate::board_watch::record_drawing_write(root, &file_name, change.png.as_deref());
        if let Some(png) = &change.png {
            atomic_write(&path, png)?;
        } else if path.exists() {
            fs::remove_file(&path).map_err(|error| {
                format!("could not remove drawing tile {}: {error}", change.key)
            })?;
        }
    }
    if fs::read(&index_path).ok().as_deref() != Some(bytes.as_slice()) {
        atomic_write(&index_path, &bytes)?;
    }
    Ok(())
}

fn check_directory(path: &Path, create: bool) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => Err(format!(
            "drawing path is not a real directory: {}",
            path.display()
        )),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound && create => {
            fs::create_dir(path)
                .map_err(|error| format!("could not create drawing folder: {error}"))?;
            Ok(true)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not inspect drawing folder: {error}")),
    }
}

fn check_regular_file(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => Err(format!(
            "drawing path is not a regular file: {}",
            path.display()
        )),
        Ok(_) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("could not inspect drawing file: {error}")),
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("drawing file has no parent")?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("tile");
    let temp = parent.join(format!(
        ".{name}.{}.{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|error| format!("could not stage drawing file: {error}"))?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("could not write drawing file: {error}"))?;
        drop(file);
        replace_file(&temp, path)
            .map_err(|error| format!("could not install drawing file: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const REPLACE_EXISTING: u32 = 0x1;
    const WRITE_THROUGH: u32 = 0x8;
    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    let wide = |path: &Path| {
        path.as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<_>>()
    };
    if unsafe {
        MoveFileExW(
            wide(source).as_ptr(),
            wide(destination).as_ptr(),
            REPLACE_EXISTING | WRITE_THROUGH,
        )
    } == 0
    {
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
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "hive-drawing-{name}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    fn index(keys: &[&str]) -> DrawingIndex {
        DrawingIndex {
            version: 1,
            px_per_unit: PX_PER_UNIT,
            tile_size_px: TILE_PX,
            tiles: keys.iter().map(|key| (*key).into()).collect(),
            tiles_from_files: false,
        }
    }

    fn png() -> Vec<u8> {
        [PNG_MAGIC.as_slice(), &[0, 0, 0, 0]].concat()
    }

    #[test]
    fn validates_canonical_bounded_keys_and_png_payloads() {
        for key in [
            "0:0",
            "-10000000:10000000",
            "17:-4",
            "3:1:-2",
            "-3:0:0",
            "6:-5:5",
        ] {
            assert!(validate_key(key).is_ok(), "{key}");
        }
        assert_eq!(validate_key("4:-1:2"), Ok((4, -1, 2)));
        assert!(tile_path(Path::new("p"), "4:-1:2")
            .unwrap()
            .ends_with("L4_-1_2.png"));
        assert!(tile_path(Path::new("p"), "-1:2")
            .unwrap()
            .ends_with("-1_2.png"));
        for key in [
            "10000001:0",
            "0:-10000001",
            "-9223372036854775808:0",
            "../0:0",
            "01:0",
            "-0:0",
            "0/1:0",
            "0:1:2",
            "7:0:0",
            "-4:0:0",
            "1:2:3:4",
            "01:2:3",
        ] {
            assert!(validate_key(key).is_err(), "{key}");
        }
        assert!(validate_png(&png()).is_ok());
        assert!(validate_png(b"not png").is_err());
        assert!(validate_png(&vec![0; MAX_TILE_BYTES + 1]).is_err());
    }

    #[test]
    fn saves_and_loads_tiles_of_other_resolution_levels() {
        let root = test_root("levels");
        let tile = png();
        save_at(
            &root,
            &[
                DrawingTileChange {
                    key: "4:-1:2".into(),
                    png: Some(tile.clone()),
                },
                DrawingTileChange {
                    key: "-1:2".into(),
                    png: Some(tile.clone()),
                },
            ],
            &index(&["4:-1:2", "-1:2"]),
        )
        .unwrap();
        assert!(root.join("drawing/tiles/L4_-1_2.png").is_file());
        assert!(root.join("drawing/tiles/-1_2.png").is_file());
        assert_eq!(read_tile_at(&root, "4:-1:2").unwrap(), tile);
        assert!(health_findings(&root).is_empty());
        save_at(
            &root,
            &[DrawingTileChange {
                key: "4:-1:2".into(),
                png: None,
            }],
            &index(&["-1:2"]),
        )
        .unwrap();
        assert!(!root.join("drawing/tiles/L4_-1_2.png").exists());
    }

    #[test]
    fn saves_loads_and_deletes_tiles_with_index_written_last() {
        let root = test_root("roundtrip");
        assert!(load_index_at(&root).unwrap().is_none());
        let tile = png();
        save_at(
            &root,
            &[DrawingTileChange {
                key: "-2:3".into(),
                png: Some(tile.clone()),
            }],
            &index(&["-2:3"]),
        )
        .unwrap();
        assert_eq!(read_tile_at(&root, "-2:3").unwrap(), tile);
        assert_eq!(load_index_at(&root).unwrap().unwrap().tiles, vec!["-2:3"]);
        assert!(health_findings(&root).is_empty());
        assert!(save_at(
            &root,
            &[DrawingTileChange {
                key: "-2:3".into(),
                png: Some(vec![1, 2])
            }],
            &index(&["-2:3"])
        )
        .is_err());
        assert_eq!(read_tile_at(&root, "-2:3").unwrap(), tile);
        save_at(
            &root,
            &[DrawingTileChange {
                key: "-2:3".into(),
                png: None,
            }],
            &index(&[]),
        )
        .unwrap();
        assert!(read_tile_at(&root, "-2:3").is_err());
        assert!(load_index_at(&root).unwrap().unwrap().tiles.is_empty());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_removed_tile_file_just_leaves_the_drawing() {
        let root = test_root("health");
        save_at(
            &root,
            &[DrawingTileChange {
                key: "1:2".into(),
                png: Some(png()),
            }],
            &index(&["1:2"]),
        )
        .unwrap();
        fs::remove_file(tile_path(&root, "1:2").unwrap()).unwrap();
        // The tile list is the set of files (Git pulls add and remove them), not a separate list.
        assert!(load_index_at(&root).unwrap().unwrap().tiles.is_empty());
        assert!(health_findings(&root).is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
