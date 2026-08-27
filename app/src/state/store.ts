import { createMemo } from "solid-js";
import { createStore, produce, unwrap } from "solid-js/store";
import {
  attendanceTargetGap, cgpaFromSemesters, checkAttendanceTarget, checkGpaTarget,
  courseFromCode, defaultState, evaluate, historyCredits, horizonToGraduation,
  normaliseTargets, planForSgpa, reconcileSgpaTarget, requiredSgpaForCgpa,
  sgpaTargetFor, statusFor, summarise, toFloat, toOptionalFloat,
} from "../engine";
import type { Course, MarkInput, SemesterHistory, Targets } from "../engine";
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
    return {
      ...defaultState(), ...parsed,
      history: migrateHistory(parsed.history),
      goal: normaliseTargets(parsed.goal),
    };
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

// --- targets ---------------------------------------------------------------

/**
 * Every setter below rebuilds the whole target set from what is stored and
 * changes ONE field of it.
 *
 * Not a style choice: `s.goal` may be absent, or it may be a save that predates
 * the field it is about to be asked for, so patching it in place would write a
 * half-shape that the next read has to guess about. `normaliseTargets` is the
 * one place that decides what a stored goal means, and routing every write
 * through it means a setter can never produce a shape the loader would not.
 */
const patchTargets = (s: AppState, patch: Partial<Targets>) => {
  s.goal = { ...normaliseTargets(s.goal), ...patch };
};

/** The final CGPA target. Kept at this name because the UI already calls it. */
export function setGoal(cgpa: number | null) {
  edit((s) => { patchTargets(s, { cgpa }); });
}

/**
 * The personal attendance target, in percent.
 *
 * Null CLEARS it, and clearing is not the same as never having set one: a
 * cleared target stays cleared across a reload, while an absent one is handed
 * `DEFAULT_ATTENDANCE_TARGET`. `normaliseTargets` is where that distinction
 * lives; this only has to write the null rather than delete the key.
 */
export function setAttendanceTarget(attendance: number | null) {
  edit((s) => { patchTargets(s, { attendance }); });
}

/**
 * The SGPA target for one semester. Null removes the entry, which drops that
 * semester back to `sgpaDefault` rather than pinning it at nothing.
 */
export function setSemesterSgpaTarget(name: string, sgpa: number | null) {
  edit((s) => {
    const next = { ...normaliseTargets(s.goal).sgpaBySemester };
    if (sgpa === null) delete next[name];
    else next[name] = sgpa;
    patchTargets(s, { sgpaBySemester: next });
  });
}

/** The SGPA target for every semester that has none of its own. */
export function setDefaultSgpaTarget(sgpaDefault: number | null) {
  edit((s) => { patchTargets(s, { sgpaDefault }); });
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
 * The stored targets, always complete.
 *
 * Read this rather than `state.goal`: the raw field is optional and may hold
 * any shape a past version of the app wrote, and `normaliseTargets` is the one
 * function that says what such a shape means.
 */
export const targets = createMemo<Targets>(() => normaliseTargets(state.goal));

/** Where the personal attendance target sits against R 6.2 and R 7.5.ii. */
export const attendanceTargetCheck = createMemo(
  () => checkAttendanceTarget(targets().attendance));

/**
 * Distance to eligibility and distance to the personal target, per course,
 * indexed alongside `rows()`.
 *
 * The eligibility half is handed `ev.plan` rather than solved again, so the
 * number here and the number on the ledger row are one solve.
 */
export const attendanceGaps = createMemo(() => {
  const target = targets().attendance;
  return rows().map(({ course, ev }) => attendanceTargetGap(course, target, ev.plan));
});

/** The SGPA target for the semester on screen, and where it came from. */
export const semesterSgpaTarget = createMemo(
  () => sgpaTargetFor(targets(), state.activeSemester));

/** Where the CGPA target sits against the grade table. Null when unset. */
export const cgpaTargetCheck = createMemo(() => checkGpaTarget(targets().cgpa));

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
  const target = targets().cgpa;
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
 * The personal SGPA target for this semester against what the CGPA goal needs.
 *
 * Both are the student's own, set separately, and they can disagree. Neither
 * is overridden here - the gap is reported so a screen can say which one the
 * route below is chasing.
 */
export const sgpaTargetVsGoal = createMemo(() =>
  reconcileSgpaTarget(semesterSgpaTarget().value, goalRequirement()?.required ?? null));

/**
 * The route to the student's own SGPA target for this semester, priced in ESE
 * marks - the same solve `goalPlan` runs, against the other target.
 *
 * Separate from `goalPlan` on purpose. That one chases the average the CGPA
 * goal needs; this one chases the number the student typed for this semester.
 * Showing one under the other's name would hand someone a route to a target
 * they did not set, so both exist and `sgpaTargetVsGoal` says how far apart
 * they are.
 */
export const semesterTargetPlan = createMemo(() => {
  const target = semesterSgpaTarget().value;
  if (target === null) return null;
  return planForSgpa(activeCourses(), target);
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
