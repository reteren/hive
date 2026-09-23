mod project;
mod settings;
mod watcher;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(project::ProjectState::default())
        .setup(|app| {
            app.manage(watcher::ProjectWatcher::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::load_view_settings,
            settings::save_view_settings,
            project::initialize_project,
            project::create_project,
            project::open_project,
            project::save_project,
            project::write_conflict_copy,
            project::acknowledge_external_file_change
        ])
        .run(tauri::generate_context!())
        .expect("error while running hive");
}
