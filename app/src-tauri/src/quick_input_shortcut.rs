use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

/// Shortcut activation: inside hive (main window focused) the Inbox dialog opens in the app itself;
/// anywhere else the separate always-on-top quick input window is shown and forced to the foreground.
pub fn activate_quick_input(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let visible = main.is_visible().unwrap_or(false);
        let focused = main.is_focused().unwrap_or(false);
        let minimized = main.is_minimized().unwrap_or(false);
        if visible && focused && !minimized {
            let result = main.emit("hive://quick-input-in-app", ());
            log_activation(app, &format!("in-app dialog (emit ok: {})", result.is_ok()));
            return;
        }
    }
    show_quick_input_window(app);
}

pub fn show_quick_input_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window("quick-input") else {
        log_activation(app, "quick input window missing");
        return;
    };
    let was_visible = window.is_visible().unwrap_or(false);
    if !was_visible {
        let _ = window.center();
    }
    let shown = window.show().is_ok();
    let focused = window.set_focus().is_ok();
    #[cfg(windows)]
    let forced = window.hwnd().map(|hwnd| force_foreground(hwnd.0 as _)).unwrap_or(false);
    #[cfg(not(windows))]
    let forced = false;
    let _ = window.emit("hive://quick-input-focus", ());
    log_activation(app, &format!("window (was visible: {was_visible}, show: {shown}, set_focus: {focused}, foreground: {forced})"));
}

/// Windows refuses SetForegroundWindow from a background process; attaching to the current
/// foreground thread for the call lifts that lock so the input really receives the keyboard.
#[cfg(windows)]
fn force_foreground(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
    };
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground == hwnd {
            return true;
        }
        let current = GetCurrentThreadId();
        let foreground_thread = if foreground.is_null() { 0 } else { GetWindowThreadProcessId(foreground, std::ptr::null_mut()) };
        let attached = foreground_thread != 0 && foreground_thread != current && AttachThreadInput(current, foreground_thread, 1) != 0;
        BringWindowToTop(hwnd);
        let ok = SetForegroundWindow(hwnd) != 0;
        if attached {
            AttachThreadInput(current, foreground_thread, 0);
        }
        ok
    }
}

/// Small rolling diagnostics log (<app log dir>/quick-input.log) so a failed activation on the
/// user's machine can be read back; trimmed to the last ~200 lines.
fn log_activation(app: &AppHandle, message: &str) {
    let Ok(dir) = app.path().app_log_dir() else { return };
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("quick-input.log");
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let mut lines: Vec<String> = std::fs::read_to_string(&path)
        .map(|text| text.lines().map(str::to_string).collect())
        .unwrap_or_default();
    lines.push(format!("{stamp} {message}"));
    let start = lines.len().saturating_sub(200);
    let _ = std::fs::write(&path, lines[start..].join("
") + "
");
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Modifiers {
    control: bool,
    alt: bool,
    shift: bool,
    windows: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ShortcutSpec {
    key: u32,
    modifiers: Modifiers,
}

impl ShortcutSpec {
    fn parse(value: &str) -> Result<Self, String> {
        let mut parts = value.split('+').map(str::trim).collect::<Vec<_>>();
        let key_name = parts.pop().filter(|part| !part.is_empty())
            .ok_or_else(|| "Choose a supported key combination.".to_string())?;
        let mut modifiers = Modifiers::default();

        for part in parts {
            let slot = match part.to_ascii_lowercase().as_str() {
                "ctrl" | "control" => &mut modifiers.control,
                "alt" | "option" => &mut modifiers.alt,
                "shift" => &mut modifiers.shift,
                "super" | "meta" | "win" | "windows" => &mut modifiers.windows,
                _ => return Err("Choose a supported key combination.".to_string()),
            };
            if *slot {
                return Err("A modifier can only appear once.".to_string());
            }
            *slot = true;
        }

        if !modifiers.control && !modifiers.alt && !modifiers.windows {
            return Err("Use Ctrl, Alt, or the Windows key with the shortcut.".to_string());
        }

        let key = parse_key(key_name)
            .ok_or_else(|| "Choose a supported letter, number, function, Space, Enter, or Escape key.".to_string())?;
        Ok(Self { key, modifiers })
    }
}

fn parse_key(value: &str) -> Option<u32> {
    let upper = value.to_ascii_uppercase();
    if upper.len() == 1 {
        let byte = upper.as_bytes()[0];
        if byte.is_ascii_uppercase() || byte.is_ascii_digit() {
            return Some(u32::from(byte));
        }
    }

    match upper.as_str() {
        "SPACE" => Some(0x20),
        "ENTER" => Some(0x0D),
        "ESCAPE" | "ESC" => Some(0x1B),
        _ => upper.strip_prefix('F')
            .and_then(|number| number.parse::<u32>().ok())
            .filter(|number| (1..=24).contains(number))
            .map(|number| 0x70 + number - 1),
    }
}

pub struct QuickInputShortcutService {
    app: AppHandle,
    #[cfg(windows)]
    hook: std::sync::Mutex<Option<HookRuntime>>,
}

impl QuickInputShortcutService {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            #[cfg(windows)]
            hook: std::sync::Mutex::new(None),
        }
    }

    pub fn configure(&self, shortcut: Option<String>) -> Result<bool, String> {
        #[cfg(windows)]
        {
            let parsed = shortcut.as_deref().map(ShortcutSpec::parse).transpose()?;
            let mut hook = self.hook.lock().map_err(|_| "Shortcut hook state is unavailable.".to_string())?;
            if hook.is_none() {
                *hook = Some(start_hook(self.app.clone())?);
            }
            let runtime = hook.as_ref().expect("hook was just initialized");
            runtime.set_shortcut(parsed)?;
            Ok(true)
        }

        #[cfg(not(windows))]
        {
            let _ = shortcut;
            Ok(false)
        }
    }
}

#[cfg(windows)]
struct HookRuntime {
    shared: Arc<HookShared>,
    _hook_thread: std::thread::JoinHandle<()>,
    _event_thread: std::thread::JoinHandle<()>,
}

#[cfg(windows)]
impl HookRuntime {
    fn set_shortcut(&self, shortcut: Option<ShortcutSpec>) -> Result<(), String> {
        let mut keyboard = self.shared.keyboard.lock()
            .map_err(|_| "Shortcut hook state is unavailable.".to_string())?;
        keyboard.shortcut = shortcut;
        Ok(())
    }
}

#[cfg(windows)]
struct HookShared {
    keyboard: std::sync::Mutex<KeyboardState>,
    activate: std::sync::mpsc::Sender<()>,
}

#[cfg(windows)]
#[derive(Default)]
struct KeyboardState {
    shortcut: Option<ShortcutSpec>,
    pressed: std::collections::HashSet<u32>,
    swallowed_key: Option<u32>,
}

#[cfg(windows)]
impl KeyboardState {
    fn process(&mut self, key: u32, pressed: bool) -> (bool, bool) {
        let modifiers_match = pressed
            && !is_modifier_key(key)
            && self.shortcut
                .filter(|shortcut| shortcut.key == key)
                .is_some_and(|shortcut| self.modifiers_match(shortcut.modifiers));
        self.process_event(key, pressed, modifiers_match)
    }

    fn process_event(&mut self, key: u32, pressed: bool, modifiers_match: bool) -> (bool, bool) {
        if !pressed {
            self.pressed.remove(&key);
            if self.swallowed_key == Some(key) {
                self.swallowed_key = None;
                return (true, false);
            }
            return (false, false);
        }

        let newly_pressed = self.pressed.insert(key);
        if self.swallowed_key == Some(key) {
            return (true, false);
        }
        if !newly_pressed || is_modifier_key(key) {
            return (false, false);
        }

        let Some(shortcut) = self.shortcut else {
            return (false, false);
        };
        if shortcut.key != key || !modifiers_match {
            return (false, false);
        }

        self.swallowed_key = Some(key);
        (true, true)
    }

    /// Modifier state comes from Windows itself, not from tracked key-ups: a key-up lost to the secure
    /// desktop (Win+L, UAC) must never leave a "stuck" Ctrl that makes a plain Alt+Space match.
    fn modifiers_match(&self, expected: Modifiers) -> bool {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
        let down = |key: i32| unsafe { GetAsyncKeyState(key) } as u16 & 0x8000 != 0;
        let actual = Modifiers {
            control: down(0x11),
            alt: down(0x12),
            shift: down(0x10),
            windows: down(0x5B) || down(0x5C),
        };
        actual == expected
    }
}

#[cfg(windows)]
fn is_modifier_key(key: u32) -> bool {
    matches!(key, 0x10 | 0x11 | 0x12 | 0xA0..=0xA5 | 0x5B | 0x5C)
}

#[cfg(windows)]
static HOOK_SHARED: std::sync::OnceLock<std::sync::Mutex<Option<Arc<HookShared>>>> = std::sync::OnceLock::new();

#[cfg(windows)]
fn start_hook(app: AppHandle) -> Result<HookRuntime, String> {
    use std::sync::mpsc;
    use std::time::Duration;

    let (activation_tx, activation_rx) = mpsc::channel();
    let shared = Arc::new(HookShared {
        keyboard: std::sync::Mutex::new(KeyboardState::default()),
        activate: activation_tx,
    });
    let event_thread = std::thread::Builder::new()
        .name("hive-quick-input-event".to_string())
        .spawn(move || {
            while activation_rx.recv().is_ok() {
                let app_handle = app.clone();
                if let Err(error) = app.run_on_main_thread(move || activate_quick_input(&app_handle)) {
                    eprintln!("Could not show quick input after shortcut activation: {error}");
                }
            }
        })
        .map_err(|error| format!("Could not start shortcut event dispatch: {error}"))?;

    let (ready_tx, ready_rx) = mpsc::channel();
    let hook_shared = shared.clone();
    let hook_thread = std::thread::Builder::new()
        .name("hive-quick-input-keyboard-hook".to_string())
        .spawn(move || keyboard_hook_thread(hook_shared, ready_tx))
        .map_err(|error| format!("Could not start the keyboard hook thread: {error}"))?;

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(HookRuntime {
            shared,
            _hook_thread: hook_thread,
            _event_thread: event_thread,
        }),
        Ok(Err(error)) => Err(error),
        Err(error) => Err(format!("The keyboard hook did not start: {error}")),
    }
}

#[cfg(windows)]
fn keyboard_hook_thread(shared: Arc<HookShared>, ready: std::sync::mpsc::Sender<Result<(), String>>) {
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetMessageW, PeekMessageW, SetWindowsHookExW, TranslateMessage,
        UnhookWindowsHookEx, MSG, PM_NOREMOVE, WH_KEYBOARD_LL,
    };

    let mut message = MSG::default();
    unsafe {
        // Creating the message queue is required before Windows can dispatch this hook.
        PeekMessageW(&mut message, null_mut(), 0, 0, PM_NOREMOVE);
    }

    let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(low_level_keyboard_proc), null_mut(), 0) };
    if hook.is_null() {
        let _ = ready.send(Err(format!("Could not install the Windows keyboard hook: {}", std::io::Error::last_os_error())));
        return;
    }

    let hook_state = HOOK_SHARED.get_or_init(|| std::sync::Mutex::new(None));
    match hook_state.lock() {
        Ok(mut slot) => *slot = Some(shared),
        Err(_) => {
            unsafe { UnhookWindowsHookEx(hook); }
            let _ = ready.send(Err("Shortcut hook state is unavailable.".to_string()));
            return;
        }
    }
    if ready.send(Ok(())).is_err() {
        unsafe { UnhookWindowsHookEx(hook); }
        return;
    }

    loop {
        let result = unsafe { GetMessageW(&mut message, null_mut(), 0, 0) };
        if result <= 0 {
            break;
        }
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    unsafe { UnhookWindowsHookEx(hook); }
    if let Ok(mut slot) = hook_state.lock() {
        *slot = None;
    }
}

#[cfg(windows)]
unsafe extern "system" fn low_level_keyboard_proc(
    code: i32,
    wparam: windows_sys::Win32::Foundation::WPARAM,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::LRESULT {
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, KBDLLHOOKSTRUCT, HC_ACTION, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
        WM_SYSKEYUP,
    };

    if code == HC_ACTION as i32 {
        let event = unsafe { (lparam as *const KBDLLHOOKSTRUCT).as_ref() };
        if let Some(event) = event {
            let is_down = matches!(wparam as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            let is_up = matches!(wparam as u32, WM_KEYUP | WM_SYSKEYUP);
            if is_down || is_up {
                let shared = HOOK_SHARED.get()
                    .and_then(|slot| slot.lock().ok()?.clone());
                if let Some(shared) = shared {
                    let (swallow, activate) = shared.keyboard.lock()
                        .map(|mut keyboard| keyboard.process(event.vkCode, is_down))
                        .unwrap_or((false, false));
                    if activate {
                        let _ = shared.activate.send(());
                    }
                    if swallow {
                        return 1;
                    }
                }
            }
        }
    }

    unsafe { CallNextHookEx(null_mut(), code, wparam, lparam) }
}

#[cfg(test)]
mod tests {
    use super::{parse_key, Modifiers, ShortcutSpec};

    #[cfg(windows)]
    use super::KeyboardState;

    #[test]
    fn parses_required_windows_shortcut_examples() {
        assert_eq!(ShortcutSpec::parse("Ctrl+Alt+Space"), Ok(ShortcutSpec {
            key: 0x20,
            modifiers: Modifiers { control: true, alt: true, shift: false, windows: false },
        }));
        assert_eq!(ShortcutSpec::parse("Ctrl+Shift+K").unwrap().key, u32::from(b'K'));
        assert_eq!(ShortcutSpec::parse("Win+Alt+N").unwrap().key, u32::from(b'N'));
        assert_eq!(ShortcutSpec::parse("Ctrl+Alt+Escape").unwrap().key, 0x1B);
    }

    #[test]
    fn rejects_invalid_or_duplicate_shortcut_parts() {
        assert!(ShortcutSpec::parse("Shift+K").is_err());
        assert!(ShortcutSpec::parse("Ctrl+Ctrl+K").is_err());
        assert!(ShortcutSpec::parse("Ctrl+Alt+Nope").is_err());
    }

    #[test]
    fn maps_function_keys_to_virtual_key_codes() {
        assert_eq!(parse_key("F24"), Some(0x87));
        assert_eq!(parse_key("F25"), None);
    }

    #[cfg(windows)]
    #[test]
    fn every_shortcut_press_activates_once_after_keyup_even_when_the_window_changes_focus() {
        let key = 0x20;
        let mut state = KeyboardState {
            shortcut: Some(ShortcutSpec {
                key,
                modifiers: Modifiers { control: true, alt: true, shift: false, windows: false },
            }),
            ..KeyboardState::default()
        };

        assert_eq!(state.process_event(key, true, true), (true, true));
        assert_eq!(state.process_event(key, true, true), (true, false));
        assert_eq!(state.process_event(key, false, false), (true, false));
        assert_eq!(state.swallowed_key, None);

        assert_eq!(state.process_event(key, true, true), (true, true));
    }
}
