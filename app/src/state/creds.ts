import { invoke } from "@tauri-apps/api/core";
import { canSync } from "../sync/etlab";

/**
 * The opt-in credential store, front-end side (issue #2).
 *
 * Everything here is a thin pass to a Rust command that talks to the operating
 * system's credential vault. The password never lands in `state.json`, in the
 * export, or in `localStorage` - it goes straight from the sync form to the OS
 * store and back, and this module is the only path to it. `credentials-are-
 * contained` is the test that holds that line.
 *
 * `canRemember` gates the whole feature on the desktop shell, the same way
 * sync itself is gated: a browser build has no Tauri bridge and no vault, so
 * the option is simply absent rather than offered and then failing.
 */
export interface StoredCreds {
  username: string;
  password: string;
}

export const canRemember = (): boolean => canSync();

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
