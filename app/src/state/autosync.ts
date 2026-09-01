import { createSignal } from "solid-js";
import { canSync, fullSync } from "../sync/etlab";
import { canSyncKtu } from "../sync/ktu";
import { KTU_CRED_KEY, canRemember, loadCreds } from "./creds";
import { applySync, syncKtu } from "./actions";
import { state } from "./store";

/**
 * Refreshing the record, from both portals, without being asked twice.
 *
 * Until this existed nothing in the app ever refreshed itself. `lastSync` was
 * written by one button on one screen and by nothing else, so a student who
 * opened TargetX to check whether they could skip tomorrow's class was reading
 * whatever the portal said the last time they thought to press it. The number
 * looked authoritative and was quietly days old, which is worse than no number.
 *
 * The two sources are refreshed independently and neither can sink the other.
 * They are different servers with different logins and different failure modes,
 * and KTU being down at result time is not a reason to leave a student without
 * today's attendance. A run reports per source; the caller decides what to say.
 *
 * Automatic runs carry three limits that a manual press does not:
 *
 * 1. They run ONLY if that portal's password is already in the OS credential
 *    vault. Nothing here ever prompts, ever stores anything new, or can be the
 *    reason a password gets saved - that is still a box the student ticks.
 *
 * 2. They run at launch, never on a timer. etlab is a college server that
 *    updates attendance once or twice a day when a teacher gets round to it,
 *    and polling it for data that did not change is load on somebody else's
 *    infrastructure. Opening the app is also the moment the student is about to
 *    read the number.
 *
 * 3. They are throttled, so reopening the app four times is one refresh.
 *
 * A manual refresh honours none of those: the student pressed the button, they
 * get the request, however recently the last one ran.
 */

/** Do not refresh automatically if the last one was this recent. */
export const AUTO_SYNC_GAP_MS = 45 * 60 * 1000;

export type SourceStatus =
  | "ok"
  /** No saved login for this portal, so there is nothing to sync with. */
  | "no-creds"
  /** Browser build, or no college address configured yet. */
  | "unavailable"
  | "failed";

export interface SourceResult {
  source: "etlab" | "ktu";
  status: SourceStatus;
  /** Why it failed, verbatim from the portal layer. Only set on "failed". */
  detail?: string;
}

export interface Refresh {
  at: string;
  results: SourceResult[];
}

const [refreshing, setRefreshing] = createSignal(false);
/** The last refresh's outcome, or null if none has run this session. */
const [lastRefresh, setLastRefresh] = createSignal<Refresh | null>(null);
export { lastRefresh, refreshing };

/** The sources that failed in the last run. Surfaced in the bell. */
export function refreshFailures(): SourceResult[] {
  return (lastRefresh()?.results ?? []).filter((r) => r.status === "failed");
}

/** Milliseconds since the last successful sync, or null if there never was one. */
export function sinceLastSync(now = Date.now()): number | null {
  if (!state.lastSync) return null;
  const then = new Date(state.lastSync).getTime();
  if (!Number.isFinite(then)) return null;
  return now - then;
}

/**
 * True when an automatic refresh would be worth doing.
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
 * Read a saved login, treating a vault that will not answer as simply absent.
 *
 * A locked or missing vault is not a sync failure and must not be reported as
 * one: telling a student their sync failed when they never asked for a sync is
 * noise, and the answer either way is "there is nothing to log in with".
 */
async function vault(key: string) {
  if (!canRemember()) return null;
  try {
    return await loadCreds(key);
  } catch {
    return null;
  }
}

async function refreshEtlab(): Promise<SourceResult> {
  if (!canSync()) return { source: "etlab", status: "unavailable" };

  const base = String(state.student.college || "").trim();
  if (!base) return { source: "etlab", status: "unavailable" };

  const creds = await vault(base);
  if (!creds) return { source: "etlab", status: "no-creds" };

  try {
    // The password is read from the vault into a local, handed to one request
    // and dropped when this function returns. It is never put in a signal,
    // never in app state and never logged - the same posture the manual panel
    // holds, and the reason this lives here rather than in a component.
    applySync(await fullSync(base, creds.username, creds.password));
    return { source: "etlab", status: "ok" };
  } catch (exc) {
    return {
      source: "etlab", status: "failed",
      detail: exc instanceof Error ? exc.message : String(exc),
    };
  }
}

async function refreshKtu(): Promise<SourceResult> {
  if (!canSyncKtu()) return { source: "ktu", status: "unavailable" };

  const creds = await vault(KTU_CRED_KEY);
  if (!creds) return { source: "ktu", status: "no-creds" };

  try {
    await syncKtu(creds.username, creds.password);
    return { source: "ktu", status: "ok" };
  } catch (exc) {
    return {
      source: "ktu", status: "failed",
      detail: exc instanceof Error ? exc.message : String(exc),
    };
  }
}

/**
 * Refresh both portals.
 *
 * Never throws. Every path resolves to a report, because one caller is a
 * `void`-ed call in `onMount` where an escaping rejection is an unhandled
 * promise rejection in a WebView that nobody will ever see.
 *
 * `Promise.all` rather than sequential: they are different servers, neither
 * waits on the other, and both settle because each half catches its own
 * failure. Nothing here can reject, so there is no `allSettled` to reach for.
 */
export async function refreshAll(): Promise<Refresh> {
  setRefreshing(true);
  try {
    const results = await Promise.all([refreshEtlab(), refreshKtu()]);
    const report: Refresh = { at: new Date().toISOString(), results };
    setLastRefresh(report);
    return report;
  } finally {
    setRefreshing(false);
  }
}

/**
 * The launch refresh: the same work, declined when it would buy nothing.
 *
 * Deliberately silent about being skipped. A student who opened the app four
 * minutes ago does not need to be told that a background task they never
 * started chose not to run.
 */
export async function autoRefresh(): Promise<Refresh | null> {
  if (!syncIsStale()) return null;
  return await refreshAll();
}
