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
//! Scoped to Windows for this release: that is the reporter's platform and the
//! one the brief names. The other platforms compile the same commands as safe
//! no-ops, so the frontend can call them unconditionally and simply find that
//! nothing was ever stored.

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

#[cfg(not(windows))]
mod backend {
    use super::Creds;

    const UNAVAILABLE: &str =
        "Saving the portal password is only available in the Windows build.";

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
