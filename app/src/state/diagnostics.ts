/**
 * Where a fault ends up.
 *
 * `log_error` in `src-tauri/src/lib.rs` writes uncaught frontend exceptions and
 * Rust panics to a file, because a packaged build has no stderr for them to
 * reach. That fixes half the problem: the fault is now recorded. This module is
 * the other half - the student has to be able to find the file, or the record
 * exists and nobody can produce it.
 *
 * Deliberately a path and not a button that opens it. Opening a folder means
 * shipping the opener plugin, and this webview also renders a college portal's
 * HTML; giving it the ability to ask the OS to launch things is a poor trade
 * for saving one Explorer window.
 */
import { invoke } from "@tauri-apps/api/core";
import { isDesktopShell } from "./platform";

/**
 * True when running inside the desktop shell.
 *
 * In a browser build there is no log file at all, so the honest answer is
 * "nothing to show" rather than a path that does not exist.
 *
 * `isDesktopShell` and not the `"__TAURI_INTERNALS__" in window` test this
 * used to carry. `app_log_dir()` does resolve on Android, so the panel showed
 * a real path - `/data/user/0/<pkg>/files/logs` - beside the instruction to
 * read the file and attach it to an issue. That directory is app-private
 * storage: a student cannot open it without root or adb. A support step
 * nobody can follow is worse than no support step, because it sends them
 * looking rather than asking.
 */
export const canDiagnose = (): boolean => isDesktopShell();

/**
 * The folder holding `targetx.log`, or null.
 *
 * Null covers both "not the desktop build" and "the command failed", and the
 * caller treats them the same: show nothing. A diagnostics feature that throws
 * its own error dialog is a joke at the student's expense.
 */
export async function logDir(): Promise<string | null> {
  if (!canDiagnose()) return null;
  try {
    const dir = await invoke<string>("diagnostics_dir");
    return typeof dir === "string" && dir.length > 0 ? dir : null;
  } catch {
    return null;
  }
}
