import { createSignal } from "solid-js";
import { canSync, fullSync } from "../sync/etlab";
import { canRemember, loadCreds } from "./creds";
import { applySync } from "./actions";
import { state } from "./store";

/**
 * Sync on launch, when the student has already said we may.
 *
 * Until now nothing in this app ever refreshed itself. `lastSync` was written
 * by one button on one screen and by nothing else, so a student who opened
 * TargetX to check whether they could skip tomorrow's class was reading
 * whatever the portal said the last time they thought to press it. The number
 * looked authoritative and was quietly days old, which is worse than no number.
 *
 * Three deliberate limits on it:
 *
 * 1. It runs ONLY if the password is already in the OS credential vault. This
 *    feature never prompts, never stores anything new, and cannot be the reason
 *    a password gets saved - that is still a box the student ticks on the Data
 *    screen. No vault entry, no automatic sync, no nagging.
 *
 * 2. It runs at launch and never on a timer. etlab is a college server that
 *    updates attendance once or twice a day when a teacher gets round to it;
 *    polling it every fifteen minutes would put load on someone else's
 *    infrastructure for data that did not change. Opening the app is also the
 *    exact moment the student is about to read the number.
 *
 * 3. It is throttled. Closing and reopening the app four times in a row is one
 *    sync, not four.
 *
 * It is fire-and-forget: nothing waits on it, nothing blocks on it, and a
 * failure is reported quietly rather than thrown at someone who did not ask for
 * a sync. The app's whole value is that it works with no network at all.
 */

/** Do not sync again if the last one was this recent. */
export const AUTO_SYNC_GAP_MS = 3 * 60 * 60 * 1000;

export type AutoSyncOutcome =
  | "ok"
  /** No saved login, so there is nothing to sync with. Not a failure. */
  | "no-creds"
  /** Synced recently enough that doing it again would buy nothing. */
  | "fresh"
  /** Browser build, or no college address configured yet. */
  | "unavailable"
  | "failed";

const [autoSyncing, setAutoSyncing] = createSignal(false);
/** The last automatic sync's failure, or null. Surfaced in the bell. */
const [autoSyncError, setAutoSyncError] = createSignal<string | null>(null);
export { autoSyncing, autoSyncError };

/** Milliseconds since the last successful sync, or null if there never was one. */
export function sinceLastSync(now = Date.now()): number | null {
  if (!state.lastSync) return null;
  const then = new Date(state.lastSync).getTime();
  if (!Number.isFinite(then)) return null;
  return now - then;
}

/**
 * True when a sync would be worth doing.
 *
 * A record that has NEVER been synced is stale by definition - that is a
 * student who set the app up by hand, or whose first sync failed, and they are
 * exactly who benefits from one happening without being asked.
 */
export function syncIsStale(now = Date.now()): boolean {
  const age = sinceLastSync(now);
  return age === null || age >= AUTO_SYNC_GAP_MS;
}

/**
 * Run the launch sync if every precondition holds.
 *
 * Never throws. Every path returns an outcome, because the caller is a
 * `void`-ed call in `onMount` and an escaping rejection there is an unhandled
 * promise rejection in a WebView, where nobody will ever see it.
 */
export async function autoSync(): Promise<AutoSyncOutcome> {
  if (!canSync() || !canRemember()) return "unavailable";

  const base = String(state.student.college || "").trim();
  if (!base) return "unavailable";

  if (!syncIsStale()) return "fresh";

  let stored;
  try {
    stored = await loadCreds(base);
  } catch {
    // A vault that will not answer is not a sync failure, and telling the
    // student their sync failed when they never asked for one is noise.
    return "unavailable";
  }
  if (!stored) return "no-creds";

  setAutoSyncing(true);
  setAutoSyncError(null);
  try {
    // The password is read from the vault into a local, handed to one request
    // and dropped when this function returns. It is never put in a signal,
    // never in app state and never logged - the same posture the manual panel
    // holds, and the reason this lives here rather than in a component.
    const result = await fullSync(base, stored.username, stored.password);
    applySync(result);
    return "ok";
  } catch (exc) {
    // Deliberately not rethrown and deliberately not a dialog. The student
    // opened the app to read a number, not to be told about a background task
    // they did not start. It becomes a line in the bell.
    setAutoSyncError(exc instanceof Error ? exc.message : String(exc));
    return "failed";
  } finally {
    setAutoSyncing(false);
  }
}
