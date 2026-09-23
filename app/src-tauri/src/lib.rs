mod project;
mod settings;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(project::ProjectState::default())
        .invoke_handler(tauri::generate_handler![
            settings::load_view_settings,
            settings::save_view_settings,
            project::initialize_project,
            project::create_project,
            project::open_project,
            project::save_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running hive");
}
