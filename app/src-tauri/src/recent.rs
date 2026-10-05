use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const RECENT_PROJECTS_FILE_NAME: &str = "recent-projects.json";
const MAX_RECENT_PROJECTS: usize = 10;
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
static RECENT_PROJECTS_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RecentProjectKind {
    Folder,
    Zip,
}

impl RecentProjectKind {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "folder" => Ok(Self::Folder),
            "zip" => Ok(Self::Zip),
            _ => Err("recent project kind must be folder or zip".to_string()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredRecentProject {
    path: String,
    kind: RecentProjectKind,
    name: String,
    opened_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub kind: RecentProjectKind,
    pub name: String,
    pub opened_at: u64,
    pub exists: bool,
}

fn recent_projects_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(RECENT_PROJECTS_FILE_NAME))
        .map_err(|error| format!("could not resolve the app config directory: {error}"))
}

#[tauri::command]
pub fn recent_projects_list(app: AppHandle) -> Vec<RecentProject> {
    let Ok(path) = recent_projects_file(&app) else {
        return Vec::new();
    };
    list_at(&path)
}

#[tauri::command]
pub fn recent_projects_add(app: AppHandle, path: String, kind: String) -> Result<(), String> {
    let kind = RecentProjectKind::parse(&kind)?;
    let file = recent_projects_file(&app)?;
    add_at(&file, &path, kind, current_time_ms())
        .map_err(|error| format!("could not update recent projects: {error}"))
}

#[tauri::command]
pub fn recent_projects_clear(app: AppHandle) -> Result<(), String> {
    let file = recent_projects_file(&app)?;
    clear_at(&file).map_err(|error| format!("could not clear recent projects: {error}"))
}

/// Add a folder to the recent list after project.rs has remembered the opened project.
pub fn remember_folder(app: &AppHandle, path: &Path) -> Result<(), String> {
    let file = recent_projects_file(app)?;
    add_at(
        &file,
        &path.to_string_lossy(),
        RecentProjectKind::Folder,
        current_time_ms(),
    )
    .map_err(|error| format!("could not add project to recents: {error}"))
}

fn current_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn list_at(file: &Path) -> Vec<RecentProject> {
    let Ok(entries) = read_entries(file) else {
        return Vec::new();
    };
    order_and_dedupe(entries)
        .into_iter()
        .map(|entry| {
            let path = display_path(&entry.path);
            RecentProject {
                exists: Path::new(&path).exists(),
                path,
                kind: entry.kind,
                name: entry.name,
                opened_at: entry.opened_at,
            }
        })
        .collect()
}

fn add_at(file: &Path, path: &str, kind: RecentProjectKind, opened_at: u64) -> io::Result<()> {
    let _guard = RECENT_PROJECTS_LOCK
        .lock()
        .map_err(|_| io::Error::other("recent projects lock is unavailable"))?;
    let display = display_path(path);
    if display.trim().is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "project path is empty",
        ));
    }
    let entry = StoredRecentProject {
        name: project_name(&display, kind),
        path: display,
        kind,
        opened_at,
    };
    let key = normalized_path_key(&entry.path);
    let mut entries = read_entries(file)?;
    entries.retain(|existing| normalized_path_key(&existing.path) != key);
    entries.insert(0, entry);
    write_entries(file, &order_and_dedupe(entries))
}

fn clear_at(file: &Path) -> io::Result<()> {
    let _guard = RECENT_PROJECTS_LOCK
        .lock()
        .map_err(|_| io::Error::other("recent projects lock is unavailable"))?;
    write_entries(file, &[])
}

fn read_entries(file: &Path) -> io::Result<Vec<StoredRecentProject>> {
    match fs::read(file) {
        Ok(contents) => Ok(serde_json::from_slice(&contents).unwrap_or_default()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error),
    }
}

fn write_entries(file: &Path, entries: &[StoredRecentProject]) -> io::Result<()> {
    let contents = serde_json::to_vec_pretty(entries)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
    atomic_write(file, &contents)
}

fn order_and_dedupe(mut entries: Vec<StoredRecentProject>) -> Vec<StoredRecentProject> {
    entries.sort_by(|left, right| right.opened_at.cmp(&left.opened_at));
    let mut seen = HashSet::new();
    entries
        .into_iter()
        .filter(|entry| seen.insert(normalized_path_key(&entry.path)))
        .take(MAX_RECENT_PROJECTS)
        .collect()
}

fn display_path(path: &str) -> String {
    if starts_with_ascii_case_insensitive(path, r"\\?\UNC\") {
        format!(r"\\{}", &path[8..])
    } else if starts_with_ascii_case_insensitive(path, r"\\?\") {
        path[4..].to_string()
    } else {
        path.to_string()
    }
}

fn starts_with_ascii_case_insensitive(value: &str, prefix: &str) -> bool {
    value
        .get(..prefix.len())
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(prefix))
}

fn normalized_path_key(path: &str) -> String {
    let mut normalized = display_path(path).replace('/', "\\");
    if normalized.len() > 3 {
        while normalized.ends_with('\\') {
            normalized.pop();
        }
    }
    normalized.to_lowercase()
}

fn project_name(path: &str, kind: RecentProjectKind) -> String {
    let filename = path
        .trim_end_matches(['\\', '/'])
        .rsplit(['\\', '/'])
        .next()
        .unwrap_or_default();
    let name = match kind {
        RecentProjectKind::Folder => filename.to_string(),
        RecentProjectKind::Zip => Path::new(filename)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or(filename)
            .to_string(),
    };
    if name.is_empty() {
        path.to_string()
    } else {
        name
    }
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "recent projects path has no parent",
        )
    })?;
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("recent-projects.json");
    let counter = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".{file_name}.{}.{}.tmp",
        std::process::id(),
        counter
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
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

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
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
    use super::{
        add_at, clear_at, display_path, list_at, normalized_path_key, RecentProjectKind,
        MAX_RECENT_PROJECTS,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_file(label: &str) -> (PathBuf, PathBuf) {
        let directory = std::env::temp_dir().join(format!(
            "hive-recent-{label}-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&directory).expect("create temporary recent directory");
        (directory.join("recent-projects.json"), directory)
    }

    #[test]
    fn lists_projects_newest_first() {
        let (file, directory) = test_file("order");
        add_at(&file, r"C:\projects\older", RecentProjectKind::Folder, 10)
            .expect("add older project");
        add_at(&file, r"C:\projects\newer", RecentProjectKind::Folder, 20)
            .expect("add newer project");

        let entries = list_at(&file);
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["newer", "older"]
        );
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn deduplicates_case_insensitive_paths_and_strips_verbatim_prefixes() {
        let (file, directory) = test_file("dedupe");
        add_at(
            &file,
            r"\\?\C:\Projects\Demo\",
            RecentProjectKind::Folder,
            10,
        )
        .expect("add prefixed path");
        add_at(&file, r"c:\projects\demo", RecentProjectKind::Folder, 20)
            .expect("add normalized path");

        let entries = list_at(&file);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].opened_at, 20);
        assert_eq!(entries[0].path, r"c:\projects\demo");
        assert_eq!(
            normalized_path_key(r"\\?\UNC\server\share\Demo"),
            r"\\server\share\demo"
        );
        assert_eq!(display_path(r"\\?\C:\Projects\Demo"), r"C:\Projects\Demo");
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn keeps_only_the_ten_newest_entries() {
        let (file, directory) = test_file("cap");
        for index in 0..12 {
            add_at(
                &file,
                &format!(r"C:\projects\p{index}"),
                RecentProjectKind::Folder,
                index,
            )
            .expect("add project");
        }

        let entries = list_at(&file);
        assert_eq!(entries.len(), MAX_RECENT_PROJECTS);
        assert_eq!(entries[0].name, "p11");
        assert_eq!(entries[9].name, "p2");
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn reports_missing_projects_as_not_existing() {
        let (file, directory) = test_file("missing");
        let missing = directory.join("deleted-project");
        add_at(
            &file,
            &missing.to_string_lossy(),
            RecentProjectKind::Folder,
            1,
        )
        .expect("add missing project");

        let entries = list_at(&file);
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].exists);
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn zip_entries_use_the_file_stem_and_camel_case_contract() {
        let (file, directory) = test_file("zip");
        add_at(
            &file,
            r"C:\archives\friend-project.zip",
            RecentProjectKind::Zip,
            42,
        )
        .expect("add zip project");

        let stored: serde_json::Value =
            serde_json::from_slice(&fs::read(&file).expect("read recent data"))
                .expect("parse recent data");
        assert_eq!(stored[0]["kind"], "zip");
        assert_eq!(stored[0]["name"], "friend-project");
        assert_eq!(stored[0]["openedAt"], 42);
        assert_eq!(list_at(&file)[0].name, "friend-project");
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn corrupt_json_produces_an_empty_list() {
        let (file, directory) = test_file("corrupt");
        fs::write(&file, b"{broken json").expect("write invalid recent data");

        assert!(list_at(&file).is_empty());
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }

    #[test]
    fn clear_removes_all_recent_entries() {
        let (file, directory) = test_file("clear");
        add_at(&file, r"C:\projects\one", RecentProjectKind::Folder, 1)
            .expect("add project");

        clear_at(&file).expect("clear recent list");

        assert!(list_at(&file).is_empty());
        fs::remove_dir_all(directory).expect("remove temporary directory");
    }
}
