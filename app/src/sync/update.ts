/**
 * Update checking.
 *
 * A student installs TargetX once and then does not think about it again, so
 * the app has to raise the subject itself. Nothing else can: the binary ships
 * as an installer, there is no account, no server, and no channel back to
 * whoever downloaded it.
 *
 * That matters more here than in most desktop apps because the engine IS the
 * product. A build with a marks bug does not look broken - it quietly reports
 * a wrong number with the same confidence as a right one, and the student has
 * no way to tell. `curriculum.json` also refreshes from the repo at runtime
 * (see `engine/catalogue.ts`), so an old binary keeps pulling new data: the
 * data moves forward while the code that reads it does not.
 *
 * Three rules this module holds to:
 *
 *   1. NEVER block startup. The check runs after the UI is up and its failure
 *      is not an error the student has to see.
 *   2. NEVER install without being asked. An app that restarts itself while
 *      someone is typing their internals is worse than an out-of-date one.
 *   3. FAIL SILENT. Offline, GitHub down, or the release feed missing are all
 *      the same to a student sitting in a lecture hall: nothing happens. Only
 *      a failure DURING an install the student asked for is worth reporting.
 */
import type { Update } from "@tauri-apps/plugin-updater";

/**
 * True when running inside the desktop shell.
 *
 * The updater is a Rust plugin, so in a browser (`npm run dev`, and every
 * test) the import itself is fine but the call has nothing behind it. Mirrors
 * `canSync` in `./etlab` rather than inventing a second detection.
 */
export const canUpdate = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** An update that exists, with the means to take it. */
export interface Available {
  /** The version being offered, e.g. `0.2.0`. */
  version: string;
  /** Release notes, when the release carried any. */
  notes: string | null;
  /**
   * Download, install, and restart into the new build.
   *
   * `onProgress` receives a fraction in [0, 1], or null while the size is
   * unknown - a release served without a `Content-Length` reports real
   * movement that cannot be turned into a percentage, and inventing one would
   * mean a bar that lies. The caller is expected to show an indeterminate
   * state for null rather than a zero.
   *
   * Resolves only if something went wrong: on success the process is replaced
   * and nothing after the call runs.
   */
  install: (onProgress?: (fraction: number | null) => void) => Promise<void>;
}

/**
 * Ask whether a newer build exists.
 *
 * Returns null for "no update", "not in the desktop shell", and every kind of
 * failure alike - the caller has nothing useful to do differently in those
 * cases, and a student has nothing to fix. Deliberately swallows: see rule 3.
 */
export async function checkForUpdate(): Promise<Available | null> {
  if (!canUpdate()) return null;

  let found: Update | null = null;
  try {
    // Imported lazily so a browser build never pulls the plugin in at all.
    const { check } = await import("@tauri-apps/plugin-updater");
    found = await check();
  } catch {
    return null;
  }
  if (!found) return null;

  const update = found;
  return {
    version: update.version,
    notes: update.body?.trim() ? update.body.trim() : null,
    install: async (onProgress) => {
      let total = 0;
      let taken = 0;
      await update.downloadAndInstall((event) => {
        if (!onProgress) return;
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            taken = 0;
            onProgress(total > 0 ? 0 : null);
            break;
          case "Progress":
            taken += event.data.chunkLength;
            // Clamped: a server that under-reports its own length would
            // otherwise drive the bar past full, which reads as a fault.
            onProgress(total > 0 ? Math.min(1, taken / total) : null);
            break;
          case "Finished":
            onProgress(1);
            break;
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
