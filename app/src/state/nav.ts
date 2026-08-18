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

export type View = "home" | "ledger" | "history" | "data";

export const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: "home", label: "Home", hint: "Where you stand and what needs doing" },
  { id: "ledger", label: "Semester", hint: "Marks, attendance and what you still need" },
  { id: "history", label: "History", hint: "Published results from past semesters" },
  { id: "data", label: "Data", hint: "Sync, import, catalogue and backup" },
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
