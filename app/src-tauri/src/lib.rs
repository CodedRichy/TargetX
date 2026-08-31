mod creds;
mod etlab;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};

/// How much log we keep, and why these numbers.
///
/// A student is never going to read this file. Its only job is to still contain
/// the fault when they are asked for it, possibly days later, so it has to
/// survive a few restarts - and it has to stop growing on its own, because
/// nobody is ever going to clean it up.
const LOG_MAX_BYTES: u128 = 2 * 1024 * 1024;
const LOG_KEEP: usize = 3;

/// A frontend fault, recorded where it can still be found later.
///
/// A webview swallows its own exceptions: a TypeError in the UI leaves nothing
/// behind except a screen that stopped updating. `eprintln!` used to be enough
/// while this only ever ran from a terminal, but a packaged build is compiled
/// with `windows_subsystem = "windows"` and has no stderr attached to anything.
/// A student's crash reached nobody. This puts it in a file instead.
#[tauri::command]
fn log_error(message: String) {
  log::error!("[frontend] {message}");
}

/// Where that file is.
///
/// Returned as a path rather than opened, deliberately. Support here is one
/// person reading a message that says "it stopped working", and the useful
/// reply is a folder the student can be walked to - not a button that launches
/// a file manager, which would mean shipping the opener plugin and giving this
/// webview, which also renders a college portal's HTML, the ability to ask the
/// OS to launch things.
#[tauri::command]
fn diagnostics_dir(app: tauri::AppHandle) -> Result<String, String> {
  app
    .path()
    .app_log_dir()
    .map(|p| p.to_string_lossy().into_owned())
    .map_err(|e| e.to_string())
}

/// The logger.
///
/// Built here rather than inline because the target list is conditional, and
/// `Builder::targets` REPLACES the list rather than appending to it - so the
/// obvious `.target(file).targets(if debug { stderr })` spelling compiles,
/// type-checks, and silently produces a release build that logs nowhere. The
/// file target is therefore added last and unconditionally.
fn log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
  let mut builder = tauri_plugin_log::Builder::default()
    .level(log::LevelFilter::Info)
    .clear_targets()
    .max_file_size(LOG_MAX_BYTES)
    .rotation_strategy(RotationStrategy::KeepSome(LOG_KEEP));

  // Stderr as well when there is a terminal to receive it. A packaged Windows
  // build is compiled with `windows_subsystem = "windows"` and has none, which
  // is the whole reason the file target exists.
  if cfg!(debug_assertions) {
    builder = builder.target(Target::new(TargetKind::Stderr));
  }

  builder
    .target(Target::new(TargetKind::LogDir {
      file_name: Some("targetx".into()),
    }))
    .build()
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
    // Registered unconditionally, and outside `setup`, so that anything which
    // fails during setup is itself logged. It used to be inside a
    // `debug_assertions` check, which meant the only builds that recorded a
    // fault were the ones being watched by someone who could already see it.
    .plugin(log_plugin())
    .manage(etlab::Etlab::default())
    .invoke_handler(tauri::generate_handler![
      etlab::etlab_start,
      etlab::etlab_reset,
      etlab::etlab_active,
      etlab::etlab_get,
      etlab::etlab_post,
      creds::cred_save,
      creds::cred_load,
      creds::cred_delete,
      creds::cred_has,
      log_error,
      diagnostics_dir,
    ])
    .setup(|app| {
      // Desktop only: there is no updater on mobile, and registering it there
      // fails the build rather than degrading quietly.
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        app.handle().plugin(tauri_plugin_process::init())?;
      }

      // A Rust panic aborts the window and prints to a stderr that a packaged
      // build does not have. Chaining rather than replacing keeps the default
      // behaviour intact for a debug run, where that stderr does exist.
      let previous = std::panic::take_hook();
      std::panic::set_hook(Box::new(move |info| {
        log::error!("[panic] {info}");
        previous(info);
      }));

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
