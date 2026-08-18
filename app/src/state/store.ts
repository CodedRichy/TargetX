import { createMemo } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import {
  cgpaFromSemesters, courseFromCode, defaultState, evaluate, planForSgpa,
  requiredSgpaForCgpa, statusFor, summarise,
} from "../engine";
import type { Course } from "../engine";
import type { AppState, Semester } from "../engine/course";

const KEY = "targetx.state.v1";

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
    return { ...defaultState(), ...parsed };
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

function edit(fn: (draft: AppState) => void) {
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
 * Record a finished semester's published SGPA.
 *
 * History is what the university printed, not what this app computed. Keeping
 * the two separate is what lets the app cross-check itself and say so when the
 * numbers disagree, instead of quietly agreeing with its own arithmetic.
 */
export function setHistory(name: string, sgpa: number, credits: number) {
  edit((s) => { s.history[name] = { sgpa, credits }; });
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
 * The goal line: what this semester must deliver for the target CGPA.
 *
 * Returns null when no goal is set - showing "required SGPA 0.00" to a student
 * who never asked for a goal is noise dressed as information.
 */
export const goalRequirement = createMemo(() => {
  const target = state.goal?.cgpa;
  if (!target) return null;
  return requiredSgpaForCgpa(target, state.history, summary().credits);
});

export const goalPlan = createMemo(() => {
  const need = goalRequirement();
  if (!need?.possible || !need.required) return null;
  return planForSgpa(activeCourses(), need.required);
});

/** Semesters that have both a published SGPA and a name, oldest first. */
export const trend = createMemo(() =>
  Object.entries(state.history)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1))));
