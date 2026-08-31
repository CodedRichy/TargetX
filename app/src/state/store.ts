import { createMemo, createSignal } from "solid-js";
import { createStore, produce, reconcile, unwrap } from "solid-js/store";
import { hasFileStore, readStateFile, stateFilePath, writeStateFile } from "./persist";
import {
  attendanceTargetGap, cgpaFromSemesters, checkAttendanceTarget, checkGpaTarget,
  courseFromCode, defaultState, evaluate, historyCredits, horizonToGraduation,
  normaliseTargets, planForSgpa, reconcileSgpaTarget, requiredSgpaForCgpa,
  sgpaTargetFor, statusFor, summarise, toFloat, toOptionalFloat,
} from "../engine";
import type { Course, HistorySource, MarkInput, SemesterHistory, Targets } from "../engine";
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
                             creditsRegistered?: MarkInput; creditsEarned?: MarkInput;
                             source?: unknown; conflict?: unknown };
    // A save written before provenance was tracked has no `source`; its origin
    // cannot be recovered, so it is tagged `unknown` - trusted over a fresh
    // scrape but below a grade card. A new save round-trips its own source, so
    // the migration is idempotent. Any stored conflict is a plain {source,sgpa}
    // and rides along untouched when present.
    const source: HistorySource =
      entry.source === "gradecard" || entry.source === "manual" || entry.source === "etlab"
        ? entry.source : "unknown";
    const rawConflict = entry.conflict as { source?: unknown; sgpa?: unknown } | null | undefined;
    const conflict =
      rawConflict && typeof rawConflict === "object" &&
      (rawConflict.source === "gradecard" || rawConflict.source === "manual" ||
       rawConflict.source === "unknown" || rawConflict.source === "etlab")
        ? { source: rawConflict.source as HistorySource, sgpa: toFloat(rawConflict.sgpa as MarkInput, 0) }
        : null;
    out[name] = {
      sgpa: toFloat(entry.sgpa, 0),
      creditsRegistered: toOptionalFloat(entry.creditsRegistered),
      creditsEarned: toOptionalFloat(
        entry.creditsEarned !== undefined ? entry.creditsEarned : entry.credits),
      source,
      conflict,
    };
  }
  return out;
}

/**
 * A saved payload, read.
 *
 * `savedAt` is written alongside the state but is never part of it: it exists
 * only so `hydrate` can tell which of two copies is the later one, and putting
 * it in `AppState` would push it into every export and every test's idea of
 * what the state is.
 *
 * Returns null for anything that is not recognisably a save, so the caller can
 * tell "nothing here" from "something here I could not read".
 */
function parse(raw: string): { state: AppState; savedAt: number } | null {
  const parsed = JSON.parse(raw) as AppState & { savedAt?: unknown };
  if (!parsed || typeof parsed !== "object" || !parsed.semesters) return null;
  const stamp = typeof parsed.savedAt === "string" ? Date.parse(parsed.savedAt) : NaN;
  const state = {
    ...defaultState(), ...parsed,
    history: migrateHistory(parsed.history),
    goal: normaliseTargets(parsed.goal),
  };
  delete (state as { savedAt?: unknown }).savedAt;
  return { state, savedAt: Number.isFinite(stamp) ? stamp : 0 };
}

/**
 * Load saved work, or start clean.
 *
 * A corrupt file must never take the app down with it - the student's response
 * to "TargetX will not open" is to uninstall it. The bad payload is kept under
 * a side key so it can be recovered rather than silently destroyed.
 *
 * Reads `localStorage` and only `localStorage`, because a store has to exist
 * the moment this module is imported and a file read cannot be synchronous.
 * Under the Tauri shell this is a seed that `hydrate` then corrects from disk;
 * in a browser it is the whole story.
 */
function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const read = parse(raw);
    if (!read) throw new Error("shape");
    return read.state;
  } catch {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) localStorage.setItem(`${KEY}.corrupt`, raw);
    } catch { /* storage unavailable; nothing more to salvage */ }
    return defaultState();
  }
}

export const [state, setState] = createStore<AppState>(load());

/**
 * Why the last save did not fully land, or null when it did.
 *
 * `file` and `browser` both mean the marks on screen are not written down
 * anywhere durable. `backup` means they are, but the spare copy is not being
 * kept. `launch.ts` turns this into the banner; nothing else should read it.
 */
export type SaveFault = { kind: "file" | "browser" | "backup"; error: string };
export const [saveFault, setSaveFault] = createSignal<SaveFault | null>(null);

/**
 * How long typing settles before a save runs.
 *
 * Not chosen for disk cost - a full 8-semester record serialises to 15,881
 * bytes and one atomic save of it measured 2.28 ms on this machine's Roaming
 * profile over 200 runs, so even at 250 ms the disk is idle. It is chosen for
 * how many saves ONE typed mark produces: a mark is two or three keystrokes at
 * roughly 200 ms apart, and at 250 ms that is two or three whole-state writes
 * across the IPC bridge for one number. 750 ms collapses a typed field into
 * one save.
 *
 * The extra 500 ms of exposure that buys is closed by `flush`, which runs when
 * the window loses focus, is hidden, or is closing - the only ways a desktop
 * app actually goes away.
 */
export const SAVE_DEBOUNCE_MS = 750;

let saveTimer: number | undefined;
/** Serialises writes: two saves must never be in the same temp file at once. */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => { /* the caller reports it; the queue moves on */ });
  return next;
}

function payload(): string {
  return JSON.stringify({ ...unwrap(state), savedAt: new Date().toISOString() });
}

/**
 * Write both copies now.
 *
 * `localStorage` goes first because it is synchronous and therefore the copy
 * that survives a process killed between here and the rename landing. The file
 * is the record; this is the receipt that the record is behind.
 */
async function save(): Promise<void> {
  const json = payload();

  let browserError: string | null = null;
  try {
    localStorage.setItem(KEY, json);
  } catch (exc) {
    browserError = String(exc);
  }

  if (!hasFileStore()) {
    // No file behind it, so a failed `localStorage` write here IS the loss.
    setSaveFault(browserError ? { kind: "browser", error: browserError } : null);
    return;
  }

  try {
    const outcome = await serialise(() => writeStateFile(json));
    setSaveFault(outcome.backupError
      ? { kind: "backup", error: outcome.backupError }
      : null);
  } catch (exc) {
    setSaveFault({ kind: "file", error: String(exc) });
  }
}

/** Debounced write. Typing a mark should not hit storage on every keystroke. */
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void save(); }, SAVE_DEBOUNCE_MS) as unknown as number;
}

/** Write now, skipping the debounce. Safe to call when nothing is pending. */
export async function flush(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  await save();
}

let started = false;

/**
 * Bring the store onto the file, and keep it there.
 *
 * Called once, from the opening screen, before the launch check runs - so the
 * audit in `launch.ts` reads the record rather than the seed.
 *
 * Three cases, in order:
 *
 * - A file exists and is at least as new as the `localStorage` copy: it wins,
 *   which is what "the file is the source of truth" means.
 * - A file exists but the browser copy is provably newer: the browser copy
 *   wins and is written straight back to the file. That only happens when a
 *   previous run was killed between the synchronous `localStorage` write and
 *   the file landing, and the alternative is showing a student a mark they
 *   already typed being gone.
 * - No file: this is an install upgrading from the localStorage-only build, so
 *   the seed is written out. The `localStorage` copy is deliberately NOT
 *   deleted - it stays as the safety net for at least this version.
 */
export async function hydrate(): Promise<void> {
  if (started) return;
  started = true;
  if (typeof window !== "undefined") {
    // `blur` and `visibilitychange` are the ones that fire early enough for an
    // async file write to finish. `beforeunload` cannot await anything, but the
    // `localStorage` half of `save` is synchronous and does complete - and
    // `hydrate` above is what turns that copy back into the record.
    window.addEventListener("blur", () => { void flush(); });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flush();
    });
    window.addEventListener("beforeunload", () => { void flush(); });
  }
  if (!hasFileStore()) return;

  try {
    const raw = await readStateFile();
    if (raw === null) {
      await flush();
      return;
    }
    const onDisk = parse(raw);
    if (!onDisk) {
      // Unreadable, and it is the record. Say so rather than overwriting it:
      // `runLaunchCheck` will not catch this, because the seed in memory is
      // perfectly well-shaped.
      setSaveFault({
        kind: "file",
        error: `${await stateFilePath()} is not in a shape TargetX recognises`,
      });
      return;
    }
    let stored = 0;
    try {
      const raw2 = localStorage.getItem(KEY);
      stored = raw2 ? (parse(raw2)?.savedAt ?? 0) : 0;
    } catch { /* no browser storage; the file is unopposed */ }

    if (stored > onDisk.savedAt) {
      await flush();
      return;
    }
    setState(reconcile(onDisk.state, { merge: true }));
  } catch (exc) {
    setSaveFault({ kind: "file", error: String(exc) });
  }
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
    // The History screen is where the student supplies the one figure no source
    // publishes - the registered-credits denominator - and corrects an SGPA by
    // hand. It is an EDIT of the existing record, not a rival source: it keeps
    // whatever source the figure already had (a card stays a card) and only
    // tags `manual` when there was nothing there to edit. Folding it through
    // `mergeHistory` instead would let a stored grade card discard the credits
    // the student just typed, which is the opposite of the screen's job.
    const prev = s.history[name];
    s.history[name] = {
      sgpa, creditsRegistered,
      creditsEarned: prev?.creditsEarned ?? null,
      source: prev?.source ?? "manual",
      conflict: prev?.conflict ?? null,
    };
  });
}

/**
 * Clear the "what changed since last sync" batch once the student has read it.
 *
 * Dismissing drops the whole record, not one line: the panel answers a single
 * question - "what moved in the last sync" - and a half-dismissed answer to it
 * is worse than none. The next sync writes a fresh batch regardless.
 */
export function dismissChanges() {
  edit((s) => { s.changes = undefined; });
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
