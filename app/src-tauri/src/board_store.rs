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
use std::time::Instant;

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
/// Case-insensitive note filename ownership, rebuilt on project load and patched on delta saves.
static NOTE_FILE_OWNERS: Mutex<Option<HashMap<PathBuf, NoteFileIndex>>> = Mutex::new(None);
/// Bumped whenever the board changes on disk from outside (a pull). A save based on an older
/// revision is refused, so it cannot treat the newly arrived objects as deleted.
static REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
pub const STALE_SAVE_ERROR: &str = "BOARD_CHANGED_ON_DISK";

pub fn set_synced(root: &Path, document: &Value) {
    if let Ok(mut synced) = SYNCED.lock() {
        *synced = Some((root.to_path_buf(), document.clone()));
    }
    set_note_file_owners(root, document);
}

pub fn cached_object(root: &Path, directory: &str, id: &str) -> Option<Value> {
    let cache = SYNCED_FILES.lock().ok()?;
    let files = cache.as_ref()?.get(root)?;
    let key = if directory == CALCULATORS_DIRECTORY {
        calculator_file_id(id)
    } else {
        safe_file_id(id)
    };
    files
        .get(&(directory.to_string(), key))
        .map(|entry| entry.value.clone())
}

pub fn note_file_owner(root: &Path, file: &str) -> Option<String> {
    NOTE_FILE_OWNERS
        .lock()
        .ok()?
        .as_ref()?
        .get(root)?
        .owner_by_file
        .get(&windows_case_key(file))
        .cloned()
}

#[derive(Default)]
struct NoteFileIndex {
    owner_by_file: HashMap<String, String>,
    file_by_id: HashMap<String, String>,
}

fn set_note_file_owners(root: &Path, document: &Value) {
    let mut owners = NoteFileIndex::default();
    for (file, id) in document
        .get("notes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|note| {
            Some((
                windows_case_key(note.get("file")?.as_str()?),
                note.get("id")?.as_str()?.to_string(),
            ))
        })
    {
        owners.owner_by_file.insert(file.clone(), id.clone());
        owners.file_by_id.insert(id, file);
    }
    if let Ok(mut slot) = NOTE_FILE_OWNERS.lock() {
        let roots = slot.get_or_insert_with(Default::default);
        roots.insert(root.to_path_buf(), owners);
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
    let started = Instant::now();
    let (document, warnings, cached_files) = read_document_with_files(root)?;
    set_synced_files(root, cached_files);
    set_note_file_owners(root, &document);
    if std::env::var_os("HIVE_PROFILE_OPEN").is_some() {
        eprintln!(
            "[d43-c3] board_store.read_document_total: {:.1} ms",
            started.elapsed().as_secs_f64() * 1_000.0
        );
    }
    Ok((document, warnings))
}

fn read_document_with_files(
    root: &Path,
) -> Result<(Value, Vec<String>, HashMap<(String, String), CachedObject>), String> {
    let profile = std::env::var_os("HIVE_PROFILE_OPEN").is_some();
    let started = Instant::now();
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
        let document = Value::Object(head);
        return Ok((document, Vec::new(), cached_files));
    }
    let mut warnings = Vec::new();
    let mut document = head;
    document.remove("storage");
    for (key, directory) in COLLECTIONS {
        let stage = Instant::now();
        let mut items = read_collection(&root.join(directory), &mut warnings)?;
        let read_elapsed = stage.elapsed();
        let count = items.len();
        let stage = Instant::now();
        items.sort_by(|left, right| {
            order_of(&left.1)
                .partial_cmp(&order_of(&right.1))
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| left.0.cmp(&right.0))
        });
        if profile {
            eprintln!(
                "[d43-c3] board_store.collection.{directory}: count={count}, read_parse_ms={:.1}, sort_ms={:.1}",
                read_elapsed.as_secs_f64() * 1_000.0,
                stage.elapsed().as_secs_f64() * 1_000.0
            );
        }
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
    let calculator_started = Instant::now();
    for (id, item, bytes) in read_collection(&root.join(CALCULATORS_DIRECTORY), &mut warnings)? {
        cache_object(&mut cached_files, CALCULATORS_DIRECTORY, &id, &item, bytes);
        if let (Some(key), Some(value)) =
            (item.get("key").and_then(Value::as_str), item.get("value"))
        {
            calculators.insert(key.to_string(), value.clone());
        }
    }
    if profile {
        eprintln!(
            "[d43-c3] board_store.collection.calculators: {:.1} ms",
            calculator_started.elapsed().as_secs_f64() * 1_000.0
        );
    }
    document.insert("calculators".to_string(), Value::Object(calculators));
    if let Ok(local) = read_json_object(&root.join(LOCAL_FILE)) {
        for key in LOCAL_KEYS {
            if let Some(value) = local.get(*key) {
                document.insert((*key).to_string(), value.clone());
            }
        }
    }
    let document = Value::Object(document);
    if profile {
        eprintln!(
            "[d43-c3] board_store.read_document_with_files_total: {:.1} ms",
            started.elapsed().as_secs_f64() * 1_000.0
        );
    }
    Ok((document, warnings, cached_files))
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

#[derive(Clone, Debug)]
pub struct DeltaObject {
    pub id: String,
    pub order: Option<usize>,
    pub record: Value,
}

#[derive(Clone, Debug, Default)]
pub struct CollectionDelta {
    pub upserts: Vec<DeltaObject>,
    pub delete_ids: Vec<String>,
}

/// Plan only the object files named by a delta and any changed project-head fields.
pub fn plan_delta(
    root: &Path,
    collections: &HashMap<String, CollectionDelta>,
    head_patch: &Map<String, Value>,
) -> Result<DiskPlan, String> {
    let mut plan = DiskPlan {
        root: root.to_path_buf(),
        writes: Vec::new(),
        deletes: Vec::new(),
    };
    let mut cached_files = SYNCED_FILES
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref().and_then(|files| files.get(root)).cloned())
        .unwrap_or_default();
    let has_cached_head =
        cached_files.contains_key(&(INDEX_FILE_NAME.to_string(), INDEX_FILE_NAME.to_string()));
    if !has_cached_head {
        let baseline = synced(root).ok_or_else(|| STALE_SAVE_ERROR.to_string())?;
        let (current, _, disk_files) = read_document_with_files(root)?;
        verify_known_document(root, &baseline, &current)?;
        cached_files = disk_files;
    }

    for (collection, delta) in collections {
        if collection == "calculators" {
            plan_delta_collection(
                &mut plan,
                collection,
                &root.join(CALCULATORS_DIRECTORY),
                delta,
                &cached_files,
            )?;
        } else if let Some((_, directory)) = COLLECTIONS.iter().find(|(key, _)| *key == collection)
        {
            plan_delta_collection(
                &mut plan,
                collection,
                &root.join(directory),
                delta,
                &cached_files,
            )?;
        } else {
            return Err(format!("unsupported delta collection: {collection}"));
        }
    }

    let index_path = root.join(INDEX_FILE_NAME);
    if head_patch
        .keys()
        .any(|key| !LOCAL_KEYS.contains(&key.as_str()))
    {
        ensure_regular_or_missing(&index_path)?;
        let expected =
            cached_files.get(&(INDEX_FILE_NAME.to_string(), INDEX_FILE_NAME.to_string()));
        verify_cached_path(&index_path, expected)?;
        let mut head = read_json_object(&index_path)?;
        for (key, value) in head_patch {
            if !LOCAL_KEYS.contains(&key.as_str()) {
                head.insert(key.clone(), value.clone());
            }
        }
        head.insert("storage".to_string(), Value::from(STORAGE_VERSION));
        let bytes = pretty(&Value::Object(head))?;
        if !fs::read(&index_path)
            .ok()
            .is_some_and(|current| same_text(&current, &bytes))
        {
            plan.writes.push((index_path, bytes));
        }
    }

    if head_patch
        .keys()
        .any(|key| LOCAL_KEYS.contains(&key.as_str()))
    {
        let local_path = root.join(LOCAL_FILE);
        ensure_regular_or_missing(&local_path)?;
        let mut local = read_json_object(&local_path).unwrap_or_default();
        let mut changed = false;
        for key in LOCAL_KEYS {
            if let Some(value) = head_patch.get(*key) {
                if local.get(*key) != Some(value) {
                    local.insert((*key).to_string(), value.clone());
                    changed = true;
                }
            }
        }
        if changed {
            plan.writes
                .push((local_path, pretty(&Value::Object(local))?));
        }
    }
    Ok(plan)
}

fn plan_delta_collection(
    plan: &mut DiskPlan,
    collection: &str,
    directory: &Path,
    delta: &CollectionDelta,
    cached_files: &HashMap<(String, String), CachedObject>,
) -> Result<(), String> {
    let cache_directory = if collection == "calculators" {
        CALCULATORS_DIRECTORY
    } else {
        COLLECTIONS
            .iter()
            .find(|(key, _)| *key == collection)
            .map(|(_, directory)| *directory)
            .ok_or_else(|| format!("unsupported delta collection: {collection}"))?
    };
    let mut touched = HashSet::new();
    for item in &delta.upserts {
        if !touched.insert(item.id.clone()) {
            return Err(format!("duplicate {collection} delta id: {}", item.id));
        }
        let (file_id, mut record, previous_task_file) = if collection == "calculators" {
            let file_id = calculator_file_id(&item.id);
            let mut wrapper = Map::new();
            wrapper.insert("id".to_string(), Value::from(file_id.clone()));
            wrapper.insert("key".to_string(), Value::from(item.id.clone()));
            wrapper.insert("value".to_string(), item.record.clone());
            (file_id, Value::Object(wrapper), None)
        } else {
            if collection != "taskLog"
                && item.record.get("id").and_then(Value::as_str) != Some(item.id.as_str())
            {
                return Err(format!(
                    "{collection} delta record id does not match {}",
                    item.id
                ));
            }
            if collection == "taskLog"
                && task_log_delta_id(&item.record).as_deref() != Some(item.id.as_str())
            {
                return Err(format!(
                    "task log delta record id does not match {}",
                    item.id
                ));
            }
            let previous_task_file = if collection == "taskLog" {
                cached_files.iter().find_map(|((name, cached_id), cached)| {
                    (name == cache_directory
                        && task_log_delta_id(&cached.value).as_deref() == Some(item.id.as_str()))
                    .then(|| cached_id.clone())
                })
            } else {
                None
            };
            let file_id = if collection == "taskLog" {
                item_file_id(&item.record)?
            } else {
                safe_file_id(&item.id)
            };
            (file_id, item.record.clone(), previous_task_file)
        };
        let cache_key = (cache_directory.to_string(), file_id.clone());
        let cached = cached_files.get(&cache_key);
        let order_reference_id = previous_task_file.unwrap_or_else(|| file_id.clone());
        let order = delta_order(collection, &order_reference_id, item.order, cached_files)?;
        if let Some(object) = record.as_object_mut() {
            object.insert(ORDER_KEY.to_string(), Value::from(order));
        } else {
            return Err(format!("{collection} delta records must be objects"));
        }
        let path = directory.join(format!("{file_id}.json"));
        let bytes = pretty(&record)?;
        let mut semantic = record.clone();
        if let Some(object) = semantic.as_object_mut() {
            object.remove(ORDER_KEY);
        }
        if cached.is_some_and(|entry| entry.value == semantic && entry.order == Some(order))
            || cached.is_some_and(|entry| same_text(&entry.bytes, &bytes))
        {
            continue;
        }
        if collection == "taskLog" && order_reference_id != file_id {
            let previous_path = directory.join(format!("{order_reference_id}.json"));
            let previous =
                cached_files.get(&(cache_directory.to_string(), order_reference_id.clone()));
            if let Some(previous) = previous {
                ensure_regular_or_missing(&previous_path)?;
                verify_cached_path(&previous_path, Some(previous))?;
                plan.deletes.push(previous_path);
            }
        }
        ensure_regular_or_missing(&path)?;
        verify_cached_path(&path, cached)?;
        plan.writes.push((path, bytes));
    }

    for id in &delta.delete_ids {
        if !touched.insert(id.clone()) {
            return Err(format!("duplicate {collection} delta id: {id}"));
        }
        let file_id = if collection == "calculators" {
            calculator_file_id(id)
        } else if collection == "taskLog" {
            cached_files
                .iter()
                .find_map(|((name, cached_id), cached)| {
                    (name == cache_directory
                        && task_log_delta_id(&cached.value).as_deref() == Some(id.as_str()))
                    .then(|| cached_id.clone())
                })
                .unwrap_or_else(|| safe_file_id(id))
        } else {
            safe_file_id(id)
        };
        let path = directory.join(format!("{file_id}.json"));
        let cached = cached_files.get(&(cache_directory.to_string(), file_id));
        if cached.is_none() {
            if path.exists() {
                return Err(STALE_SAVE_ERROR.to_string());
            }
            continue;
        }
        ensure_regular_or_missing(&path)?;
        verify_cached_path(&path, cached)?;
        plan.deletes.push(path);
    }
    Ok(())
}

fn delta_order(
    collection: &str,
    file_id: &str,
    requested: Option<usize>,
    cached_files: &HashMap<(String, String), CachedObject>,
) -> Result<f64, String> {
    let cache_directory = if collection == "calculators" {
        CALCULATORS_DIRECTORY
    } else {
        COLLECTIONS
            .iter()
            .find(|(key, _)| *key == collection)
            .map(|(_, directory)| *directory)
            .ok_or_else(|| format!("unsupported delta collection: {collection}"))?
    };
    let existing_order = cached_files
        .get(&(cache_directory.to_string(), file_id.to_string()))
        .and_then(|entry| entry.order);
    if collection == "calculators" {
        return Ok(existing_order.unwrap_or(1.0));
    }
    let Some(position) = requested else {
        return Ok(existing_order.unwrap_or_else(|| {
            cached_files
                .iter()
                .filter(|((name, _), _)| name == cache_directory)
                .filter_map(|(_, entry)| entry.order)
                .fold(0.0_f64, f64::max)
                + 1.0
        }));
    };
    let mut ordered = cached_files
        .iter()
        .filter(|((name, id), _)| name == cache_directory && id != file_id)
        .filter_map(|((_, id), entry)| entry.order.map(|order| (order, id.clone())))
        .collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.cmp(&right.1))
    });
    let index = position.min(ordered.len());
    let before = index
        .checked_sub(1)
        .and_then(|index| ordered.get(index))
        .map(|item| item.0);
    let after = ordered.get(index).map(|item| item.0);
    Ok(match (before, after) {
        (Some(before), Some(after)) if after - before > 1e-9 => before + (after - before) / 2.0,
        (Some(before), Some(_)) => before,
        (Some(before), None) => before + 1.0,
        (None, Some(after)) => after - 1.0,
        (None, None) => 1.0,
    })
}

fn task_log_delta_id(value: &Value) -> Option<String> {
    let note_id = value.get("noteId")?.as_str()?;
    let done_at = value
        .get("doneAt")?
        .as_i64()
        .or_else(|| value.get("doneAt")?.as_u64().map(|value| value as i64))?;
    Some(serde_json::to_string(&(note_id, done_at)).ok()?)
}

fn verify_cached_path(path: &Path, cached: Option<&CachedObject>) -> Result<(), String> {
    match cached {
        Some(expected) => {
            let current = fs::read(path).map_err(|_| STALE_SAVE_ERROR.to_string())?;
            if !same_text(&current, &expected.bytes) {
                return Err(STALE_SAVE_ERROR.to_string());
            }
        }
        None if path.exists() => return Err(STALE_SAVE_ERROR.to_string()),
        None => {}
    }
    Ok(())
}

fn ensure_regular_or_missing(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
            "refusing to use a symbolic link as a project file: {}",
            path.display()
        )),
        Ok(metadata) if !metadata.is_file() => Err(format!(
            "project path is not a regular file: {}",
            path.display()
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "could not inspect project file {}: {error}",
            path.display()
        )),
    }
}

fn windows_case_key(value: &str) -> String {
    value.to_lowercase()
}

/// Apply a successful delta to the in-memory merged board without replacing the full document.
pub fn apply_synced_delta(
    root: &Path,
    collections: &HashMap<String, CollectionDelta>,
    head_patch: &Map<String, Value>,
) -> Result<(), String> {
    let mut slot = SYNCED.lock().map_err(|_| "project storage is busy")?;
    let Some((synced_root, document)) = slot.as_mut() else {
        return Err("the synced project document is unavailable".to_string());
    };
    if synced_root != root {
        return Err("the synced project root changed during save".to_string());
    }
    let object = document
        .as_object_mut()
        .ok_or_else(|| "the synced project document is invalid".to_string())?;
    for (key, value) in head_patch {
        object.insert(key.clone(), value.clone());
    }
    for (collection, delta) in collections {
        if collection == "calculators" {
            let values = object
                .entry(collection.clone())
                .or_insert_with(|| Value::Object(Map::new()))
                .as_object_mut()
                .ok_or_else(|| "the synced calculator collection is invalid".to_string())?;
            for id in &delta.delete_ids {
                values.remove(id);
            }
            for item in &delta.upserts {
                values.insert(item.id.clone(), item.record.clone());
            }
            continue;
        }
        let items = object
            .entry(collection.clone())
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
            .ok_or_else(|| format!("the synced {collection} collection is invalid"))?;
        for id in &delta.delete_ids {
            items.retain(|item| {
                collection_delta_id(collection, item).as_deref() != Some(id.as_str())
            });
        }
        for item in &delta.upserts {
            let current = items.iter().position(|value| {
                collection_delta_id(collection, value).as_deref() == Some(item.id.as_str())
            });
            if let Some(index) = current {
                items.remove(index);
            }
            let index = item.order.unwrap_or(items.len()).min(items.len());
            items.insert(index, item.record.clone());
        }
    }
    drop(slot);
    if let Some(delta) = collections.get("notes") {
        if let Ok(mut slot) = NOTE_FILE_OWNERS.lock() {
            let roots = slot.get_or_insert_with(Default::default);
            let index = roots.entry(root.to_path_buf()).or_default();
            for id in &delta.delete_ids {
                if let Some(file) = index.file_by_id.remove(id) {
                    index.owner_by_file.remove(&file);
                }
            }
            for item in &delta.upserts {
                if let Some(old_file) = index.file_by_id.remove(&item.id) {
                    index.owner_by_file.remove(&old_file);
                }
                if let Some(file) = item.record.get("file").and_then(Value::as_str) {
                    let key = windows_case_key(file);
                    index.owner_by_file.insert(key.clone(), item.id.clone());
                    index.file_by_id.insert(item.id.clone(), key);
                }
            }
        }
    }
    Ok(())
}

fn collection_delta_id(collection: &str, value: &Value) -> Option<String> {
    if collection == "taskLog" {
        task_log_delta_id(value)
    } else {
        value.get("id")?.as_str().map(str::to_string)
    }
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
    let mut cached_files = SYNCED_FILES
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref().and_then(|files| files.get(root)).cloned())
        .unwrap_or_default();
    let has_cached_head =
        cached_files.contains_key(&(INDEX_FILE_NAME.to_string(), INDEX_FILE_NAME.to_string()));
    if known.is_some() && !has_cached_head {
        // The bounded cache may evict an inactive project's baseline while a stale save is still
        // pending. Reload the current split board, but first prove every object known to this save
        // is unchanged; this lets us preserve pulled-in objects without adopting external edits to
        // objects the stale save might overwrite or delete.
        let (current, _, disk_files) = read_document_with_files(root)?;
        verify_known_document(root, known.unwrap(), &current)?;
        cached_files = disk_files;
    }

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

fn verify_known_document(root: &Path, known: &Value, current: &Value) -> Result<(), String> {
    for (collection, _) in COLLECTIONS {
        let known_values = object_values(known.get(*collection));
        let current_values = object_values(current.get(*collection));
        for (id, value) in &known_values {
            if current_values.get(id) != Some(value) {
                return Err(STALE_SAVE_ERROR.to_string());
            }
        }

        let known_ids = ids_in(known.get(*collection));
        let known_order = ordered_ids(known.get(*collection))?;
        let current_known_order = ordered_ids(current.get(*collection))?
            .into_iter()
            .filter(|id| known_ids.contains(id))
            .collect::<Vec<_>>();
        if known_order != current_known_order {
            return Err(STALE_SAVE_ERROR.to_string());
        }
    }

    let known_calculators = known.get("calculators").and_then(Value::as_object);
    let current_calculators = current.get("calculators").and_then(Value::as_object);
    if let Some(known_calculators) = known_calculators {
        for (key, value) in known_calculators {
            if current_calculators.and_then(|values| values.get(key)) != Some(value) {
                return Err(STALE_SAVE_ERROR.to_string());
            }
        }
    }

    if let (Some(known), Some(current)) = (known.as_object(), current.as_object()) {
        for (key, value) in known {
            if COLLECTIONS.iter().any(|(collection, _)| *collection == key)
                || key == "calculators"
                || LOCAL_KEYS.contains(&key.as_str())
            {
                continue;
            }
            if current.get(key) != Some(value) {
                return Err(STALE_SAVE_ERROR.to_string());
            }
        }
    } else {
        return Err(format!("{}: invalid baseline document", root.display()));
    }
    Ok(())
}

fn ordered_ids(value: Option<&Value>) -> Result<Vec<String>, String> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().map(item_file_id).collect())
        .unwrap_or_else(|| Ok(Vec::new()))
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
    fn delta_save_writes_and_syncs_only_the_changed_object() {
        let _store = STORE_LOCK.lock().unwrap();
        let root = project("delta-one-object");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (document, _) = read_document(&root).unwrap();
        set_synced(&root, &document);

        let mut note = document["notes"][1].clone();
        note["x"] = json!(99.0);
        let collections = HashMap::from([(
            "notes".to_string(),
            CollectionDelta {
                upserts: vec![DeltaObject {
                    id: "a".to_string(),
                    order: None,
                    record: note,
                }],
                delete_ids: Vec::new(),
            },
        )]);
        let plan = plan_delta(&root, &collections, &Map::new()).unwrap();
        let written = plan
            .writes
            .iter()
            .map(|(path, _)| {
                path.strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect::<Vec<_>>();
        assert_eq!(written, ["nodes/a.json"]);
        assert!(plan.deletes.is_empty());
        apply_plan(&plan).unwrap();
        apply_synced_delta(&root, &collections, &Map::new()).unwrap();
        assert_eq!(synced(&root).unwrap()["notes"][1]["x"], 99.0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn task_log_delta_uses_stable_note_and_completion_identity() {
        let _store = STORE_LOCK.lock().unwrap();
        let root = project("delta-task-log");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (document, _) = read_document(&root).unwrap();
        set_synced(&root, &document);
        let record = json!({ "noteId": "a", "name": "A", "doneAt": 123 });
        let id = task_log_delta_id(&record).unwrap();
        let add = HashMap::from([(
            "taskLog".to_string(),
            CollectionDelta {
                upserts: vec![DeltaObject {
                    id: id.clone(),
                    order: Some(0),
                    record,
                }],
                delete_ids: Vec::new(),
            },
        )]);
        let plan = plan_delta(&root, &add, &Map::new()).unwrap();
        assert_eq!(plan.writes.len(), 1);
        apply_plan(&plan).unwrap();
        apply_synced_delta(&root, &add, &Map::new()).unwrap();
        assert_eq!(synced(&root).unwrap()["taskLog"][0]["doneAt"], 123);

        let remove = HashMap::from([(
            "taskLog".to_string(),
            CollectionDelta {
                upserts: Vec::new(),
                delete_ids: vec![id],
            },
        )]);
        let plan = plan_delta(&root, &remove, &Map::new()).unwrap();
        assert_eq!(plan.deletes.len(), 1);
        apply_plan(&plan).unwrap();
        apply_synced_delta(&root, &remove, &Map::new()).unwrap();
        assert!(synced(&root).unwrap()["taskLog"]
            .as_array()
            .unwrap()
            .is_empty());
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
    fn stale_save_recovers_an_evicted_baseline_without_adopting_known_edits() {
        let root = project("stale-cache-miss");
        fs::write(
            root.join(INDEX_FILE_NAME),
            serde_json::to_vec(&legacy()).unwrap(),
        )
        .unwrap();
        migrate_to_split(&root).unwrap();
        let (mine, _) = read_document(&root).unwrap();
        if let Ok(mut cache) = SYNCED_FILES.lock() {
            cache.as_mut().unwrap().remove(&root);
        }

        // An object added by a pull is unknown to this save and must remain untouched.
        fs::write(
            root.join("nodes/friend.json"),
            br#"{"_order":5,"id":"friend","name":"F","file":"F.md","x":0,"y":0,"width":30}"#,
        )
        .unwrap();
        let mut next = mine.clone();
        next["notes"]
            .as_array_mut()
            .unwrap()
            .retain(|note| note["id"] != "b");
        let plan = plan_write(&root, &next, Some(&mine)).unwrap();
        apply_plan(&plan).unwrap();
        assert!(root.join("nodes/friend.json").exists());
        assert!(!root.join("nodes/b.json").exists());

        // A cache miss must not turn an edit to a known object into the new baseline.
        if let Ok(mut cache) = SYNCED_FILES.lock() {
            cache.as_mut().unwrap().remove(&root);
        }
        fs::write(
            root.join("nodes/b.json"),
            br#"{"_order":1,"id":"b","name":"B","file":"B.md","x":1,"y":2,"width":30}"#,
        )
        .unwrap();
        fs::write(
            root.join("nodes/a.json"),
            br#"{"_order":2,"id":"a","name":"A","file":"A.md","x":88,"y":4,"width":30}"#,
        )
        .unwrap();
        assert_eq!(
            plan_write(&root, &next, Some(&mine)).err().as_deref(),
            Some(STALE_SAVE_ERROR)
        );
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
