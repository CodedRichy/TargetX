import { createSignal } from "solid-js";
import { edit, state } from "./store";

/**
 * Navigation.
 *
 * Two separate concerns, deliberately not merged into one router. Setup is a
 * linear takeover with a back button and a step count; the main app is a set of
 * peer views with no order. Modelling both as "routes" would make the setup
 * steps look skippable in the UI and the main views look sequential.
 */

export type View = "home" | "ledger" | "attendance" | "history" | "data" | "schemes";

/**
 * `keys` are the words a student uses for a screen that are not its name.
 *
 * The search box strips domain words - "attendance", "marks", "classes" - out
 * of a question before matching subjects, because otherwise every phrasing of
 * every question matches every subject. But those same words are precisely what
 * names a SCREEN, so "am i short on attendance" matched nothing at all: the one
 * useful word in it had been removed before anything was compared.
 *
 * Views are therefore matched on these instead, against the raw question. They
 * are an explicit list rather than the hint text because the hints are English
 * sentences - matching "what needs doing" would have "what" open Home.
 */
export const VIEWS: Array<{ id: View; label: string; hint: string; keys: string[] }> = [
  { id: "home", label: "Home", hint: "Where you stand and what needs doing",
    keys: ["cgpa", "overall", "standing", "summary", "risk", "target", "goal"] },
  { id: "ledger", label: "Semester", hint: "Marks, attendance and what you still need",
    keys: ["mark", "marks", "cie", "ese", "internal", "series", "subject",
           "subjects", "grade", "grades", "pass", "fail", "sgpa"] },
  { id: "attendance", label: "Attendance", hint: "How many classes you can still miss, per subject",
    keys: ["attendance", "absent", "present", "bunk", "leave", "leaves", "skip",
           "miss", "class", "classes", "eligible", "eligibility", "debar",
           "debarred", "condonation", "timetable", "schedule"] },
  { id: "history", label: "History", hint: "Published results from past semesters",
    keys: ["history", "past", "previous", "last", "result", "results",
           "gradecard", "transcript", "semester"] },
  { id: "data", label: "Data", hint: "Sync, import, catalogue and backup",
    keys: ["sync", "etlab", "ktu", "import", "export", "backup", "restore",
           "password", "login", "portal", "catalogue"] },
  { id: "schemes", label: "Schemes", hint: "Pick or author the rules TargetX computes with",
    keys: ["scheme", "schemes", "profile", "profiles", "regulation", "regulations",
           "autonomous", "rules", "grading", "grade scheme", "pass mark"] },
];

// Home is the landing screen: the ledger answers "what are my marks", which is
// a question a student only has after the one Home answers - "am I fine".
const [view, setViewSignal] = createSignal<View>("home");
export { view };

/**
 * Navigation, and the Android Back button.
 *
 * The view was a bare signal that never touched the History API, and on a
 * phone that is not a missing nicety - it is a broken platform contract.
 * Measured on the device: navigate Home to Semester to History and
 * `history.length` is still 1. So Back had nothing to pop, nothing to
 * intercept it, and the system did what it does when an activity ignores
 * Back - it quit the app. From any tab. With the Ask palette open and a
 * half-typed question in it, Back threw the student out to the launcher
 * instead of closing the palette, and the question went with it.
 *
 * Every view change now pushes a history entry, so Back walks back through
 * the screens a student actually visited. `MainActivity.kt` is the other half:
 * it hands the system Back to the WebView while the WebView has somewhere to
 * go, and only lets it finish the activity when there is nothing left.
 *
 * Overlays sit on the same stack rather than a separate one, which is what
 * makes Back mean "undo the last thing that happened" instead of "leave the
 * screen, and never mind the modal on top of it".
 */
const overlays: Array<() => void> = [];

/** Set while WE call `history.back()`, so the resulting event is not acted on twice. */
let unwinding = 0;

const inBrowser = typeof window !== "undefined" && typeof history !== "undefined";

export function setView(next: View) {
  if (view() === next) return;
  setViewSignal(next);
  if (inBrowser) history.pushState({ nav: "view", view: next }, "");
}

/**
 * Open something Back should close - a palette, a sheet, a popover.
 *
 * The caller still owns its own open/closed signal; this only says what to run
 * when the student presses Back, and adds the entry that gives Back something
 * to consume. Pair every call with `closeOverlay` on the UI close path, or the
 * history entry outlives the thing it belonged to.
 */
export function openOverlay(close: () => void) {
  overlays.push(close);
  if (inBrowser) history.pushState({ nav: "overlay" }, "");
}

/** The UI closed it by its own control; drop the entry Back would have used. */
export function closeOverlay() {
  if (!overlays.length) return;
  overlays.pop();
  if (inBrowser) { unwinding++; history.back(); }
}

if (inBrowser) {
  // The entry the app opens on, so the first Back from Home has something
  // truthful to land on rather than an empty state object.
  history.replaceState({ nav: "view", view: "home" }, "");

  window.addEventListener("popstate", (e) => {
    if (unwinding > 0) { unwinding--; return; }

    // An overlay is always the most recent thing on screen, so it goes first
    // and the view underneath is left alone.
    const close = overlays.pop();
    if (close) { close(); return; }

    const s = e.state as { nav?: string; view?: View } | null;
    setViewSignal(s?.view ?? "home");
  });
}

/** Setup steps, in order. `route` splits into the sync path or the manual one. */
export type Step = "welcome" | "route" | "sync" | "manual" | "goal" | "done";

export const STEP_ORDER: Step[] = ["welcome", "route", "goal"];

const [step, setStep] = createSignal<Step>("welcome");
export { step, setStep };

/** Setup runs until it is explicitly finished, not until data exists. */
export const needsSetup = () => !state.onboarded;

/**
 * The analytics drawer, and whether it is beside the ledger.
 *
 * The ledger table has fourteen columns and a natural width of about 1260px.
 * The drawer takes 340 of whatever the window has, which on the default 1440
 * window left the table 1100 - so Target, Need and Status, the three columns
 * the app exists to show, were scrolled off the right edge against the
 * drawer's border. It read as the drawer covering the table (issue #12), and
 * there was no control anywhere that would move it.
 *
 * Absent means open: the drawer is the right default on a wide screen, and a
 * save written before this field existed should not open with it closed.
 */
export const drawerOpen = () => state.drawerOpen !== false;

export function setDrawerOpen(open: boolean) {
  edit((s) => { s.drawerOpen = open; });
}

export const toggleDrawer = () => setDrawerOpen(!drawerOpen());
