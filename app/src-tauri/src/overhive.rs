use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

const LABEL: &str = "messages-overhive";

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    cards: Vec<Value>,
    reduce_motion: bool,
    #[serde(default)]
    revision: u64,
}

#[derive(Default)]
pub struct OverhiveState {
    snapshot: Mutex<Snapshot>,
    dismissed: Mutex<HashSet<String>>,
    revision: AtomicU64,
}

#[derive(Clone, Copy, Deserialize)]
pub struct CardRect { x: f64, y: f64, width: f64, height: f64 }

fn discard_dismissed(snapshot: &mut Snapshot, dismissed: &HashSet<String>) {
    snapshot.cards.retain(|card| card["id"].as_str().is_some_and(|id| !dismissed.contains(id)));
}

#[tauri::command]
pub fn sync_overhive(app: AppHandle, window: WebviewWindow, state: tauri::State<'_, OverhiveState>, mut snapshot: Snapshot) -> Result<(), String> {
    if window.label() != "main" { return Err("Only hive owns reminder delivery".into()); }
    // Serialize snapshots and desktop actions through emission, so an older
    // sync cannot overwrite a dismissal or show the window after it was hidden.
    let mut current = state.snapshot.lock().map_err(|_| "Reminder state unavailable")?;
    let dismissed = state.dismissed.lock().map_err(|_| "Reminder state unavailable")?;
    discard_dismissed(&mut snapshot, &dismissed);
    drop(dismissed);
    snapshot.revision = state.revision.fetch_add(1, Ordering::SeqCst) + 1;
    *current = snapshot.clone();
    let overlay = app.get_webview_window(LABEL).ok_or("Desktop reminder window unavailable")?;
    if snapshot.cards.is_empty() {
        overlay.hide().map_err(|e| e.to_string())?;
    } else {
        if !overlay.is_visible().map_err(|e| e.to_string())? {
            overlay.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
        }
        position_on_primary(&overlay)?;
        overlay.show().map_err(|e| e.to_string())?;
    }
    overlay.emit("hive://overhive-state", &snapshot).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_overhive_snapshot(window: WebviewWindow, state: tauri::State<'_, OverhiveState>) -> Result<Snapshot, String> {
    if window.label() != LABEL { return Err("Invalid reminder window".into()); }
    Ok(state.snapshot.lock().map_err(|_| "Reminder state unavailable")?.clone())
}

fn position_on_primary(window: &WebviewWindow) -> Result<(), String> {
    let monitor = window.primary_monitor().map_err(|e| e.to_string())?.ok_or("Primary monitor unavailable")?;
    let size = monitor.size();
    let width = (420.0 * monitor.scale_factor()).round().min(size.width as f64) as u32;
    window.set_size(PhysicalSize::new(width, size.height)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(monitor.position().x + size.width as i32 - width as i32, monitor.position().y))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_overhive_regions(window: WebviewWindow, rects: Vec<CardRect>) -> Result<(), String> {
    if window.label() != LABEL { return Err("Invalid reminder window".into()); }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let regions = physical_regions(&rects, scale, size.width, size.height);
    apply_regions(&window, &regions)?;
    window.set_ignore_cursor_events(regions.is_empty()).map_err(|e| e.to_string())
}

fn physical_regions(rects: &[CardRect], scale: f64, width: u32, height: u32) -> Vec<[i32; 4]> {
    rects.iter().filter_map(|r| {
        if ![r.x, r.y, r.width, r.height, scale].iter().all(|n| n.is_finite()) || r.width <= 0.0 || r.height <= 0.0 || scale <= 0.0 { return None; }
        let left = (r.x * scale).floor().clamp(0.0, width as f64) as i32;
        let top = (r.y * scale).floor().clamp(0.0, height as f64) as i32;
        let right = ((r.x + r.width) * scale).ceil().clamp(0.0, width as f64) as i32;
        let bottom = ((r.y + r.height) * scale).ceil().clamp(0.0, height as f64) as i32;
        (right > left && bottom > top).then_some([left, top, right, bottom])
    }).collect()
}

#[cfg(windows)]
fn apply_regions(window: &WebviewWindow, rects: &[[i32; 4]]) -> Result<(), String> {
    use windows_sys::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_OR};
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as _;
    unsafe {
        let union = CreateRectRgn(0, 0, 0, 0);
        if union.is_null() { return Err("Could not create reminder hit region".into()); }
        for &[left, top, right, bottom] in rects {
            let part = CreateRectRgn(left, top, right, bottom);
            if part.is_null() { DeleteObject(union); return Err("Could not create reminder hit region".into()); }
            let combined = CombineRgn(union, union, part, RGN_OR);
            DeleteObject(part);
            if combined == 0 { DeleteObject(union); return Err("Could not combine reminder hit regions".into()); }
        }
        // On success Windows owns the region; on failure the caller must release it.
        if SetWindowRgn(hwnd, union, 1) == 0 { DeleteObject(union); return Err("Could not apply reminder hit regions".into()); }
    }
    Ok(())
}

#[cfg(not(windows))]
fn apply_regions(_window: &WebviewWindow, _rects: &[[i32; 4]]) -> Result<(), String> {
    Err("Overhive currently requires Windows".into())
}

#[tauri::command]
pub fn overhive_action(app: AppHandle, window: WebviewWindow, state: tauri::State<'_, OverhiveState>, id: String, action: String) -> Result<(), String> {
    if window.label() != LABEL { return Err("Invalid reminder window".into()); }
    if action != "dismiss" && action != "go-to" { return Err("Invalid reminder action".into()); }
    let mut snapshot = state.snapshot.lock().map_err(|_| "Reminder state unavailable")?;
    let Some(card) = snapshot.cards.iter().find(|card| card["id"].as_str() == Some(&id)) else { return Ok(()); };
    if action == "go-to" && card["available"].as_bool() != Some(true) { return Err("Node unavailable".into()); }
    if action == "go-to" {
        crate::open_main_window(&app);
        #[cfg(windows)]
        if let Some(main) = app.get_webview_window("main") { foreground_main(&main); }
    }
    state.dismissed.lock().map_err(|_| "Reminder state unavailable")?.insert(id.clone());
    snapshot.cards.retain(|card| card["id"].as_str() != Some(&id));
    snapshot.revision = state.revision.fetch_add(1, Ordering::SeqCst) + 1;
    app.emit_to("main", "hive://overhive-action", serde_json::json!({ "id": id, "action": action })).map_err(|e| e.to_string())?;
    if snapshot.cards.is_empty() { window.hide().map_err(|e| e.to_string())?; }
    window.emit("hive://overhive-state", &*snapshot).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn foreground_main(window: &WebviewWindow) {
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow};
    let Ok(hwnd) = window.hwnd() else { return; };
    unsafe {
        let hwnd = hwnd.0 as _;
        let foreground = GetForegroundWindow();
        let current = GetCurrentThreadId();
        let thread = if foreground.is_null() { 0 } else { GetWindowThreadProcessId(foreground, std::ptr::null_mut()) };
        let attached = thread != 0 && thread != current && AttachThreadInput(current, thread, 1) != 0;
        BringWindowToTop(hwnd); SetForegroundWindow(hwnd);
        if attached { AttachThreadInput(current, thread, 0); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn regions_scale_clip_and_exclude_empty_or_invalid_frames() {
        let rects = [CardRect { x: -2.0, y: 4.0, width: 12.0, height: 10.0 }, CardRect { x: 5.0, y: 5.0, width: 0.0, height: 10.0 }, CardRect { x: f64::NAN, y: 0.0, width: 10.0, height: 10.0 }];
        assert_eq!(physical_regions(&rects, 1.5, 14, 100), vec![[0, 6, 14, 21]]);
    }
    #[test]
    fn late_main_snapshot_cannot_resurrect_a_card_closed_on_desktop() {
        let mut snapshot = Snapshot { cards: vec![serde_json::json!({"id":"closed"}), serde_json::json!({"id":"kept"}), serde_json::json!({"text":"invalid"})], reduce_motion: true, ..Snapshot::default() };
        discard_dismissed(&mut snapshot, &HashSet::from(["closed".to_string()]));
        assert_eq!(snapshot.cards, vec![serde_json::json!({"id":"kept"})]);
        assert!(snapshot.reduce_motion);
    }
}
