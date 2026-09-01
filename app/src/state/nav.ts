import { createSignal } from "solid-js";
import { state } from "./store";

/**
 * Navigation.
 *
 * Two separate concerns, deliberately not merged into one router. Setup is a
 * linear takeover with a back button and a step count; the main app is a set of
 * peer views with no order. Modelling both as "routes" would make the setup
 * steps look skippable in the UI and the main views look sequential.
 */

export type View = "home" | "ledger" | "attendance" | "history" | "data";

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
];

// Home is the landing screen: the ledger answers "what are my marks", which is
// a question a student only has after the one Home answers - "am I fine".
const [view, setView] = createSignal<View>("home");
export { view, setView };

/** Setup steps, in order. `route` splits into the sync path or the manual one. */
export type Step = "welcome" | "route" | "sync" | "manual" | "goal" | "done";

export const STEP_ORDER: Step[] = ["welcome", "route", "goal"];

const [step, setStep] = createSignal<Step>("welcome");
export { step, setStep };

/** Setup runs until it is explicitly finished, not until data exists. */
export const needsSetup = () => !state.onboarded;
