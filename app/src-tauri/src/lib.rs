mod backup;
mod export;
mod overhive;
mod project;
mod quick_input_shortcut;
mod settings;
mod source;
mod spellcheck;
mod watcher;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

#[derive(Default)]
struct AppLifecycle {
    quit_requested: AtomicBool,
    first_tray_notice_sent: AtomicBool,
    tray_notice: Mutex<(u64, bool)>,
}

#[tauri::command]
fn set_quit_requested(state: tauri::State<'_, AppLifecycle>, requested: bool) {
    state.quit_requested.store(requested, Ordering::SeqCst);
}

#[tauri::command]
fn configure_quick_input_shortcut(
    state: tauri::State<'_, quick_input_shortcut::QuickInputShortcutService>,
    shortcut: Option<String>,
) -> Result<bool, String> {
    state.configure(shortcut)
}

fn open_main_window(app: &tauri::AppHandle) {
    if let Some(lifecycle) = app.try_state::<AppLifecycle>() {
        if let Ok(mut notice) = lifecycle.tray_notice.lock() {
            notice.0 = notice.0.wrapping_add(1);
            notice.1 = false;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("hive://main-restored", ());
    }
}

fn open_quick_input_window(app: &tauri::AppHandle) {
    quick_input_shortcut::show_quick_input_window(app);
}

fn build_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open-hive", "Open hive", true, None::<&str>)?;
    let quick_input = MenuItem::with_id(app, "quick-input", "Quick input", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick_input, &separator, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("bundled app icon").clone())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open-hive" => open_main_window(app),
            "quick-input" => open_quick_input_window(app),
            "quit" => {
                let _ = app.emit("hive://quit-request", ());
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppLifecycle::default())
        .manage(overhive::OverhiveState::default())
        .manage(project::ProjectState::default())
        .setup(|app| {
            app.manage(quick_input_shortcut::QuickInputShortcutService::new(app.handle().clone()));
            app.manage(watcher::ProjectWatcher::new(app.handle().clone()));
            build_tray(app)?;
            let config_dir = app.path().app_config_dir()?;
            let packaged_dictionaries = app.path().resource_dir()?.join("dictionaries");
            let dictionary_dir = if packaged_dictionaries.is_dir() {
                packaged_dictionaries
            } else {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("dictionaries")
            };
            app.manage(spellcheck::SpellcheckService::new(
                dictionary_dir,
                config_dir,
            ));
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                let Some(lifecycle) = window.app_handle().try_state::<AppLifecycle>() else {
                    return;
                };
                if lifecycle.quit_requested.load(Ordering::SeqCst) {
                    return;
                }

                api.prevent_close();
                if !lifecycle
                    .first_tray_notice_sent
                    .swap(true, Ordering::SeqCst)
                {
                    let generation = match lifecycle.tray_notice.lock() {
                        Ok(mut notice) => {
                            notice.0 = notice.0.wrapping_add(1);
                            notice.1 = true;
                            notice.0
                        }
                        Err(_) => return,
                    };
                    let _ = window.emit("hive://tray-first-close", ());
                    let app = window.app_handle().clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(1_800));
                        let Some(lifecycle) = app.try_state::<AppLifecycle>() else {
                            return;
                        };
                        let Ok(mut notice) = lifecycle.tray_notice.lock() else {
                            return;
                        };
                        if notice.0 == generation && notice.1 {
                            notice.1 = false;
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    });
                } else {
                    let notice_in_progress = lifecycle
                        .tray_notice
                        .lock()
                        .map(|notice| notice.1)
                        .unwrap_or(false);
                    if !notice_in_progress {
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            set_quit_requested,
            configure_quick_input_shortcut,
            quick_input_shortcut::log_overview,
            overhive::sync_overhive,
            overhive::get_overhive_snapshot,
            overhive::set_overhive_regions,
            overhive::overhive_action,
            settings::load_view_settings,
            settings::save_view_settings,
            project::initialize_project,
            project::create_project,
            project::open_project,
            project::save_project,
            project::write_conflict_copy,
            project::acknowledge_external_file_change,
            backup::list_backups,
            backup::create_backup,
            backup::create_backup_if_changed,
            backup::backup_status,
            backup::delete_backup,
            backup::restore_backup,
            backup::check_project_health,
            export::export_project,
            export::import_project_zip,
            export::project_storage_stats,
            source::source_path_exists,
            source::source_open_path,
            spellcheck::spellcheck_languages,
            spellcheck::spellcheck_check,
            spellcheck::spellcheck_suggest,
            spellcheck::spellcheck_add_word,
            spellcheck::spellcheck_user_words,
            spellcheck::spellcheck_export_dictionary,
            spellcheck::spellcheck_import_dictionary,
            spellcheck::spellcheck_remove_word
        ])
        .build(tauri::generate_context!())
        .expect("error while building hive")
        .run(|app_handle, event| {
            if let RunEvent::WindowEvent {
                label,
                event: WindowEvent::Destroyed,
                ..
            } = event
            {
                if label == "main"
                    && app_handle
                        .try_state::<AppLifecycle>()
                        .is_some_and(|state| state.quit_requested.load(Ordering::SeqCst))
                {
                    app_handle.exit(0);
                }
            }
        });
}
