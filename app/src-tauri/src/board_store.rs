//! On-disk layout of a project's board, built for version control (Git / GitHub Desktop).
//!
//! The app still works with one board document (the former `board.json`). On disk it is split so
//! that two people adding different objects never touch the same file:
//!
//! - `board.json`            — project head: version, createdAt, beacon marks, ME flag, `"storage": 2`
//!   and no `notes` array (older hive versions refuse to open it instead
//!   of saving an empty board over it).
//! - `nodes/<id>.json`       — one file per node; `_order` keeps the paint order without a shared list.
//! - `links/`, `zones/`, `trash/`, `archive/`, `tasklog/` — the same, per object id.
//! - `calculators/<key>.json` — one file per shared calculator state.
//! - `.hive/local.json`      — per-person stopwatch counters (ignored by Git).
//!
//! Saving writes only the files whose content changed and deletes only objects this app knew
//! about (`synced`), so objects that arrived from a pull are never deleted by a stale save.

use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const INDEX_FILE_NAME: &str = "board.json";
pub const STORAGE_VERSION: u64 = 2;
const ORDER_KEY: &str = "_order";
const LOCAL_FILE: &str = ".hive/local.json";
const CALCULATORS_DIRECTORY: &str = "calculators";
/// Document key → folder. Every item of these arrays has a string `id`.
pub const COLLECTIONS: &[(&str, &str)] = &[
    ("notes", "nodes"),
    ("links", "links"),
    ("zones", "zones"),
    ("trash", "trash"),
    ("archive", "archive"),
    ("taskLog", "tasklog"),
];
/// Per-person data kept out of the shared files.
const LOCAL_KEYS: &[&str] = &["projectCounters"];
const GITIGNORE_LINES: &[&str] = &[".hive/backups/", ".hive/local.json"];

/// Serialises saves with the external-change watcher, so it never reads a half-written save.
pub static STORE_LOCK: Mutex<()> = Mutex::new(());
/// Last document this app loaded or saved, per project root.
static SYNCED: Mutex<Option<(PathBuf, Value)>> = Mutex::new(None);
/// Last observed bytes and order metadata, keyed by collection directory and object id.
/// Project open seeds this once; saves only encode records that differ from that baseline.
static SYNCED_FILES: Mutex<Option<HashMap<PathBuf, HashMap<(String, String), CachedObject>>>> =
    Mutex::new(None);
/// Bumped whenever the board changes on disk from outside (a pull). A save based on an older
/// revision is refused, so it cannot treat the newly arrived objects as deleted.
static REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
pub const STALE_SAVE_ERROR: &str = "BOARD_CHANGED_ON_DISK";

pub fn set_synced(root: &Path, document: &Value) {
    if let Ok(mut synced) = SYNCED.lock() {
        *synced = Some((root.to_path_buf(), document.clone()));
    }
}

#[derive(Clone)]
struct CachedObject {
    bytes: Vec<u8>,
    value: Value,
    order: Option<f64>,
}

fn set_synced_files(root: &Path, files: HashMap<(String, String), CachedObject>) {
    if let Ok(mut cached) = SYNCED_FILES.lock() {
        let roots = cached.get_or_insert_with(Default::default);
        roots.insert(root.to_path_buf(), files);
        while roots.len() > 8 {
            let Some(oldest) = roots
                .keys()
                .find(|cached_root| *cached_root != root)
                .cloned()
            else {
                break;
            };
            roots.remove(&oldest);
        }
    }
}

pub fn revision() -> u64 {
    REVISION.load(std::sync::atomic::Ordering::SeqCst)
}

pub fn bump_revision() -> u64 {
    REVISION.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

pub fn synced(root: &Path) -> Option<Value> {
    let synced = SYNCED.lock().ok()?;
    match synced.as_ref() {
        Some((synced_root, document)) if synced_root == root => Some(document.clone()),
        _ => None,
    }
}

/// True when `board.json` still holds the whole board (older projects).
pub fn is_legacy(root: &Path) -> Result<bool, String> {
    let head = read_json_object(&root.join(INDEX_FILE_NAME))?;
    Ok(head.get("notes").is_some_and(Value::is_array)
        || head.get("storage").and_then(Value::as_u64).unwrap_or(0) < STORAGE_VERSION)
}

/// The whole board document as the app expects it, plus warnings for unreadable object files.
pub fn read_document(root: &Path) -> Result<(Value, Vec<String>), String> {
    let head_path = root.join(INDEX_FILE_NAME);
    let head_bytes = fs::read(&head_path)
        .map_err(|error| format!("could not read {}: {error}", display_relative(&head_path)))?;
    let head = parse_json_object(&head_path, &head_bytes)?;
    let mut cached_files = HashMap::new();
    cached_files.insert(
        (INDEX_FILE_NAME.to_string(), INDEX_FILE_NAME.to_string()),
        CachedObject {
            bytes: head_bytes,
            value: Value::Null,
            order: None,
        },
    );
    if head.get("notes").is_some_and(Value::is_array) {
        set_synced_files(root, cached_files);
        return Ok((Value::Object(head), Vec::new()));
    }
    let mut warnings = Vec::new();
    let mut document = head;
    document.remove("storage");
    for (key, directory) in COLLECTIONS {
        let mut items = read_collection(&root.join(directory), &mut warnings)?;
        items.sort_by(|left, right| {
            order_of(&left.1)
                .partial_cmp(&order_of(&right.1))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.0.cmp(&right.0))
        });
        let values = items
            .into_iter()
            .map(|(id, mut item, bytes)| {
                cache_object(&mut cached_files, directory, &id, &item, bytes.clone());
                if let Some(object) = item.as_object_mut() {
                    object.remove(ORDER_KEY);
                }
                item
            })
            .collect();
        document.insert((*key).to_string(), Value::Array(values));
    }
    let mut calculators = Map::new();
    for (id, item, bytes) in read_collection(&root.join(CALCULATORS_DIRECTORY), &mut warnings)? {
        cache_object(&mut cached_files, CALCULATORS_DIRECTORY, &id, &item, bytes);
        if let (Some(key), Some(value)) =
            (item.get("key").and_then(Value::as_str), item.get("value"))
        {
            calculators.insert(key.to_string(), value.clone());
        }
    }
    document.insert("calculators".to_string(), Value::Object(calculators));
    if let Ok(local) = read_json_object(&root.join(LOCAL_FILE)) {
        for key in LOCAL_KEYS {
            if let Some(value) = local.get(*key) {
                document.insert((*key).to_string(), value.clone());
            }
        }
    }
    set_synced_files(root, cached_files);
    Ok((Value::Object(document), warnings))
}

fn cache_object(
    cache: &mut HashMap<(String, String), CachedObject>,
    directory: &str,
    id: &str,
    value: &Value,
    bytes: Vec<u8>,
) {
    let order = value.get(ORDER_KEY).and_then(Value::as_f64);
    let mut semantic_value = value.clone();
    if let Some(object) = semantic_value.as_object_mut() {
        object.remove(ORDER_KEY);
    }
    cache.insert(
        (directory.to_string(), id.to_string()),
        CachedObject {
            bytes,
            value: semantic_value,
            order,
        },
    );
}

/// `read_document` encoded as JSON bytes (for code that used to read `board.json`).
pub fn read_document_bytes(root: &Path) -> Result<Vec<u8>, String> {
    let (document, _) = read_document(root)?;
    serde_json::to_vec(&document).map_err(|error| format!("could not encode the board: {error}"))
}

/// Files to write and delete so that the disk matches `document`.
pub struct DiskPlan {
    root: PathBuf,
    pub writes: Vec<(PathBuf, Vec<u8>)>,
    pub deletes: Vec<PathBuf>,
}

/// Plan the files for `document`. Objects are deleted only if `known` (the last synced document)
/// had them; with `known = None` every object file not in `document` is deleted (migration/restore).
pub fn plan_write(
    root: &Path,
    document: &Value,
    known: Option<&Value>,
) -> Result<DiskPlan, String> {
    let object = document
        .as_object()
        .ok_or_else(|| "the board document must be an object".to_string())?;
    let mut plan = DiskPlan {
        root: root.to_path_buf(),
        writes: Vec::new(),
        deletes: Vec::new(),
    };
    let cached_files = SYNCED_FILES
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref().and_then(|files| files.get(root)).cloned())
        .unwrap_or_default();

    let mut head = Map::new();
    for (key, value) in object {
        if COLLECTIONS.iter().any(|(collection, _)| collection == key)
            || key == "calculators"
            || LOCAL_KEYS.contains(&key.as_str())
        {
            continue;
        }
        head.insert(key.clone(), value.clone());
    }
    head.insert("storage".to_string(), Value::from(STORAGE_VERSION));
    plan_file(
        &mut plan,
        root.join(INDEX_FILE_NAME),
        pretty(&Value::Object(head))?,
    )?;

    let mut local = read_json_object(&root.join(LOCAL_FILE)).unwrap_or_default();
    let mut local_changed = false;
    for key in LOCAL_KEYS {
        if let Some(value) = object.get(*key) {
            if local.get(*key) != Some(value) {
                local.insert((*key).to_string(), value.clone());
                local_changed = true;
            }
        }
    }
    if local_changed || !root.join(LOCAL_FILE).exists() {
        plan_file(
            &mut plan,
            root.join(LOCAL_FILE),
            pretty(&Value::Object(local))?,
        )?;
    }

    for (key, directory) in COLLECTIONS {
        let items = object
            .get(*key)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let known_ids = known.map(|known| ids_in(known.get(*key)));
        let known_values = known.map(|known| object_values(known.get(*key)));
        plan_collection(
            &mut plan,
            directory,
            &root.join(directory),
            &items,
            known_values.as_ref(),
            known_ids.as_ref(),
            &cached_files,
        )?;
    }

    let calculators = object
        .get("calculators")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let items: Vec<Value> = calculators
        .iter()
        .map(|(key, value)| {
            let mut item = Map::new();
            item.insert("id".to_string(), Value::from(calculator_file_id(key)));
            item.insert("key".to_string(), Value::from(key.clone()));
            item.insert("value".to_string(), value.clone());
            Value::Object(item)
        })
        .collect();
    let known_ids = known.map(|known| {
        known
            .get("calculators")
            .and_then(Value::as_object)
            .map(|map| {
                map.keys()
                    .map(|key| calculator_file_id(key))
                    .collect::<HashSet<_>>()
            })
            .unwrap_or_default()
    });
    let known_values = known
        .and_then(|known| known.get("calculators"))
        .and_then(Value::as_object)
        .map(|values| {
            values
                .iter()
                .map(|(key, value)| {
                    let id = calculator_file_id(key);
                    let mut item = Map::new();
                    item.insert("id".to_string(), Value::from(id.clone()));
                    item.insert("key".to_string(), Value::from(key.clone()));
                    item.insert("value".to_string(), value.clone());
                    (id, Value::Object(item))
                })
                .collect::<HashMap<_, _>>()
        });
    plan_collection(
        &mut plan,
        CALCULATORS_DIRECTORY,
        &root.join(CALCULATORS_DIRECTORY),
        &items,
        known_values.as_ref(),
        known_ids.as_ref(),
        &cached_files,
    )?;
    Ok(plan)
}

/// Write a planned change set (each file atomically); returns the paths actually touched.
pub fn apply_plan(plan: &DiskPlan) -> Result<(), String> {
    for (path, bytes) in &plan.writes {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        }
        atomic_write(path, bytes)
            .map_err(|error| format!("could not save {}: {error}", path.display()))?;
    }
    for path in &plan.deletes {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("could not remove {}: {error}", path.display())),
        }
    }
    if let Ok(mut slot) = SYNCED_FILES.lock() {
        let cache = slot.get_or_insert_with(Default::default);
        let files = cache.entry(plan.root.clone()).or_default();
        for (path, bytes) in &plan.writes {
            if let Ok(relative) = path.strip_prefix(&plan.root) {
                if relative == Path::new(INDEX_FILE_NAME) {
                    files.insert(
                        (INDEX_FILE_NAME.to_string(), INDEX_FILE_NAME.to_string()),
                        CachedObject {
                            bytes: bytes.clone(),
                            value: Value::Null,
                            order: None,
                        },
                    );
                    continue;
                }
                if let (Some(directory), Some(id)) = (
                    relative
                        .parent()
                        .and_then(Path::file_name)
                        .and_then(|v| v.to_str()),
                    relative.file_stem().and_then(|v| v.to_str()),
                ) {
                    if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
                        cache_object(files, directory, id, &value, bytes.clone());
                    }
                }
            }
        }
        for path in &plan.deletes {
            if let Ok(relative) = path.strip_prefix(&plan.root) {
                if let (Some(directory), Some(id)) = (
                    relative
                        .parent()
                        .and_then(Path::file_name)
                        .and_then(|v| v.to_str()),
                    relative.file_stem().and_then(|v| v.to_str()),
                ) {
                    files.remove(&(directory.to_string(), id.to_string()));
                }
            }
        }
        while cache.len() > 8 {
            let Some(oldest) = cache
                .keys()
                .find(|cached_root| *cached_root != &plan.root)
                .cloned()
            else {
                break;
            };
            cache.remove(&oldest);
        }
    }
    Ok(())
}

/// Convert an older single-file project to the split layout. Returns true when it converted.
pub fn migrate_to_split(root: &Path) -> Result<bool, String> {
    if !is_legacy(root)? {
        return Ok(false);
    }
    let (document, _) = read_document(root)?;
    let plan = plan_write(root, &document, None)?;
    apply_plan(&plan)?;
    Ok(true)
}

/// Make sure a project folder ignores hive's local-only files (backups, personal counters).
pub fn ensure_gitignore(root: &Path) {
    let path = root.join(".gitignore");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let present: HashSet<&str> = existing.lines().map(str::trim).collect();
    let missing: Vec<&str> = GITIGNORE_LINES
        .iter()
        .copied()
        .filter(|line| !present.contains(line))
        .collect();
    if missing.is_empty() {
        return;
    }
    let mut contents = existing.clone();
    if !contents.is_empty() && !contents.ends_with('\n') {
        contents.push('\n');
    }
    if existing.is_empty() {
        contents.push_str("# hive: local-only files (safety copies, personal stopwatch)\n");
    }
    for line in missing {
        contents.push_str(line);
        contents.push('\n');
    }
    let _ = atomic_write(&path, contents.as_bytes());
}

/// Every board path a save or a pull can change (for the watcher).
pub fn is_board_path(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut components = relative.components();
    let Some(first) = components.next() else {
        return false;
    };
    let first = first.as_os_str().to_string_lossy();
    if first == INDEX_FILE_NAME {
        return relative.components().count() == 1;
    }
    let collection = first == CALCULATORS_DIRECTORY
        || COLLECTIONS.iter().any(|(_, directory)| first == *directory);
    collection
        && relative.components().count() == 2
        && path.extension().and_then(|extension| extension.to_str()) == Some("json")
}

/// Check whether one watcher path still matches the bytes last written by this process.
/// Missing cache entries represent files this process just deleted or files absent at load time.
pub fn is_synced_path_current(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut components = relative.components();
    let Some(directory) = components
        .next()
        .and_then(|value| value.as_os_str().to_str())
    else {
        return false;
    };
    let id = if directory == INDEX_FILE_NAME {
        if components.next().is_some() {
            return false;
        }
        INDEX_FILE_NAME
    } else {
        if components.next().is_none() || components.next().is_some() {
            return false;
        }
        let Some(id) = path.file_stem().and_then(|value| value.to_str()) else {
            return false;
        };
        id
    };
    let Ok(cache) = SYNCED_FILES.lock() else {
        return false;
    };
    let Some(files) = cache.as_ref().and_then(|files| files.get(root)) else {
        return false;
    };
    match files.get(&(directory.to_string(), id.to_string())) {
        Some(expected) => fs::read(path)
            .ok()
            .is_some_and(|bytes| same_text(&bytes, &expected.bytes)),
        None => !path.exists(),
    }
}

fn plan_collection(
    plan: &mut DiskPlan,
    collection: &str,
    directory: &Path,
    items: &[Value],
    known_values: Option<&HashMap<String, Value>>,
    known_ids: Option<&HashSet<String>>,
    cached_files: &HashMap<(String, String), CachedObject>,
) -> Result<(), String> {
    // Keep each object's stored order while it still fits between its neighbours, so moving or
    // adding one object rewrites only that object's file.
    let ids: Vec<String> = items.iter().map(item_file_id).collect::<Result<_, _>>()?;
    let previous: Vec<Option<f64>> = ids
        .iter()
        .map(|id| {
            cached_files
                .get(&(collection.to_string(), id.clone()))
                .and_then(|entry| entry.order)
        })
        .collect();
    let orders = assign_orders(&previous);

    let mut wanted = HashSet::new();
    for ((item, id), order) in items.iter().zip(&ids).zip(orders) {
        if !wanted.insert(id.clone()) {
            // An exact duplicate entry (same id or identical id-less record) is stored once.
            continue;
        }
        let cache_key = (collection.to_string(), id.clone());
        let cached = cached_files.get(&cache_key);
        let value_is_unchanged = cached.is_some_and(|entry| entry.value == *item)
            || known_values
                .and_then(|values| values.get(id))
                .is_some_and(|known| known == item);
        if value_is_unchanged && cached.is_some_and(|entry| entry.order == Some(order)) {
            continue;
        }
        let mut stored = Map::new();
        stored.insert(ORDER_KEY.to_string(), Value::from(order));
        if let Some(object) = item.as_object() {
            for (key, value) in object {
                stored.insert(key.clone(), value.clone());
            }
        }
        let bytes = pretty(&Value::Object(stored))?;
        let path = directory.join(format!("{id}.json"));
        if let Some(entry) = cached {
            let current = fs::read(&path).map_err(|_| STALE_SAVE_ERROR.to_string())?;
            if !same_text(&current, &entry.bytes) {
                return Err(STALE_SAVE_ERROR.to_string());
            }
        }
        if cached.is_some_and(|entry| same_text(&entry.bytes, &bytes)) {
            continue;
        } else if cached.is_none() && known_ids.is_some() && path.exists() {
            // A file appeared after the last load; leave it intact and let the watcher surface the pull.
            return Err(STALE_SAVE_ERROR.to_string());
        } else if !cached.is_some_and(|entry| same_text(&entry.bytes, &bytes)) {
            plan.writes.push((path, bytes));
        }
    }
    for ((_, id), _) in cached_files
        .iter()
        .filter(|((name, _), _)| name == collection)
    {
        if wanted.contains(id) {
            continue;
        }
        let ours = match known_ids {
            Some(known) => known.contains(id),
            None => true,
        };
        if ours {
            plan.deletes.push(directory.join(format!("{id}.json")));
        }
    }
    Ok(())
}

fn object_values(value: Option<&Value>) -> HashMap<String, Value> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item_file_id(item).ok().map(|id| (id, item.clone())))
                .collect()
        })
        .unwrap_or_default()
}

/// Orders for a list given each item's previous order: keep a previous value when it is still
/// increasing, otherwise place the item just after its predecessor (or between neighbours).
pub fn assign_orders(previous: &[Option<f64>]) -> Vec<f64> {
    // Longest increasing run of kept values is overkill here: a greedy pass keeps the stored value
    // whenever it is above the last assigned one and below the next kept candidate.
    let mut result = Vec::with_capacity(previous.len());
    let mut last = f64::NEG_INFINITY;
    let tree = MaxTree::new(previous);
    for (index, value) in previous.iter().enumerate() {
        let next_kept = tree.first_at_least(index + 1, last);
        // Equal orders are allowed (two people appended at once): reading sorts them by id, and
        // rewriting one of them would only add a change to the next commit.
        let keep = value.filter(|value| {
            value.is_finite() && *value >= last && next_kept.map_or(true, |next| *value <= next)
        });
        let order = match keep {
            Some(value) => value,
            None => {
                let start = if last.is_finite() { last } else { 0.0 };
                match next_kept {
                    Some(next) if next > start + 1e-9 && (next - start) < 2.0 => {
                        start + (next - start) / 2.0
                    }
                    _ => {
                        if last.is_finite() {
                            (last + 1.0).floor()
                        } else {
                            next_kept.map(|next| next - 1.0).unwrap_or(1.0)
                        }
                    }
                }
            }
        };
        result.push(order);
        last = order;
    }
    result
}

struct MaxTree {
    size: usize,
    values: Vec<f64>,
}

impl MaxTree {
    fn new(previous: &[Option<f64>]) -> Self {
        let size = previous.len().next_power_of_two().max(1);
        let mut values = vec![f64::NEG_INFINITY; size * 2];
        for (index, value) in previous.iter().enumerate() {
            values[size + index] = value
                .filter(|value| value.is_finite())
                .unwrap_or(f64::NEG_INFINITY);
        }
        for index in (1..size).rev() {
            values[index] = values[index * 2].max(values[index * 2 + 1]);
        }
        Self { size, values }
    }

    fn first_at_least(&self, start: usize, threshold: f64) -> Option<f64> {
        self.find(1, 0, self.size, start, threshold)
    }

    fn find(
        &self,
        node: usize,
        left: usize,
        right: usize,
        start: usize,
        threshold: f64,
    ) -> Option<f64> {
        if right <= start || self.values[node] < threshold {
            return None;
        }
        if right - left == 1 {
            return (self.values[node] != f64::NEG_INFINITY).then_some(self.values[node]);
        }
        let middle = left + (right - left) / 2;
        self.find(node * 2, left, middle, start, threshold)
            .or_else(|| self.find(node * 2 + 1, middle, right, start, threshold))
    }
}

/// Equal apart from line endings (Git may check files out with CRLF; hive writes LF).
fn same_text(disk: &[u8], ours: &[u8]) -> bool {
    if disk == ours {
        return true;
    }
    let mut normalized = Vec::with_capacity(disk.len());
    let mut index = 0;
    while index < disk.len() {
        if disk[index] == b'\r' && disk.get(index + 1) == Some(&b'\n') {
            index += 1;
            continue;
        }
        normalized.push(disk[index]);
        index += 1;
    }
    normalized == ours
}

fn plan_file(plan: &mut DiskPlan, path: PathBuf, bytes: Vec<u8>) -> Result<(), String> {
    if !fs::read(&path)
        .ok()
        .is_some_and(|disk| same_text(&disk, &bytes))
    {
        plan.writes.push((path, bytes));
    }
    Ok(())
}

fn read_collection(
    directory: &Path,
    warnings: &mut Vec<String>,
) -> Result<Vec<(String, Value, Vec<u8>)>, String> {
    let mut items = Vec::new();
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(items),
        Err(error) => return Err(format!("could not read {}: {error}", directory.display())),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                warnings.push(format!(
                    "Could not read {}: {error}",
                    display_relative(&path)
                ));
                continue;
            }
        };
        match serde_json::from_slice::<Value>(&bytes) {
            Ok(value) if value.is_object() => items.push((stem, value, bytes)),
            _ => {
                let conflict = String::from_utf8_lossy(&bytes).contains("<<<<<<<");
                warnings.push(if conflict {
                    format!(
                        "{} has an unresolved Git merge conflict and was skipped",
                        display_relative(&path)
                    )
                } else {
                    format!("{} is not valid and was skipped", display_relative(&path))
                });
            }
        }
    }
    Ok(items)
}

fn display_relative(path: &Path) -> String {
    let parent = path
        .parent()
        .and_then(|parent| parent.file_name())
        .map(|name| name.to_string_lossy().into_owned());
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    match parent {
        Some(parent) => format!("{parent}/{name}"),
        None => name,
    }
}

fn read_json_object(path: &Path) -> Result<Map<String, Value>, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("could not read {}: {error}", display_relative(path)))?;
    parse_json_object(path, &bytes)
}

fn parse_json_object(path: &Path, bytes: &[u8]) -> Result<Map<String, Value>, String> {
    let value: Value = serde_json::from_slice(&bytes).map_err(|error| {
        if String::from_utf8_lossy(&bytes).contains("<<<<<<<") {
            format!(
                "{} has an unresolved Git merge conflict",
                display_relative(path)
            )
        } else {
            format!("{} is invalid: {error}", display_relative(path))
        }
    })?;
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(format!("{} must contain an object", display_relative(path))),
    }
}

fn ids_in(value: Option<&Value>) -> HashSet<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item_file_id(item).ok())
                .collect()
        })
        .unwrap_or_default()
}

fn order_of(value: &Value) -> f64 {
    value
        .get(ORDER_KEY)
        .and_then(Value::as_f64)
        .unwrap_or(f64::MAX)
}

/// The file name for an object: its id when that is a safe name, otherwise a stable hash. Entries
/// without an id (task log records never change) are named by a hash of their content.
fn item_file_id(item: &Value) -> Result<String, String> {
    match item.get("id").and_then(Value::as_str) {
        Some(id) => Ok(safe_file_id(id)),
        None => {
            let content = serde_json::to_string(item)
                .map_err(|error| format!("could not encode a board entry: {error}"))?;
            Ok(format!("e{:016x}", fnv(&content)))
        }
    }
}

fn safe_file_id(id: &str) -> String {
    let safe = !id.is_empty()
        && id.len() <= 100
        && id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        });
    if safe {
        id.to_string()
    } else {
        format!("h{:016x}", fnv(id))
    }
}

fn calculator_file_id(key: &str) -> String {
    format!("c{:016x}", fnv(key))
}

fn fnv(text: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in text.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

fn pretty(value: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("could not encode board data: {error}"))?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let temporary = path.with_extension(format!(
        "{}.tmp-{}",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("json"),
        std::process::id()
    ));
    fs::write(&temporary, bytes)?;
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project(label: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("hive-board-store-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn legacy() -> Value {
        json!({
            "version": 3,
            "createdAt": 5,
            "notes": [
                {"id": "b", "name": "B", "file": "B.md", "x": 1.0, "y": 2.0, "width": 30.0},
                {"id": "a", "name": "A", "file": "A.md", "x": 3.0, "y": 4.0, "width": 30.0}
            ],
            "links": [{"id": "l1", "from": "a", "to": "b"}],
            "zones": [], "trash": [], "archive": [], "taskLog": [],
            "calculators": {"Bank": {"total": 3}},
            "projectCounters": {"appMs": 10, "activeMs": 4},
            "beaconMarks": []
        })
    }

    #[test]
    fn migrates_round_trips_and_keeps_order() {
        let root = project("roundtrip");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        assert!(migrate_to_split(&root).unwrap());
        let head: Value =
            serde_json::from_slice(&fs::read(root.join(INDEX_FILE_NAME)).unwrap()).unwrap();
        assert!(head.get("notes").is_none());
        assert!(root.join("nodes/a.json").exists() && root.join("nodes/b.json").exists());
        let (document, warnings) = read_document(&root).unwrap();
        assert!(warnings.is_empty());
        let ids: Vec<&str> = document["notes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["b", "a"]);
        assert_eq!(document["calculators"]["Bank"]["total"], 3);
        assert_eq!(document["projectCounters"]["appMs"], 10);
        assert!(!migrate_to_split(&root).unwrap());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn moving_one_node_rewrites_only_its_file() {
        let root = project("one-file");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (mut document, _) = read_document(&root).unwrap();
        let known = document.clone();
        document["notes"][1]["x"] = json!(99.0);
        let plan = plan_write(&root, &document, Some(&known)).unwrap();
        let written: Vec<String> = plan
            .writes
            .iter()
            .map(|(path, _)| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(written, ["a.json"]);
        assert!(plan.deletes.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn changed_object_save_refuses_to_overwrite_an_external_edit() {
        let root = project("concurrent-edit");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (mut document, _) = read_document(&root).unwrap();
        let known = document.clone();
        document["notes"][1]["x"] = json!(99.0);
        fs::write(
            root.join("nodes/a.json"),
            br#"{"_order":2,"id":"a","name":"A","file":"A.md","x":88,"y":4,"width":30}"#,
        )
        .unwrap();

        assert_eq!(
            plan_write(&root, &document, Some(&known)).err().unwrap(),
            STALE_SAVE_ERROR
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn watcher_can_skip_own_object_writes_without_reloading_the_board() {
        let root = project("watcher-own-write");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (mut document, _) = read_document(&root).unwrap();
        let known = document.clone();
        let object_path = root.join("nodes/a.json");
        assert!(is_synced_path_current(&root, &object_path));

        document["notes"][1]["x"] = json!(77.0);
        let plan = plan_write(&root, &document, Some(&known)).unwrap();
        apply_plan(&plan).unwrap();

        assert!(is_synced_path_current(&root, &object_path));
        assert!(is_board_path(&root, &object_path));
        assert!(!is_board_path(&root, &root.join("nodes/a.json.tmp-123")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stale_save_keeps_objects_it_never_knew() {
        let root = project("stale");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (mine, _) = read_document(&root).unwrap();
        // A friend's node arrives through a pull.
        fs::write(root.join("nodes/friend.json"), br#"{"_order": 5, "id": "friend", "name": "F", "file": "F.md", "x": 0, "y": 0, "width": 30}"#).unwrap();
        // This app saves its older document and deletes node "b" itself.
        let mut next = mine.clone();
        next["notes"]
            .as_array_mut()
            .unwrap()
            .retain(|note| note["id"] != "b");
        let plan = plan_write(&root, &next, Some(&mine)).unwrap();
        apply_plan(&plan).unwrap();
        assert!(root.join("nodes/friend.json").exists());
        assert!(!root.join("nodes/b.json").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn two_people_adding_nodes_touch_different_files() {
        let root = project("two-adds");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (base, _) = read_document(&root).unwrap();
        let mut mine = base.clone();
        mine["notes"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id": "mine", "name": "M", "file": "M.md", "x": 0, "y": 0, "width": 30}));
        let plan = plan_write(&root, &mine, Some(&base)).unwrap();
        let written: Vec<String> = plan
            .writes
            .iter()
            .map(|(path, _)| {
                path.strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        assert_eq!(written, ["nodes/mine.json"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn conflicted_object_files_are_reported_not_fatal() {
        let root = project("conflict");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        fs::write(
            root.join("nodes/a.json"),
            "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n",
        )
        .unwrap();
        let (document, warnings) = read_document(&root).unwrap();
        assert_eq!(document["notes"].as_array().unwrap().len(), 1);
        assert!(warnings[0].contains("merge conflict"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn crlf_checkouts_are_not_rewritten() {
        let crlf = b"{\r\n  1\r\n}\r\n";
        assert!(same_text(crlf, b"{\n  1\n}\n"));
        assert!(!same_text(crlf, b"{\n  2\n}\n"));
    }

    #[test]
    fn orders_keep_stored_values_and_fill_gaps() {
        assert_eq!(
            assign_orders(&[Some(1.0), Some(2.0), None]),
            [1.0, 2.0, 3.0]
        );
        assert_eq!(assign_orders(&[None, None]), [1.0, 2.0]);
        let mid = assign_orders(&[Some(1.0), None, Some(2.0)]);
        assert!(mid[1] > 1.0 && mid[1] < 2.0 && mid[2] == 2.0);
        // Moving the last object to the front changes only its own order.
        let moved = assign_orders(&[Some(3.0), Some(1.0), Some(2.0)]);
        assert_eq!(&moved[1..], [1.0, 2.0]);
        assert!(moved[0] < 1.0);
        // Two objects appended by different people with the same order stay as they are.
        assert_eq!(
            assign_orders(&[Some(1.0), Some(2.0), Some(2.0)]),
            [1.0, 2.0, 2.0]
        );
    }

    #[test]
    fn synthetic_three_thousand_note_open_and_save() {
        use std::time::Instant;

        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let base = local.join("Temp").join("claude").join("d43_c");
        fs::create_dir_all(&base).expect("create synthetic benchmark directory");
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = base.join(format!("synthetic-{}-{unique}", std::process::id()));
        fs::create_dir_all(root.join("nodes")).expect("create synthetic nodes");
        fs::create_dir_all(root.join(".hive")).expect("create synthetic local metadata");
        fs::write(
            root.join(INDEX_FILE_NAME),
            pretty(&json!({ "version": 3, "storage": 2 })).unwrap(),
        )
        .expect("write synthetic index");
        fs::write(root.join(LOCAL_FILE), b"{}\n").expect("write synthetic local counters");
        for index in 0..3_000 {
            let id = format!("node-{index:04}");
            let value = json!({
                "_order": index,
                "id": id,
                "name": format!("Node {index}"),
                "file": format!("Node {index}.md"),
                "x": index,
                "y": 0,
                "width": 30
            });
            fs::write(
                root.join("nodes").join(format!("node-{index:04}.json")),
                serde_json::to_vec(&value).unwrap(),
            )
            .expect("write synthetic node");
        }

        let started = Instant::now();
        let (document, warnings) = read_document(&root).expect("open synthetic project");
        let open_time = started.elapsed();
        assert!(warnings.is_empty());
        assert_eq!(document["notes"].as_array().unwrap().len(), 3_000);

        let started = Instant::now();
        let unchanged = plan_write(&root, &document, Some(&document)).expect("plan unchanged save");
        let unchanged_time = started.elapsed();
        assert!(unchanged.writes.is_empty());

        let mut changed_document = document.clone();
        changed_document["notes"][1_500]["x"] = json!(999_999);
        let started = Instant::now();
        let changed =
            plan_write(&root, &changed_document, Some(&document)).expect("plan changed save");
        apply_plan(&changed).expect("apply changed save");
        let changed_time = started.elapsed();
        assert_eq!(changed.writes.len(), 1);
        println!("d43-c synthetic 3000: open={open_time:?}, unchanged-save-plan={unchanged_time:?}, one-note-save={changed_time:?}");

        fs::remove_dir_all(&root).expect("remove synthetic benchmark project");
    }

    #[test]
    fn gitignore_lines_are_added_once() {
        let root = project("gitignore");
        fs::write(root.join(".gitignore"), "node_modules\n").unwrap();
        ensure_gitignore(&root);
        ensure_gitignore(&root);
        let text = fs::read_to_string(root.join(".gitignore")).unwrap();
        assert_eq!(text.matches(".hive/backups/").count(), 1);
        assert!(text.starts_with("node_modules\n"));
        let _ = fs::remove_dir_all(&root);
    }
}
