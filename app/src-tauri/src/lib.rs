mod settings;

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            settings::load_view_settings,
            settings::save_view_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running hive");
}
