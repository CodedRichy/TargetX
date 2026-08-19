import { createMemo } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import {
  cgpaFromSemesters, courseFromCode, defaultState, evaluate, historyCredits,
  horizonToGraduation, planForSgpa, requiredSgpaForCgpa, statusFor, summarise,
  toFloat, toOptionalFloat,
} from "../engine";
import type { Course, MarkInput, SemesterHistory } from "../engine";
import type { AppState, Semester } from "../engine/course";

const KEY = "targetx.state.v1";

/**
 * Bring a saved `history` map up to the registered/earned split.
 *
 * Files written before that split hold the EARNED total under a field called
 * `credits`, and no arithmetic recovers the registered total from it. So the
 * value is moved to the name that actually describes it and the registered
 * total is left unknown - rather than being reinterpreted as though it had
 * always meant registered, which would move a real student's CGPA with
 * nothing on screen to explain it. Nothing is discarded: the old number
 * survives as `creditsEarned`, `cgpaFromSemesters` keeps weighting by it so
 * the displayed CGPA does not jump, and it names those semesters as
 * unconfirmed so History can ask for the registered figure.
 *
 * Keyed off the shape rather than a version stamp, because a restored backup
 * is the same old file arriving later and its shape is the only thing about
 * it that can be trusted. Idempotent.
 */
export function migrateHistory(raw: unknown): Record<string, SemesterHistory> {
  const out: Record<string, SemesterHistory> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as { sgpa?: MarkInput; credits?: MarkInput;
                             creditsRegistered?: MarkInput; creditsEarned?: MarkInput };
    out[name] = {
      sgpa: toFloat(entry.sgpa, 0),
      creditsRegistered: toOptionalFloat(entry.creditsRegistered),
      creditsEarned: toOptionalFloat(
        entry.creditsEarned !== undefined ? entry.creditsEarned : entry.credits),
    };
  }
  return out;
}

/**
 * Load saved work, or start clean.
 *
 * A corrupt file must never take the app down with it - the student's response
 * to "TargetX will not open" is to uninstall it. The bad payload is kept under
 * a side key so it can be recovered rather than silently destroyed.
 */
function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || typeof parsed !== "object" || !parsed.semesters) {
      throw new Error("shape");
    }
    return { ...defaultState(), ...parsed, history: migrateHistory(parsed.history) };
  } catch {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(`${KEY}.corrupt`, raw);
    } catch { /* storage unavailable; nothing more to salvage */ }
    return defaultState();
  }
}

export const [state, setState] = createStore<AppState>(load());

let saveTimer: number | undefined;
/** Debounced write. Typing a mark should not hit storage on every keystroke. */
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(unwrap(state)));
    } catch { /* quota or private mode; the session still works in memory */ }
  }, 250) as unknown as number;
}

export function edit(fn: (draft: AppState) => void) {
  setState(produce(fn));
  persist();
}

// --- semesters -------------------------------------------------------------

export const semesterNames = createMemo(() =>
  Object.keys(state.semesters).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));

export const activeCourses = createMemo<Course[]>(
  () => state.semesters[state.activeSemester]?.courses ?? []);

export function selectSemester(name: string) {
  edit((s) => {
    if (!s.semesters[name]) s.semesters[name] = { courses: [] } as Semester;
    s.activeSemester = name;
  });
}

export function addSemester() {
  const next = `S${semesterNames().length + 1}`;
  selectSemester(next);
}

// --- courses ---------------------------------------------------------------

export function addCourse(code = "") {
  edit((s) => {
    const sem = s.semesters[s.activeSemester];
    if (sem) sem.courses.push(code ? courseFromCode(code) : courseFromCode(""));
  });
}

export function updateCourse(index: number, patch: Partial<Course>) {
  edit((s) => {
    const course = s.semesters[s.activeSemester]?.courses[index];
    if (course) Object.assign(course, patch);
  });
}

export function removeCourse(index: number) {
  edit((s) => {
    s.semesters[s.activeSemester]?.courses.splice(index, 1);
  });
}

export function setGoal(cgpa: number | null) {
  edit((s) => { s.goal = { cgpa }; });
}

/**
 * Record a finished semester's published SGPA and registered credits.
 *
 * History is what the university printed, not what this app computed. Keeping
 * the two separate is what lets the app cross-check itself and say so when the
 * numbers disagree, instead of quietly agreeing with its own arithmetic.
 *
 * The earned total is not editable here and is carried through untouched: it
 * comes off a grade card or the portal, and the student is being asked for the
 * one number those sources do not publish.
 */
export function setHistory(name: string, sgpa: number, creditsRegistered: number | null) {
  edit((s) => {
    s.history[name] = {
      sgpa, creditsRegistered,
      creditsEarned: s.history[name]?.creditsEarned ?? null,
    };
  });
}

// --- derived ---------------------------------------------------------------

export const rows = createMemo(() =>
  activeCourses().map((course, index) => {
    const ev = evaluate(course);
    return { index, course, ev, status: statusFor(ev) };
  }));

export const summary = createMemo(() => summarise(activeCourses()));

export const overall = createMemo(() => cgpaFromSemesters(state.history));

/**
 * The goal line: the SGPA this semester and every one after it must average
 * for the target CGPA.
 *
 * A CGPA target is a graduation target, so it is solved over the semesters
 * that are actually left rather than against this one alone. The horizon is
 * derived from the student's own record and travels back with the answer, so
 * the screen states it instead of passing it off as fact.
 *
 * Returns null when no goal is set - showing "required SGPA 0.00" to a student
 * who never asked for a goal is noise dressed as information.
 */
export const goalRequirement = createMemo(() => {
  const target = state.goal?.cgpa;
  if (!target) return null;
  const credits = summary().credits;
  const horizon = horizonToGraduation(state.activeSemester, state.history, credits);
  return requiredSgpaForCgpa(target, state.history, credits, horizon);
});

/**
 * The cheapest route to the goal, priced in ESE marks.
 *
 * Chases the required AVERAGE in this semester, which is the only semester
 * whose subjects exist yet. Holding the average every semester is what reaches
 * the target CGPA, so the average is the right target to plan against.
 */
export const goalPlan = createMemo(() => {
  const need = goalRequirement();
  if (!need?.possible || !need.required) return null;
  return planForSgpa(activeCourses(), need.required);
});

/**
 * Semesters that have both a published SGPA and a name, oldest first.
 *
 * The chart's running CGPA is weighted the same way the real one is, so the
 * credits handed over are `historyCredits`, not either raw total.
 */
export const trend = createMemo(() =>
  Object.entries(state.history)
    .map(([name, v]) => ({ name, sgpa: v.sgpa, credits: historyCredits(v) }))
    .sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1))));
