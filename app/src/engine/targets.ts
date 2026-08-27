import {
  ATTENDANCE_CONDONE, ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN,
  GRADE_BANDS,
} from "./constants";
import { attendanceMarks, attendancePlan, effectiveAttendance } from "./attendance";
import type { AttendancePlan, Course, MarkInput } from "./types";
import { clamp, round, toOptionalFloat } from "./util";

/**
 * PERSONAL TARGETS. Not regulations.
 *
 * This module is one half of a deliberate split, and the split is the reason
 * the app is worth trusting:
 *
 *   - `constants.ts` holds what KTU decided. `ATTENDANCE_MIN`,
 *     `ATTENDANCE_CONDONE`, `DL_CAP_PCT`, `ATTENDANCE_MARK_BANDS`,
 *     `TOTAL_PASS_MARK`, `ESE_PASS_FRACTION`, `GRADE_BANDS`. Nothing here
 *     writes them and nothing reachable from a settings screen may. An app
 *     whose student can edit the pass mark is no longer the thing that knows
 *     the rules, which is the only reason to open it.
 *   - this file holds what the STUDENT decided. Every value is theirs, every
 *     value is optional, and a target may sit above a regulation floor
 *     (aspiration) or below one (a course already written off). Below is
 *     allowed and is NEVER silently accepted: `checkAttendanceTarget` and
 *     `checkGpaTarget` say so, in the vocabulary of the regulation the target
 *     undercuts, so a screen can print the consequence.
 *
 * An unset target is UNKNOWN, not zero. Every field is `number | null` or is
 * absent from its record; nothing here substitutes a figure for a blank.
 *
 * What is deliberately NOT a target here, with the reason:
 *
 *   - the per-course letter, `Course.target`. It stays on the course. It is
 *     row data that travels with the marks through every ingest path, it is
 *     read by `evaluate(course)` which is pure over ONE course, and a semester
 *     can hold two courses with the same code (a re-registered backlog beside
 *     its current sitting), so a per-course map would need a stable key this
 *     app does not have. Lifting it here would buy nothing and cost the purity
 *     of `evaluate`.
 *   - a percentage target. The 2024 scheme fixes percentage at 10 x CGPA, so
 *     storing one would be a second source of truth for one number.
 *   - a graduation credit total. No sourced figure for it exists in this repo
 *     - see `horizonToGraduation`, which derives a horizon from the student's
 *     own record precisely because inventing that total is not available.
 */

/**
 * The lowest attendance that earns EVERY attendance mark under R 7.5.ii.
 *
 * Read off `ATTENDANCE_MARK_BANDS` rather than pasted, so the two cannot
 * drift, and by minimum-over-the-full-marks-bands rather than by taking the
 * first row, so it does not silently depend on that table staying sorted.
 */
export const ATTENDANCE_FULL_MARKS_PCT: number = (() => {
  const full = ATTENDANCE_MARK_BANDS.filter(([, marks]) => marks >= ATTENDANCE_MARK_MAX);
  return full.length > 0 ? Math.min(...full.map(([pct]) => pct)) : ATTENDANCE_MIN;
})();

/**
 * The attendance target a student starts with. 85, not 75.
 *
 * 75 is the ELIGIBILITY threshold - the line below which you are not admitted
 * to the exam. It is not the line at which attendance stops costing you.
 * R 7.5.ii pays all `ATTENDANCE_MARK_MAX` CIE marks only from
 * `ATTENDANCE_FULL_MARKS_PCT`, so every point between the two is marks a
 * student loses without ever being told they lost them. Most students believe
 * 75 is the goal; the default they are handed should teach otherwise, and the
 * default is the only piece of teaching that reaches a student who changes
 * nothing.
 *
 * A default, not a floor. It is freely editable, in both directions.
 */
export const DEFAULT_ATTENDANCE_TARGET: number = ATTENDANCE_FULL_MARKS_PCT;

/**
 * The lowest grade point a PASS can carry: P, 5.5.
 *
 * Derived from `GRADE_BANDS`, which lists exactly the passing letters - F is
 * added to `GRADE_POINTS` separately and is not in the table. A GPA target
 * under this cannot be met with every course passed, which is a fact about the
 * regulations rather than about the student's ambition, so it is the floor
 * `checkGpaTarget` reports against.
 */
export const PASSING_GPA_MIN: number = Math.min(...GRADE_BANDS.map(([, , gp]) => gp));

/** GPAs live on a 0-10 scale. Not a preference - the scale has no more room. */
const GPA_MAX = 10;

/**
 * Everything the student has told the app they are aiming for.
 *
 * Stored under `AppState.goal`, which is where the CGPA target has always
 * lived. The field KEPT ITS NAME while its type widened, so a save holding
 * `goal: { cgpa: 8 }` needs no key to move: the CGPA target is at the same
 * path before and after, which is what makes the migration lossless by
 * construction rather than by a copy step that could be got wrong.
 */
export interface Targets {
  /** Final CGPA at graduation. Null = never set. */
  cgpa: number | null;
  /**
   * Personal attendance target, in percent, applied to every course.
   * Null = never set, or deliberately cleared. See `DEFAULT_ATTENDANCE_TARGET`
   * for what a student who has said nothing starts with.
   */
  attendance: number | null;
  /**
   * SGPA target for one named semester ("S3"). ABSENCE IS THE UNSET STATE -
   * there are no null entries, so a read under `noUncheckedIndexedAccess`
   * hands back `number | undefined` and the unknown cannot be mistaken for a
   * zero. `normaliseTargets` drops anything that does not coerce.
   */
  sgpaBySemester: Record<string, number>;
  /**
   * The SGPA target for any semester with no entry of its own. Null = none,
   * in which case a semester without an explicit target simply has no target.
   */
  sgpaDefault: number | null;
}

/** A student who has said nothing yet. */
export function defaultTargets(): Targets {
  return {
    cgpa: null,
    attendance: DEFAULT_ATTENDANCE_TARGET,
    sgpaBySemester: {},
    sgpaDefault: null,
  };
}

/** Coerce a stored GPA, or null. Out of scale is a typo, so it is clamped. */
function toGpa(raw: MarkInput): number | null {
  const value = toOptionalFloat(raw);
  return value === null ? null : round(clamp(value, 0, GPA_MAX), 3);
}

/** Coerce a stored attendance target, or null. Percentages live on 0-100. */
function toAttendancePct(raw: MarkInput): number | null {
  const value = toOptionalFloat(raw);
  return value === null ? null : round(clamp(value, 0, 100), 2);
}

/**
 * Bring a saved goal up to the full target set.
 *
 * Keyed off the SHAPE, never a version stamp, because a restored backup is an
 * old file arriving later and its shape is the only thing about it that can be
 * trusted - the same rule `migrateHistory` follows. Every field is read
 * independently with its own default, so the old one-field shape
 * `{ cgpa: 8 }`, the full shape, and a half-written shape all come out
 * complete, and running it twice changes nothing.
 *
 * `attendance` is the one field where ABSENT and NULL differ and must:
 * absent is a file written before this app had an attendance target, and its
 * student is handed the default; null is a student who cleared the field on
 * purpose and must not have it silently handed back. JSON preserves both, so
 * the distinction survives a save. A value that does not coerce - junk, a
 * string, NaN - is not a target and reads as cleared.
 *
 * NOTHING IS DISCARDED. `goal.cgpa` is at the same path in both shapes, so a
 * save holding a CGPA target comes back holding it.
 */
export function normaliseTargets(raw: unknown): Targets {
  const base = defaultTargets();
  if (!raw || typeof raw !== "object") return base;
  const obj = raw as Record<string, unknown>;

  const sgpaBySemester: Record<string, number> = {};
  const stored = obj["sgpaBySemester"];
  if (stored && typeof stored === "object") {
    for (const [name, value] of Object.entries(stored as Record<string, unknown>)) {
      const gpa = toGpa(value as MarkInput);
      if (gpa !== null) sgpaBySemester[name] = gpa;
    }
  }

  return {
    cgpa: toGpa(obj["cgpa"] as MarkInput),
    attendance: "attendance" in obj
      ? toAttendancePct(obj["attendance"] as MarkInput)
      : base.attendance,
    sgpaBySemester,
    sgpaDefault: toGpa(obj["sgpaDefault"] as MarkInput),
  };
}

/**
 * Where a personal attendance target sits against the regulations.
 *
 *   - `full` - at or above `ATTENDANCE_FULL_MARKS_PCT`. Eligible, and every
 *     attendance mark of R 7.5.ii is paid.
 *   - `eligible` - at or above `ATTENDANCE_MIN` but below that. Admitted to
 *     the exam, and losing CIE marks to do it. THIS IS THE BAND NOBODY WARNS
 *     STUDENTS ABOUT and the reason the default target is not 75.
 *   - `condonation` - at or above `ATTENDANCE_CONDONE` and below
 *     `ATTENDANCE_MIN`. Not eligible on its own: R 6.2 lets the Principal
 *     condone this band, for at most two semesters and against a fee. A target
 *     here is a target of needing a favour.
 *   - `debarred` - below `ATTENDANCE_CONDONE`. R 6.2 gives no appeal. A target
 *     here is a target of not sitting the exam.
 */
export type AttendanceTargetBand = "full" | "eligible" | "condonation" | "debarred";

export interface AttendanceTargetCheck {
  target: number;
  band: AttendanceTargetBand;
  /**
   * The target is under the eligibility threshold, so meeting it exactly does
   * not on its own admit the student to the exam - `condonation` and
   * `debarred`, and the two differ in whether anything can be done about it:
   * R 6.2 reaches the first band and does not reach the second at all. Read
   * `band` for which. This is the flag a screen must not ignore: setting a
   * target here is allowed, but accepting it in silence would let the app
   * agree with a plan the regulations do not permit.
   */
  belowRegulation: boolean;
  /** CIE marks R 7.5.ii pays at exactly this attendance, out of `marksMax`. */
  marksAtTarget: number;
  marksMax: number;
  /** Marks given up by aiming here rather than at full marks. 0 in `full`. */
  marksForfeited: number;
}

/**
 * Price a personal attendance target against the regulations.
 *
 * Null in, null out: no target is not a target of zero.
 */
export function checkAttendanceTarget(target: number | null): AttendanceTargetCheck | null {
  if (target === null) return null;
  const pct = clamp(target, 0, 100);
  const band: AttendanceTargetBand = pct >= ATTENDANCE_FULL_MARKS_PCT
    ? "full"
    : pct >= ATTENDANCE_MIN
      ? "eligible"
      : pct >= ATTENDANCE_CONDONE ? "condonation" : "debarred";
  const marksAtTarget = attendanceMarks(pct) ?? 0;
  return {
    target: pct,
    band,
    belowRegulation: pct < ATTENDANCE_MIN,
    marksAtTarget,
    marksMax: ATTENDANCE_MARK_MAX,
    marksForfeited: round(ATTENDANCE_MARK_MAX - marksAtTarget, 2),
  };
}

/**
 * The two distances a student is owed, kept apart on purpose.
 *
 * "How many classes to stay eligible" and "how many classes to hit my own
 * target" are different questions with different answers, and collapsing them
 * is how an app tells a student at 78% that they are fine. Both are solved by
 * `attendancePlan`, the same solver, differing only in the floor handed to it
 * - so the eligibility half is exactly the figure `Evaluation.plan` already
 * carries. It is a parameter so a caller holding an `Evaluation` can hand that
 * one figure over instead of producing a second; the default runs the
 * identical call rather than a different one, so the two agree either way.
 */
export interface AttendanceTargetGap {
  /** Attendance as the college would compute it today, or null if unknown. */
  current: number | null;
  /** The personal target this was solved against, or null if none is set. */
  target: number | null;
  /** Solved against `target`. Null when no target is set, or no raw counts. */
  toTarget: AttendancePlan | null;
  /** Solved against `ATTENDANCE_MIN`. Null when the portal gave no counts. */
  toEligible: AttendancePlan | null;
  /**
   * The target is at or below the eligibility threshold, so `toTarget` is not
   * the stricter of the two and a screen quoting it alone would understate
   * what the student has to do to sit the exam.
   */
  targetUnderEligibility: boolean;
}

/**
 * Both attendance distances for one course.
 *
 * `eligibility` defaults to the same solve `evaluate` runs, and a caller that
 * already has an `Evaluation` should pass `ev.plan` instead of paying for it
 * twice - the pattern `effectiveAttendance` already uses.
 */
export function attendanceTargetGap(
  course: Course,
  target: number | null,
  eligibility: AttendancePlan | null =
    attendancePlan(course.attended, course.held, course.dl ?? 0),
): AttendanceTargetGap {
  const pct = target === null ? null : clamp(target, 0, 100);
  return {
    current: effectiveAttendance(course, eligibility),
    target: pct,
    toTarget: pct === null
      ? null
      : attendancePlan(course.attended, course.held, course.dl ?? 0, pct),
    toEligible: eligibility,
    targetUnderEligibility: pct !== null && pct <= ATTENDANCE_MIN,
  };
}

/** Which target answered for a semester, so a screen can say where it came from. */
export type SgpaTargetBasis = "semester" | "default" | "none";

export interface ResolvedSgpaTarget {
  /** Null exactly when `basis` is "none". An unset target is not a zero. */
  value: number | null;
  basis: SgpaTargetBasis;
}

/**
 * The SGPA target for one semester: its own, else the blanket one, else none.
 *
 * `sgpaBySemester` carries no null entries (`normaliseTargets` drops anything
 * that does not coerce), so presence alone decides the first case and an
 * explicit target of any value beats the default - including one BELOW it,
 * which is a student who has decided this semester is a write-off and is
 * entitled to say so.
 */
export function sgpaTargetFor(targets: Targets, semester: string): ResolvedSgpaTarget {
  const explicit = targets.sgpaBySemester[semester];
  if (explicit !== undefined) return { value: explicit, basis: "semester" };
  if (targets.sgpaDefault !== null) return { value: targets.sgpaDefault, basis: "default" };
  return { value: null, basis: "none" };
}

export interface GpaTargetCheck {
  target: number;
  /**
   * Below `PASSING_GPA_MIN`. Every course passed, even all at the lowest
   * passing letter, still averages 5.5 - so a target under it is reachable
   * only by failing something. Allowed, and reported rather than refused.
   */
  belowPassing: boolean;
}

/** Where a CGPA or SGPA target sits against the grade table. Null in, null out. */
export function checkGpaTarget(target: number | null): GpaTargetCheck | null {
  if (target === null) return null;
  const value = clamp(target, 0, GPA_MAX);
  return { target: value, belowPassing: value < PASSING_GPA_MIN };
}

/**
 * A semester SGPA target and the CGPA goal, which can disagree.
 *
 * Two targets the student set separately, answering to one arithmetic: a
 * semester target of 7.5 does not reach a graduation CGPA of 8.5 that needs
 * 8.29 this semester. Neither is wrong and neither is overridden - the engine
 * reports the gap and the screen tells the student, because silently planning
 * against whichever one happened to be read first is how an app hands someone
 * a route to a number they did not ask for.
 *
 * Unknowns stay unknown: `sufficient` is null when either side is unset, never
 * false.
 */
export interface SgpaTargetReconciliation {
  personal: number | null;
  requiredForCgpa: number | null;
  /** How far the personal target falls short. 0 when it does not. */
  shortfall: number | null;
  /** Null when either side is unknown. */
  sufficient: boolean | null;
}

export function reconcileSgpaTarget(
  personal: number | null, requiredForCgpa: number | null,
): SgpaTargetReconciliation {
  if (personal === null || requiredForCgpa === null) {
    return { personal, requiredForCgpa, shortfall: null, sufficient: null };
  }
  const shortfall = round(Math.max(0, requiredForCgpa - personal), 3);
  return {
    personal,
    requiredForCgpa,
    shortfall,
    sufficient: personal >= requiredForCgpa - 1e-9,
  };
}
