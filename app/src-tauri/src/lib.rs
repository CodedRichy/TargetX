mod etlab;

/// A frontend error, forwarded to stderr.
///
/// A webview swallows its own exceptions: a panic in Rust reaches the terminal
/// but a TypeError in the UI leaves nothing behind except a screen that stopped
/// updating. This puts both in the same stream, which is the only way a running
/// build can be watched for faults.
#[tauri::command]
fn log_error(message: String) {
  eprintln!("[frontend] {message}");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // The student's record lives in a file under `appDataDir()`, not in the
    // webview's localStorage. See `app/src/state/persist.ts`. Scoped in
    // `capabilities/default.json` to that folder's top level and nothing else:
    // this webview also renders a college portal's HTML, and it has no business
    // being able to reach the rest of the disk.
    .plugin(tauri_plugin_fs::init())
    .manage(etlab::Etlab::default())
    .invoke_handler(tauri::generate_handler![
      etlab::etlab_start,
      etlab::etlab_reset,
      etlab::etlab_active,
      etlab::etlab_get,
      etlab::etlab_post,
      log_error,
    ])
    .setup(|app| {
      // Desktop only: there is no updater on mobile, and registering it there
      // fails the build rather than degrading quietly.
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }

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
