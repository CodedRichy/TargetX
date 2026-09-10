//! Opt-in credential storage for the college-portal login.
//!
//! The portal password is normally held for a single request and dropped (see
//! `SyncPanel.tsx`). Issue #2: on the core loop - sync, check, sync again -
//! retyping it every time is the app's sharpest friction. This lets a student
//! CHOOSE to remember it, and only then, in the operating system's own
//! credential vault - never in `state.json`, never in the export, never in a
//! log. On Windows that vault is Credential Manager, which encrypts each entry
//! with DPAPI under the logged-in user's key, so another account on the same
//! machine cannot read it and it never exists as plaintext on disk.
//!
//! Android keeps it in EncryptedSharedPreferences, whose key lives in the
//! Android Keystore - see `CredsPlugin.kt`. Until that existed the phone had no
//! vault at all, and because `autosync` refuses to run without a stored login,
//! the refresh button on Android contacted no portal ever and reopening the app
//! brought nothing down. That is issue #16, and it was one missing store rather
//! than the two separate faults it looked like.
//!
//! macOS and Linux still compile the same commands as safe no-ops, so the
//! frontend can call them unconditionally and simply find that nothing was ever
//! stored.

use serde::{Deserialize, Serialize};

/// What is kept for one portal. The username rides along so a remembered login
/// fills both fields, not just the secret half.
#[derive(Serialize, Deserialize)]
pub struct Creds {
    pub username: String,
    pub password: String,
}

/// The Credential Manager "target" every entry is filed under. One service,
/// keyed per portal base URL, so two colleges never share a slot.
#[cfg(windows)]
const SERVICE: &str = "TargetX-portal";

#[cfg(windows)]
mod backend {
    use super::{Creds, SERVICE};
    use keyring::{Entry, Error};

    fn entry(base: &str) -> Result<Entry, String> {
        Entry::new(SERVICE, base).map_err(|e| e.to_string())
    }

    pub fn save(base: &str, creds: &Creds) -> Result<(), String> {
        let secret = serde_json::to_string(creds).map_err(|e| e.to_string())?;
        entry(base)?.set_password(&secret).map_err(|e| e.to_string())
    }

    pub fn load(base: &str) -> Result<Option<Creds>, String> {
        match entry(base)?.get_password() {
            Ok(secret) => Ok(serde_json::from_str(&secret).ok()),
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn delete(base: &str) -> Result<(), String> {
        match entry(base)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn has(base: &str) -> bool {
        entry(base)
            .and_then(|e| e.get_password().map_err(|x| x.to_string()))
            .is_ok()
    }
}

#[cfg(target_os = "android")]
mod backend {
    use super::Creds;
    use serde::Deserialize;
    use std::sync::OnceLock;
    use tauri::plugin::PluginHandle;
    use tauri::Wry;

    /// Set once, during the plugin's own setup. Held globally because the
    /// `cred_*` commands take no `AppHandle` - they are called from four places
    /// and threading a handle through all of them to reach one store would be
    /// more change than the feature.
    static PLUGIN: OnceLock<PluginHandle<Wry>> = OnceLock::new();

    pub fn attach(handle: PluginHandle<Wry>) {
        let _ = PLUGIN.set(handle);
    }

    fn plugin() -> Result<&'static PluginHandle<Wry>, String> {
        PLUGIN
            .get()
            .ok_or_else(|| "The credential store is not available.".to_string())
    }

    #[derive(Deserialize)]
    struct Found {
        found: bool,
        #[serde(default)]
        username: String,
        #[serde(default)]
        password: String,
    }

    #[derive(serde::Serialize)]
    struct BaseArgs<'a> {
        base: &'a str,
    }

    #[derive(serde::Serialize)]
    struct SaveArgs<'a> {
        base: &'a str,
        username: &'a str,
        password: &'a str,
    }

    pub fn save(base: &str, creds: &Creds) -> Result<(), String> {
        plugin()?
            .run_mobile_plugin::<()>(
                "save",
                SaveArgs { base, username: &creds.username, password: &creds.password },
            )
            .map_err(|e| e.to_string())
    }

    pub fn load(base: &str) -> Result<Option<Creds>, String> {
        let found = plugin()?
            .run_mobile_plugin::<Found>("load", BaseArgs { base })
            .map_err(|e| e.to_string())?;
        Ok(found.found.then(|| Creds {
            username: found.username,
            password: found.password,
        }))
    }

    pub fn delete(base: &str) -> Result<(), String> {
        plugin()?
            .run_mobile_plugin::<()>("delete", BaseArgs { base })
            .map_err(|e| e.to_string())
    }

    /// False on any error. "Is there a saved login" has no third answer worth
    /// showing a student, and a vault that cannot be opened has none stored as
    /// far as everything downstream is concerned.
    pub fn has(base: &str) -> bool {
        plugin()
            .and_then(|p| {
                p.run_mobile_plugin::<Found>("has", BaseArgs { base })
                    .map_err(|e| e.to_string())
            })
            .map(|f| f.found)
            .unwrap_or(false)
    }
}

#[cfg(not(any(windows, target_os = "android")))]
mod backend {
    use super::Creds;

    const UNAVAILABLE: &str =
        "Saving the portal password is only available in the Windows and Android builds.";

    pub fn save(_: &str, _: &Creds) -> Result<(), String> {
        Err(UNAVAILABLE.to_string())
    }
    pub fn load(_: &str) -> Result<Option<Creds>, String> {
        Ok(None)
    }
    pub fn delete(_: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn has(_: &str) -> bool {
        false
    }
}

/// Trailing slash trimmed so `https://mits.etlab.app` and `.../` are one key -
/// the same normalisation the sync itself applies to the base.
fn key(base: &str) -> &str {
    base.trim_end_matches('/')
}

#[tauri::command]
pub fn cred_save(base: String, username: String, password: String) -> Result<(), String> {
    backend::save(key(&base), &Creds { username, password })
}

#[tauri::command]
pub fn cred_load(base: String) -> Result<Option<Creds>, String> {
    backend::load(key(&base))
}

#[tauri::command]
pub fn cred_delete(base: String) -> Result<(), String> {
    backend::delete(key(&base))
}

#[tauri::command]
pub fn cred_has(base: String) -> bool {
    backend::has(key(&base))
}

/// Hand the Android plugin to the backend above.
///
/// Registered as a Tauri plugin rather than called directly because
/// `register_android_plugin` is the only way to reach a Kotlin class, and it is
/// available on the plugin setup API and nowhere else.
#[cfg(target_os = "android")]
pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("targetx-creds")
        .setup(|_app, api| {
            let handle = api.register_android_plugin("cv.codedrichy.targetx", "CredsPlugin")?;
            backend::attach(handle);
            Ok(())
        })
        .build()
}
