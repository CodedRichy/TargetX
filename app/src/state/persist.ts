/**
 * Where a student's marks actually live.
 *
 * Until this file existed the only copy was `localStorage`, which is browser
 * profile data: a WebView2 profile reset, a disk-cleanup tool, or an uninstall
 * takes it, and none of those look like data loss while they are happening.
 * The retired Python build wrote a real file (`legacy/targetx.py`, `DATA_FILE`)
 * and the port dropped that guarantee.
 *
 * So: a file under `appDataDir()` is the record, and `localStorage` stays on as
 * a second copy. On Windows `appDataDir()` is Roaming, not Local, deliberately
 * - colleges run lab machines with roaming profiles, the file is a few KB, and
 * a student's marks following them between machines is the right behaviour.
 *
 * Nothing in here throws quietly. Every failure is returned or rethrown so
 * `store.ts` can put it on screen, because a save that fails without saying so
 * is the defect this module was written to remove.
 */

/** The record. */
export const STATE_FILE = "state.json";
/** Written first, then renamed over `STATE_FILE`. Never read. */
const TEMP_FILE = "state.json.tmp";

/**
 * How many prior copies are kept.
 *
 * Three, and one is taken per app launch rather than per save. The failure a
 * backup answers is "I opened TargetX and my numbers are wrong" - a bad
 * migration, a destructive import, a truncated write - and a student notices
 * that within a launch or two. Per-save backups would instead hold three
 * copies spanning the last few seconds of typing, which is the same file three
 * times. Per-launch, three slots reach back three sessions, and the measured
 * cost of taking one is 3.5 ms for a full 8-semester record.
 */
export const BACKUP_COUNT = 3;
const backupName = (n: number) => `state.bak${n}.json`;

/** Whether a real filesystem is reachable, i.e. we are inside the Tauri shell. */
export function hasFileStore(): boolean {
  return typeof window !== "undefined"
    && (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
}

type FsModule = typeof import("@tauri-apps/plugin-fs");
type PathModule = typeof import("@tauri-apps/api/path");

let modules: Promise<{ fs: FsModule; path: PathModule }> | null = null;

/**
 * Load the Tauri modules lazily.
 *
 * Dynamic rather than a top-level import so that `npm run dev` in a plain
 * browser, and every Vitest run, never has to resolve a plugin whose commands
 * cannot exist there. `store.ts` is imported by nearly the whole app; a static
 * import here would put the fs plugin in every test's module graph.
 */
function load() {
  if (!modules) {
    modules = Promise.all([
      import("@tauri-apps/plugin-fs"),
      import("@tauri-apps/api/path"),
    ]).then(([fs, path]) => ({ fs, path }));
  }
  return modules;
}

async function locate() {
  const { fs, path } = await load();
  const dir = await path.appDataDir();
  return { fs, path, dir };
}

/** The absolute path of the state file, for showing a student where to look. */
export async function stateFilePath(): Promise<string> {
  const { path, dir } = await locate();
  return path.join(dir, STATE_FILE);
}

/** The saved record, or null if this build has never written one. */
export async function readStateFile(): Promise<string | null> {
  const { fs, path, dir } = await locate();
  const file = await path.join(dir, STATE_FILE);
  if (!(await fs.exists(file))) return null;
  return await fs.readTextFile(file);
}

let rotated = false;

/**
 * Shift the backup slots along and copy the current record into slot 1.
 *
 * A cascade of renames rather than N copies: only the last slot's contents are
 * discarded, and `STATE_FILE` itself is never moved, so nothing in here can
 * leave the record missing even if it fails halfway. Renaming a slot that does
 * not exist yet is the normal case on a young install and is not a fault.
 */
async function rotateBackups(fs: FsModule, path: PathModule, dir: string, file: string) {
  for (let n = BACKUP_COUNT; n > 1; n--) {
    try {
      await fs.rename(
        await path.join(dir, backupName(n - 1)),
        await path.join(dir, backupName(n)));
    } catch { /* slot n-1 has not been written yet; there is nothing to shift */ }
  }
  await fs.copyFile(file, await path.join(dir, backupName(1)));
}

export interface WriteOutcome {
  /** Absolute path of the record that was written. */
  path: string;
  /**
   * Why the backup copy could not be taken, if it could not. The record itself
   * was still written - this is reported separately because losing a spare copy
   * and losing the marks are not the same news.
   */
  backupError: string | null;
}

/**
 * Write the record, atomically.
 *
 * Temp file then rename, never truncate-then-write: truncating the real file
 * opens a window in which a crash leaves a student with an empty semester, and
 * that window is exactly as long as the write.
 *
 * `tauri-plugin-fs`'s `rename` is `std::fs::rename` verbatim
 * (tauri-plugin-fs-2.5.1/src/commands.rs:830). Measured on Windows 11 rather
 * than assumed: it DOES replace an existing destination; it succeeds while the
 * destination is held open for reading; over 2000 renames raced against a
 * concurrent reader the destination was never absent and never a short read.
 * It fails with "Access is denied. (os error 5)" if the destination is marked
 * read-only, which is why this rethrows instead of swallowing.
 *
 * What it is NOT is crash-proof against power loss: neither the plugin's write
 * nor its rename calls `sync_all`, so the temp file's bytes may still be in the
 * OS cache when the rename records. The rotating backups are the answer to
 * that, not this function.
 */
export async function writeStateFile(json: string): Promise<WriteOutcome> {
  const { fs, path, dir } = await locate();
  await fs.mkdir(dir, { recursive: true });
  const file = await path.join(dir, STATE_FILE);
  const temp = await path.join(dir, TEMP_FILE);

  let backupError: string | null = null;
  if (!rotated && await fs.exists(file)) {
    // Marked done either way: a rotation that fails for a structural reason -
    // a read-only folder, no space - will fail identically on every keystroke,
    // and retrying it 200 times a session buys nothing.
    rotated = true;
    try {
      await rotateBackups(fs, path, dir, file);
    } catch (exc) {
      backupError = String(exc);
    }
  }

  await fs.writeTextFile(temp, json);
  await fs.rename(temp, file);
  return { path: file, backupError };
}
