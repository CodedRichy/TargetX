import { invoke } from "@tauri-apps/api/core";
import { isDesktopShell } from "./platform";

/**
 * The opt-in credential store, front-end side (issue #2).
 *
 * Everything here is a thin pass to a Rust command that talks to the operating
 * system's credential vault. The password never lands in `state.json`, in the
 * export, or in `localStorage` - it goes straight from the sync form to the OS
 * store and back, and this module is the only path to it. `credentials-are-
 * contained` is the test that holds that line.
 *
 * `canRemember` gates the whole feature on the desktop shell - NOT on
 * `canSync`, which is what it used to read and which was wrong the moment an
 * Android build existed.
 *
 * `canSync` is `"__TAURI_INTERNALS__" in window`. That asks "is there a Rust
 * side", and while the only shell was a desktop window it was also,
 * accidentally, a correct test for "is this a desktop window" - `platform.ts`
 * says exactly this about the same expression. On Android it is still true and
 * no longer means that, so the phone offered a checkbox reading "Your password
 * will be kept in Windows Credential Manager, encrypted for your account on
 * this device" - on a phone that has no such thing. Ticking it stored nothing:
 * `creds.rs` gates its backend on `#[cfg(windows)]` and the `not(windows)`
 * branch returns an error which the caller catches and discards as "a
 * convenience, never a blocker". No message, no stored password, and the box
 * silently unticked itself on the next launch. A student would reasonably
 * conclude their password was in a vault on their phone.
 *
 * The gate is the fix and the copy is not: rewording the fineprint would leave
 * a control that does nothing. Gated here, the checkbox is simply absent on
 * Android and the fallback line - "Your password is used for this one request
 * and is never saved" - is what shows, which is exactly true there.
 *
 * KNOWN RESIDUE, deliberately left: the Rust backend is Windows-only, so macOS
 * and Linux desktop builds still offer this and still silently fail. That is
 * the same defect on a platform this branch does not ship, and narrowing the
 * gate further needs a platform probe that does not exist yet. Named here so
 * the next person finds it stated rather than discovering it the hard way.
 */
export interface StoredCreds {
  username: string;
  password: string;
}

export const canRemember = (): boolean => isDesktopShell();

/**
 * The vault key the KTU results portal's login is kept under.
 *
 * A constant here rather than a literal in the one screen that used it, because
 * two callers now read it - the Data screen's form and the background refresh -
 * and a second copy of this string that drifted by one character would fail as
 * "no saved login", silently, forever.
 */
export const KTU_CRED_KEY = "https://app.ktu.edu.in";

/** Save a portal login to the OS vault. Rejects if the store is unavailable. */
export const saveCreds = (base: string, username: string, password: string): Promise<void> =>
  invoke<void>("cred_save", { base, username, password });

/** Load a saved login, or null if none was stored for this portal. */
export const loadCreds = (base: string): Promise<StoredCreds | null> =>
  invoke<StoredCreds | null>("cred_load", { base });

/** Forget a saved login. A no-op if there was nothing to forget. */
export const deleteCreds = (base: string): Promise<void> =>
  invoke<void>("cred_delete", { base });

/** Whether a login is stored for this portal, without reading the secret. */
export const hasCreds = (base: string): Promise<boolean> =>
  invoke<boolean>("cred_has", { base });
