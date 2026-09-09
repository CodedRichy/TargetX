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
import { isAndroid, isDesktopShell } from "../state/platform";

/**
 * True when running inside the desktop shell.
 *
 * The updater is a Rust plugin, so in a browser (`npm run dev`, and every
 * test) the import itself is fine but the call has nothing behind it.
 *
 * The DESKTOP shell, not merely a shell. This mirrored `canSync`, which asks
 * `"__TAURI_INTERNALS__" in window` - and that is true on Android, where
 * `lib.rs` registers the updater plugin under `#[cfg(desktop)]` and therefore
 * does not register it at all. So the phone offered "Check for updates",
 * `check()` threw into the catch below, and the student was told there was no
 * update available. Not an error, not a refusal: a confident wrong answer,
 * every time, from a build that can never update itself this way.
 *
 * Android takes updates by installing a new APK, so there is nothing here for
 * it to do and the control is simply absent instead of lying.
 */
export const canUpdate = (): boolean => isDesktopShell();

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

/* --- Android ---------------------------------------------------------------

 * A phone cannot take the update above, and for a while it was told so by
 * being shown nothing. That was honest and it was not enough: the reason this
 * module exists - an engine that reports a wrong number as confidently as a
 * right one - is exactly as true on a phone, and a sideloaded APK has no store
 * behind it to push a fix. A student who installs once and never hears from
 * the app again is running that build until they think to go looking.
 *
 * So the phone gets the same question ("is there a newer one?") answered a
 * different way, and the difference is deliberate rather than a shortfall:
 *
 * IT DOES NOT INSTALL ANYTHING. It opens the APK's download link in the
 * browser, and the student installs it themselves. Installing from inside the
 * app would mean holding `REQUEST_INSTALL_PACKAGES` - a permission that lets
 * an app put OTHER software on the phone - plus a `FileProvider`, and handing
 * that to a process that also renders a college portal's HTML is not a trade
 * worth one saved tap. The browser's download and the system installer are
 * screens a student already recognises, and they are the ones that ask the
 * consent this deserves to ask.
 *
 * The check reads a small file from the repository rather than the GitHub API,
 * for a plain reason: the CSP allows `raw.githubusercontent.com` and does not
 * allow `api.github.com`, and widening a content policy to save a file is the
 * wrong direction. `engine/catalogue.ts` already refreshes the curriculum this
 * way.
 */

/** Where the phone build asks what the newest phone build is. */
export const ANDROID_LATEST_URL =
  "https://raw.githubusercontent.com/CodedRichy/TargetX/main/android-latest.json";

/** True on the phone, where an update means downloading an APK. */
export const canUpdateAndroid = (): boolean => isAndroid();

/** A newer APK than the one running, and the link to it. */
export interface AndroidUpdate {
  version: string;
  notes: string | null;
  /** Opens the download in the system browser. Installing is the student's. */
  open: () => Promise<void>;
}

/**
 * Compare two dotted version strings.
 *
 * Numeric per segment, so 0.10.0 is correctly newer than 0.9.0 - the string
 * comparison that looks like it would do reports the opposite, and would have
 * stopped offering updates at the tenth minor release with no symptom before
 * then. Missing segments are zero, and anything unparseable is zero, so a
 * malformed feed is "no update" rather than a crash.
 */
function isNewer(candidate: string, current: string): boolean {
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/**
 * Ask whether a newer APK exists.
 *
 * Silent about every failure, exactly as `checkForUpdate` is and for the same
 * reason: offline, GitHub down, or a feed that is not there yet are all
 * "nothing happens" to a student in a lecture hall.
 */
export async function checkForAndroidUpdate(): Promise<AndroidUpdate | null> {
  if (!canUpdateAndroid()) return null;

  let feed: { version?: unknown; url?: unknown; notes?: unknown };
  try {
    const response = await fetch(ANDROID_LATEST_URL, { cache: "no-store" });
    if (!response.ok) return null;
    feed = await response.json() as typeof feed;
  } catch {
    return null;
  }

  const version = typeof feed.version === "string" ? feed.version : "";
  const url = typeof feed.url === "string" ? feed.url : "";
  if (!version || !url) return null;

  // The link is checked here rather than trusted, because this file is fetched
  // over the network and its job is to be handed to `openUrl`. Anything but a
  // release of this project on github.com is refused - the capability in
  // `src-tauri` refuses it too, and neither of those is a reason to skip the
  // other.
  if (!url.startsWith("https://github.com/CodedRichy/TargetX/releases/")) return null;

  let current: string;
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    current = await getVersion();
  } catch {
    return null;
  }
  if (!isNewer(version, current)) return null;

  const notes = typeof feed.notes === "string" && feed.notes.trim()
    ? feed.notes.trim() : null;

  return {
    version,
    notes,
    open: async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    },
  };
}
