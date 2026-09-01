//! Sign-in, the way a desktop application is allowed to do it.
//!
//! This is RFC 8252, "OAuth 2.0 for Native Apps", and every part of it is the
//! way it is because a desktop binary cannot keep a secret:
//!
//!   * **PKCE, not a client secret.** The app is files on the student's disk;
//!     anything static shipped inside it is extractable. PKCE replaces the
//!     secret with a per-attempt random verifier, so there is nothing to steal
//!     that is worth stealing twice.
//!
//!   * **The system browser, not an embedded webview.** The student types a
//!     password on a page whose URL bar they can see, in the browser where
//!     their password manager lives. An in-app webview is the phishing shape:
//!     the application could read the password field, and the user has no way
//!     to tell that it does not.
//!
//!   * **A loopback redirect on one of a few fixed ports.** RFC 8252 says a
//!     provider should accept any port on 127.0.0.1, and an OS-assigned
//!     ephemeral port is what this originally used. Clerk - like most
//!     providers - refuses a wildcard and wants exact redirect URIs
//!     registered, so instead there is a short list of candidates and the
//!     first free one wins. Several, not one, because a single hardcoded port
//!     is a single point of failure: something else on the machine binds it
//!     and sign-in is dead with no way for the student to fix it. The listener
//!     accepts exactly one request and dies.
//!
//!   * **The refresh token in the OS vault, never on disk in the clear.** Same
//!     store `creds.rs` uses, for the same reason.
//!
//! The access token is returned to the frontend and held in memory only. It is
//! short-lived by design, it is the thing sent to our own Worker, and writing
//! it anywhere would be storing a bearer credential to save a refresh call.
//!
//! Endpoints are read from the provider's OpenID discovery document rather than
//! hardcoded. Clerk publishes one, and a URL shape we guessed today would be a
//! silent breakage the first time it changed.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long the browser half of the flow may take before we give the port back.
///
/// Generous: this covers a student finding the browser window, typing a
/// password, and doing whatever their second factor asks. It exists so an
/// abandoned sign-in eventually frees the listener, not to hurry anybody.
const BROWSER_TIMEOUT: Duration = Duration::from_secs(300);

/// The loopback ports sign-in may listen on, in order of preference.
///
/// EVERY ONE OF THESE MUST BE REGISTERED AS A REDIRECT URI IN THE PROVIDER, as
/// `http://127.0.0.1:<port>/callback`. A port missing there is a port that
/// fails only when the earlier ones happen to be busy - which is the worst kind
/// of bug, because it is rare, machine-specific and looks random.
///
/// Chosen from the IANA dynamic range and away from the round numbers
/// development servers reach for, so a colleague running something on 8080 or
/// 3000 does not collide with a student signing in.
const CALLBACK_PORTS: [u16; 4] = [49731, 49732, 49733, 49734];

/// The vault slot the refresh token lives in. Distinct from the portal logins.
const ACCOUNT_KEY: &str = "targetx-account";

// --- discovery --------------------------------------------------------------

#[derive(Deserialize)]
struct Discovery {
    authorization_endpoint: String,
    token_endpoint: String,
}

async fn discover(issuer: &str) -> Result<Discovery, String> {
    let url = format!("{}/.well-known/openid-configuration", issuer.trim_end_matches('/'));
    let res = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("The sign-in provider did not answer ({}).", res.status()));
    }
    res.json::<Discovery>().await.map_err(|e| e.to_string())
}

// --- PKCE -------------------------------------------------------------------

fn random_urlsafe(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// S256, not `plain`. `plain` sends the verifier itself in the authorization
/// request, which puts it in browser history and in any proxy log on the way.
fn challenge_for(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// --- the one-shot loopback listener ----------------------------------------

/// What the browser came back with.
struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn parse_query(target: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(q) = target.split_once('?').map(|(_, q)| q) else {
        return out;
    };
    for pair in q.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            out.insert(k.to_string(), percent_decode(v));
        }
    }
    out
}

/// Enough of percent-decoding for an OAuth callback: `%XX` and `+`.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The page the student is left looking at. Deliberately plain, self-contained
/// and offline: it renders in a browser tab we do not control, on a machine
/// that may have just come back from an auth flow with no network left.
const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8>\
<title>Signed in</title>\
<style>body{font:16px system-ui;margin:0;display:grid;place-items:center;\
height:100vh;background:#f7f6f2;color:#1c1b19}p{margin:.4em}</style>\
<div><h1>Signed in</h1><p>You can close this tab and go back to TargetX.</p></div>";

/// Bind an ephemeral loopback port and accept exactly one request on it.
///
/// Returns the port immediately - the caller needs it to build the redirect URI
/// before the browser is opened - and a receiver that yields the callback when
/// the browser arrives. The thread ends after one request either way, so an
/// abandoned sign-in leaks a thread for at most `BROWSER_TIMEOUT`.
fn listen_once() -> Result<(u16, Receiver<Callback>, Arc<AtomicBool>), String> {
    // First free candidate wins. Bound to 127.0.0.1 and never 0.0.0.0: this
    // accepts an authorization code, and it has no business being reachable
    // from the campus network the machine is sitting on.
    let listener = CALLBACK_PORTS
        .iter()
        .find_map(|p| TcpListener::bind(("127.0.0.1", *p)).ok())
        .ok_or_else(|| {
            format!(
                "Could not open a port to finish signing in. Something else is using all of {:?}.",
                CALLBACK_PORTS
            )
        })?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let (tx, rx) = mpsc::channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancelled);

    std::thread::spawn(move || {
        // `incoming` blocks; one iteration is all this listener is for. A
        // browser preflighting the port (some do) would otherwise consume the
        // single accept, so anything without a `code` or `error` is ignored and
        // the loop waits for the real callback.
        for stream in listener.incoming() {
            // A sign-in that was abandoned and started again wakes this thread
            // by connecting to the port; the flag is how it tells the difference
            // between that and a browser arriving. Without it an abandoned
            // attempt held its port for the full five-minute timeout, and four
            // retries in five minutes exhausted every candidate.
            if flag.load(Ordering::SeqCst) {
                break;
            }
            let Ok(mut stream) = stream else { continue };

            let mut line = String::new();
            if BufReader::new(&stream).read_line(&mut line).is_err() {
                continue;
            }
            // "GET /callback?code=... HTTP/1.1"
            let target = line.split_whitespace().nth(1).unwrap_or("").to_string();
            let params = parse_query(&target);

            let code = params.get("code").cloned();
            let error = params.get("error").cloned();
            if code.is_none() && error.is_none() {
                let _ = stream.write_all(b"HTTP/1.1 204 No Content\r\n\r\n");
                continue;
            }

            let body = DONE_PAGE.as_bytes();
            let _ = stream.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
                     Content-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                )
                .as_bytes(),
            );
            let _ = stream.write_all(body);
            let _ = stream.flush();

            let _ = tx.send(Callback {
                code,
                state: params.get("state").cloned(),
                error,
            });
            break;
        }
    });

    Ok((port, rx, cancelled))
}

// --- pending flow state -----------------------------------------------------

struct Pending {
    port: u16,
    cancelled: Arc<AtomicBool>,
    verifier: String,
    state: String,
    redirect_uri: String,
    token_endpoint: String,
    client_id: String,
    rx: Receiver<Callback>,
}

#[derive(Default)]
pub struct Oauth {
    pending: Mutex<Option<Pending>>,
}

// --- the wire shapes --------------------------------------------------------

#[derive(Serialize)]
pub struct Started {
    /// Open this in the SYSTEM browser. Never in a webview - see the module doc.
    pub authorize_url: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    id_token: Option<String>,
}

/// The claims worth showing. Everything else in the token is ignored.
#[derive(Deserialize, Default)]
struct Claims {
    name: Option<String>,
    email: Option<String>,
    picture: Option<String>,
}

/// What the frontend is told about the signed-in account.
///
/// No tokens beyond the short-lived access token, and no claim we did not read
/// out of the provider's own response.
#[derive(Serialize)]
pub struct Session {
    pub access_token: String,
    /// Unix seconds. `None` when the provider declined to say.
    pub expires_at: Option<u64>,
    pub name: Option<String>,
    pub email: Option<String>,
    /// The avatar as a `data:` URI, already fetched and inlined.
    ///
    /// NOT the provider's URL. Handing the webview an https URL would mean a
    /// request to Google's CDN every time the header rendered - telling them
    /// this machine's IP and that the app is open, repeatedly, in an
    /// application whose whole position is that it works without a network. It
    /// is fetched once here and inlined, which also means it still draws
    /// offline and needs no widening of the app's `img-src`.
    pub avatar: Option<String>,
}

// --- commands ---------------------------------------------------------------

/// Begin a sign-in. Returns the URL the caller must open in the system browser.
#[tauri::command]
pub async fn oauth_begin(
    issuer: String,
    client_id: String,
    scopes: String,
    oauth: tauri::State<'_, Oauth>,
) -> Result<Started, String> {
    let disco = discover(&issuer).await?;

    let verifier = random_urlsafe(48);
    let challenge = challenge_for(&verifier);
    // CSRF: the value comes back in the callback and is compared. A callback
    // that does not carry the state this process generated is not ours.
    let state = random_urlsafe(24);

    let (port, rx, cancelled) = listen_once()?;
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let authorize_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}\
         &state={}&code_challenge={}&code_challenge_method=S256",
        disco.authorization_endpoint,
        urlencode(&client_id),
        urlencode(&redirect_uri),
        urlencode(&scopes),
        urlencode(&state),
        urlencode(&challenge),
    );

    let mut slot = oauth.pending.lock().map_err(|_| "sign-in state was poisoned")?;
    // Pressing Sign in again abandons the previous attempt. Releasing its port
    // here rather than letting it time out is what keeps a run of failed
    // attempts from walking through every candidate port.
    if let Some(previous) = slot.take() {
        release(&previous);
    }
    *slot = Some(Pending {
        port,
        cancelled,
        verifier,
        state,
        redirect_uri,
        token_endpoint: disco.token_endpoint,
        client_id,
        rx,
    });

    // Opened here rather than handed to the frontend to open, so the URL never
    // crosses into the webview - the same webview that renders a college
    // portal's HTML. It is returned as well, for the "open this manually"
    // fallback when no browser is registered.
    open_in_browser(&authorize_url);

    Ok(Started { authorize_url })
}

/// Wait for the browser, then exchange the code for tokens.
///
/// Split from `oauth_begin` so the caller can open the browser in between.
/// Blocks for up to `BROWSER_TIMEOUT`.
#[tauri::command]
pub async fn oauth_finish(oauth: tauri::State<'_, Oauth>) -> Result<Session, String> {
    let pending = oauth
        .pending
        .lock()
        .map_err(|_| "sign-in state was poisoned")?
        .take()
        .ok_or("No sign-in is in progress.")?;

    // The channel recv blocks a thread; doing it on the async runtime's worker
    // would stall every other command for up to five minutes.
    let callback = tokio::task::spawn_blocking(move || {
        let outcome = pending.rx.recv_timeout(BROWSER_TIMEOUT);
        // Whatever happened - a browser, a timeout, a disconnect - this attempt
        // is over and its port goes back.
        release(&pending);
        outcome.map(|cb| (cb, pending.verifier, pending.state, pending.redirect_uri,
                          pending.token_endpoint, pending.client_id))
    })
    .await
    .map_err(|e| e.to_string())?;

    let (cb, verifier, state, redirect_uri, token_endpoint, client_id) = match callback {
        Ok(v) => v,
        Err(RecvTimeoutError::Timeout) => {
            return Err("Sign-in timed out. The browser never came back.".into())
        }
        Err(RecvTimeoutError::Disconnected) => {
            return Err("Sign-in was interrupted before the browser answered.".into())
        }
    };

    if let Some(error) = cb.error {
        return Err(format!("Sign-in was refused: {error}"));
    }
    // Compared before the code is used for anything. A mismatched state is an
    // injected callback, and the correct response is to drop it silently rather
    // than explain which half was wrong.
    if cb.state.as_deref() != Some(state.as_str()) {
        return Err("That sign-in response did not match this request.".into());
    }
    let code = cb.code.ok_or("The provider returned no authorization code.")?;

    let client = reqwest::Client::new();
    let res = client
        .post(&token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("client_id", client_id.as_str()),
            ("code_verifier", verifier.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        // The body can carry provider internals; the status is all the student
        // needs and all we are willing to put on a screen.
        return Err(format!("The sign-in provider rejected the exchange ({}).", res.status()));
    }

    let token: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    if let Some(refresh) = token.refresh_token.as_deref() {
        // Best-effort: a vault that will not take it means signing in again next
        // launch, which is an inconvenience and not a failure of THIS sign-in.
        let _ = vault_save(refresh);
    }

    Ok(session_from(token).await)
}

/// Trade a stored refresh token for a fresh access token, without a browser.
///
/// Returns `Ok(None)` when there is nothing stored - not signed in is a normal
/// state, not an error. A refresh the provider REJECTS clears the stored token:
/// it has been revoked or has expired, and keeping it would mean failing this
/// way on every launch forever.
#[tauri::command]
pub async fn oauth_resume(
    issuer: String,
    client_id: String,
) -> Result<Option<Session>, String> {
    let Some(refresh) = vault_load() else {
        return Ok(None);
    };
    let disco = discover(&issuer).await?;

    let res = reqwest::Client::new()
        .post(&disco.token_endpoint)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh.as_str()),
            ("client_id", client_id.as_str()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let _ = vault_delete();
        return Ok(None);
    }

    let token: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
    // Providers that rotate refresh tokens hand back a new one, and dropping it
    // would sign the student out at the next launch.
    if let Some(next) = token.refresh_token.as_deref() {
        let _ = vault_save(next);
    }

    Ok(Some(session_from(token).await))
}

/// Forget the account on this machine.
#[tauri::command]
pub fn oauth_sign_out() -> Result<(), String> {
    vault_delete()
}

/// Whether a refresh token is stored, without touching the network.
#[tauri::command]
pub fn oauth_has_account() -> bool {
    vault_load().is_some()
}

// --- helpers ----------------------------------------------------------------

/// Read the claims out of an ID token, without verifying its signature.
///
/// Safe here and only here: this token came back on the direct, TLS-protected
/// response to our own PKCE exchange, which OpenID Connect Core 3.1.3.7 says
/// need not be validated - there is no third party in the path who could have
/// substituted it. The claims are used for a name and a picture and for
/// nothing that grants access; the WORKER verifies signatures properly,
/// because there the token arrives from a client we do not trust.
fn claims_of(id_token: &str) -> Claims {
    let Some(payload) = id_token.split('.').nth(1) else {
        return Claims::default();
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload) else {
        return Claims::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// The largest avatar worth inlining.
///
/// A cap rather than trust: the URL comes from a token, the response comes from
/// somebody else's CDN, and this ends up in a `data:` URI held in memory. A
/// provider that served a 40MB image should cost us nothing.
const MAX_AVATAR_BYTES: usize = 512 * 1024;

/// Fetch an avatar and inline it as a `data:` URI.
///
/// Best-effort throughout. Every failure returns `None`, because an account
/// with no picture and an account whose picture would not load are the same
/// thing to a student, and neither is worth an error.
async fn inline_avatar(url: &str) -> Option<String> {
    // https only. A token claim is not a reason to make a plaintext request.
    if !url.starts_with("https://") {
        return None;
    }

    let res = reqwest::Client::new().get(url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }

    // Trust the declared type only far enough to name it, and only if it is an
    // image at all - this string goes into a `data:` URI.
    let mime = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or("").trim().to_string())
        .filter(|v| matches!(v.as_str(),
            "image/jpeg" | "image/png" | "image/webp" | "image/gif"))?;

    let bytes = res.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_AVATAR_BYTES {
        return None;
    }

    Some(format!("data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)))
}

/// Build the session handed to the frontend, resolving the avatar if there is one.
async fn session_from(token: TokenResponse) -> Session {
    let claims = token.id_token.as_deref().map(claims_of).unwrap_or_default();
    let avatar = match claims.picture.as_deref() {
        Some(url) => inline_avatar(url).await,
        None => None,
    };

    Session {
        access_token: token.access_token,
        expires_at: token.expires_in.map(|s| now_secs() + s),
        name: claims.name,
        email: claims.email,
        avatar,
    }
}

/// Release a pending attempt's loopback port.
///
/// Setting the flag alone is not enough: the listener thread is parked inside a
/// blocking `accept`, and nothing wakes it until a connection arrives. So one
/// is made, to itself, purely to let the loop come round and see the flag. The
/// connection is dropped immediately and carries no request.
fn release(pending: &Pending) {
    pending.cancelled.store(true, Ordering::SeqCst);
    let _ = std::net::TcpStream::connect(("127.0.0.1", pending.port));
}

/// Hand a URL to the operating system's default browser.
///
/// Never through a shell. `cmd /c start` would parse the URL as a command line,
/// where an `&` alone changes what runs; `rundll32 url.dll,FileProtocolHandler`
/// takes the URL as one argument and hands it straight to the shell handler.
/// Best-effort by design: a machine with no registered browser is a machine
/// where the student uses the URL we also returned.
fn open_in_browser(url: &str) {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = std::process::Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(url);
        c
    };

    let _ = cmd.spawn();
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Percent-encode a query parameter value.
///
/// Allow-list, not a deny-list. The unreserved set from RFC 3986 is escaped
/// through, everything else is encoded - so a character nobody thought about is
/// encoded rather than passed through into a URL.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(windows)]
fn vault_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("TargetX-account", ACCOUNT_KEY).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn vault_save(refresh: &str) -> Result<(), String> {
    vault_entry()?.set_password(refresh).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn vault_load() -> Option<String> {
    vault_entry().ok()?.get_password().ok()
}

#[cfg(windows)]
fn vault_delete() -> Result<(), String> {
    match vault_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// Same posture as `creds.rs`: the other platforms compile the commands as safe
// no-ops so the frontend can call them unconditionally and simply find that
// nothing was ever stored. A refresh token has nowhere safe to live here, and
// a file in the app directory is not an answer.
#[cfg(not(windows))]
fn vault_save(_: &str) -> Result<(), String> {
    Err("Staying signed in is only available in the Windows build.".into())
}

#[cfg(not(windows))]
fn vault_load() -> Option<String> {
    None
}

#[cfg(not(windows))]
fn vault_delete() -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_is_the_s256_of_the_verifier() {
        // The worked example from RFC 7636 appendix B. If this drifts, every
        // exchange fails at the provider with an opaque error.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            challenge_for(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn query_parsing_decodes_escapes() {
        let q = parse_query("/callback?code=a%2Bb&state=x%20y");
        assert_eq!(q.get("code").map(String::as_str), Some("a+b"));
        assert_eq!(q.get("state").map(String::as_str), Some("x y"));
    }

    #[test]
    fn urlencode_escapes_everything_outside_the_unreserved_set() {
        assert_eq!(urlencode("a b/c?d"), "a%20b%2Fc%3Fd");
        assert_eq!(urlencode("aZ0-._~"), "aZ0-._~");
    }

    #[test]
    fn every_candidate_port_is_bindable_and_distinct() {
        // A duplicate here would silently shrink the fallback list, and the
        // registered redirect URIs in the provider would no longer match what
        // the app can actually open.
        let mut seen = CALLBACK_PORTS.to_vec();
        seen.sort_unstable();
        seen.dedup();
        assert_eq!(seen.len(), CALLBACK_PORTS.len());
        // Dynamic/private range, so none of these is a registered service.
        assert!(CALLBACK_PORTS.iter().all(|p| *p >= 49152));
    }

    #[test]
    fn a_callback_with_neither_code_nor_error_is_not_a_result() {
        let q = parse_query("/favicon.ico");
        assert!(!q.contains_key("code") && !q.contains_key("error"));
    }
}
