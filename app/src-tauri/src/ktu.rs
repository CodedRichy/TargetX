//! KTU transport.
//!
//! Only the HTTP half lives here: a cookie-holding client, GET, and form POST.
//! All parsing stays in TypeScript, because that is where the rules about what
//! a KTU grade-card page means already live and where they can be unit-tested
//! without a running portal.
//!
//! It has to be native rather than `fetch` from the webview for three reasons:
//! the KTU portal at app.ktu.edu.in will not send CORS headers to an app
//! origin, the session is a cookie the webview would refuse to expose to
//! JavaScript, and login is a redirect chain that has to be followed with the
//! jar intact.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
     AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

#[derive(Default)]
pub struct Ktu {
    inner: Mutex<Option<Session>>,
}

struct Session {
    client: reqwest::Client,
    base: String,
}

#[derive(Serialize)]
pub struct Fetched {
    /// The URL actually landed on, after redirects. Relative form actions are
    /// resolved against this, not against the URL that was requested.
    pub url: String,
    pub status: u16,
    pub body: String,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .cookie_store(true)
        .timeout(Duration::from_secs(25))
        .build()
        .map_err(|e| format!("Could not start an HTTP client: {e}"))
}

fn join(base: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        return path.to_string();
    }
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

/// Open a session against a portal. Drops any previous one, cookies included.
#[tauri::command]
pub fn ktu_start(state: State<'_, Ktu>, base: String) -> Result<(), String> {
    let session = Session { client: client()?, base: base.trim_end_matches('/').to_string() };
    *state.inner.lock().map_err(|_| "session lock poisoned")? = Some(session);
    Ok(())
}

/// Forget the session. Called on sign-out and before every fresh login.
#[tauri::command]
pub fn ktu_reset(state: State<'_, Ktu>) -> Result<(), String> {
    *state.inner.lock().map_err(|_| "session lock poisoned")? = None;
    Ok(())
}

#[tauri::command]
pub fn ktu_active(state: State<'_, Ktu>) -> bool {
    state.inner.lock().map(|s| s.is_some()).unwrap_or(false)
}

fn parts(state: &State<'_, Ktu>) -> Result<(reqwest::Client, String), String> {
    let guard = state.inner.lock().map_err(|_| "session lock poisoned")?;
    let session = guard.as_ref().ok_or("No portal session. Sign in first.")?;
    Ok((session.client.clone(), session.base.clone()))
}

#[tauri::command]
pub async fn ktu_get(state: State<'_, Ktu>, path: String) -> Result<Fetched, String> {
    let (client, base) = parts(&state)?;
    let response = client
        .get(join(&base, &path))
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let url = response.url().to_string();
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Unreadable response: {e}"))?;
    Ok(Fetched { url, status, body })
}

/// POST a login form. Fields arrive already assembled by the caller, including
/// every hidden input harvested from the form - that is what carries CSRF
/// tokens across the Yii versions different colleges run.
#[tauri::command]
pub async fn ktu_post(
    state: State<'_, Ktu>,
    url: String,
    fields: Vec<(String, String)>,
) -> Result<Fetched, String> {
    let (client, base) = parts(&state)?;
    let target = join(&base, &url);
    let response = client
        .post(&target)
        .header(reqwest::header::REFERER, target.clone())
        .form(&fields)
        .send()
        .await
        .map_err(|e| format!("Login request failed: {e}"))?;
    let landed = response.url().to_string();
    let status = response.status().as_u16();
    let body = response.text().await.map_err(|e| format!("Unreadable response: {e}"))?;
    Ok(Fetched { url: landed, status, body })
}
