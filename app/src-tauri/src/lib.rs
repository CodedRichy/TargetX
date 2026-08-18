mod etlab;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(etlab::Etlab::default())
    .invoke_handler(tauri::generate_handler![
      etlab::etlab_start,
      etlab::etlab_reset,
      etlab::etlab_active,
      etlab::etlab_get,
      etlab::etlab_post,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
