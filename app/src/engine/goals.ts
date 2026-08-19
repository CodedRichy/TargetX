import { ATTENDANCE_CONDONE, GRADE_BANDS, GRADE_POINTS } from "./constants";
import { evaluate, isDebarred } from "./evaluate";
import { isIncomplete, requiredEse } from "./grade";
import type { Course, Evaluation, Grade, SemesterHistory } from "./types";
import { round, toFloat } from "./util";

/**
 * The credits a past semester weighs by in the CGPA.
 *
 * Registered credits are the right denominator, and the only one KTU uses.
 * Where they are unknown - a save written before TargetX told the two totals
 * apart - the earned total stands in, so the CGPA a student has been looking
 * at does not shift under them with nothing on screen to explain it. Those
 * semesters are named in `CgpaResult.unconfirmed` so the History screen can
 * ask for the real figure instead.
 */
export function historyCredits(entry: SemesterHistory): number {
  return entry.creditsRegistered ?? entry.creditsEarned ?? 0;
}

/** Semesters whose CGPA weight had to fall back to the earned total. */
export function unconfirmedSemesters(history: Record<string, SemesterHistory>): string[] {
  return Object.entries(history)
    .filter(([, v]) => v.creditsRegistered == null)
    .map(([name]) => name);
}

/**
 * The semesters after this one that still count toward the CGPA.
 *
 * `credits` is their total, not a per-semester figure - it is what enters the
 * solve, and it is the number the UI has to state as an assumption.
 */
export interface GoalHorizon {
  semesters: number;
  credits: number;
}

/** Solve for this semester alone, which is what the app used to do. */
export const NO_HORIZON: GoalHorizon = { semesters: 0, credits: 0 };

/** A KTU B.Tech runs S1 to S8. Semesters are countable; credits are not. */
const PROGRAMME_SEMESTERS = 8;
/**
 * Last-resort credits per semester, for a student with no record at all.
 *
 * A placeholder, not a regulation - nothing in the scheme fixes a per-semester
 * credit load. It only ever applies before the first semester has any credits
 * entered, and the horizon it produces is stated on screen as an assumption.
 */
const DEFAULT_SEMESTER_CREDITS = 20;

/**
 * How much course is left between the active semester and graduation.
 *
 * Derived from the student's own record rather than a programme credit total,
 * because this repo has no sourced total to use: the KTU 2024 figure is not
 * cited anywhere here, and the curriculum tables list every elective on offer
 * instead of a student's registered load, so their per-semester sums are far
 * above what anyone actually takes. What a student has registered for in past
 * semesters is weak evidence, but it is evidence, and `GoalHorizon` is
 * returned alongside the answer so the screen can say what was assumed.
 *
 * A semester name that does not parse yields no horizon, which collapses the
 * goal back to the one-semester solve rather than inventing a graduation date.
 */
export function horizonToGraduation(
  activeSemester: string,
  history: Record<string, SemesterHistory>,
  semesterCredits: number,
): GoalHorizon {
  const match = /^S(\d+)$/i.exec(activeSemester.trim());
  if (!match) return NO_HORIZON;
  const semesters = Math.max(0, PROGRAMME_SEMESTERS - Number(match[1]));
  if (semesters === 0) return NO_HORIZON;

  // A semester with no credits on record is unknown, not empty, so it is left
  // out of the mean rather than dragging it down.
  const past = Object.values(history).map(historyCredits).filter((c) => c > 0);
  const current = toFloat(semesterCredits, 0);
  const perSemester = past.length > 0
    ? past.reduce((sum, c) => sum + c, 0) / past.length
    : current > 0 ? current : DEFAULT_SEMESTER_CREDITS;

  return { semesters, credits: round(semesters * perSemester, 3) };
}

export interface RequiredSgpa {
  required: number | null;
  possible: boolean;
  ceiling?: number;
  slack?: boolean;
  reason?: string;
  /** The horizon `required` is an average over. */
  horizon: GoalHorizon;
  /**
   * Past semesters weighted by earned credits because the registered total is
   * unknown, exactly as in `CgpaResult`. Non-empty means this requirement was
   * solved against a best-effort CGPA and the screen should say so.
   */
  unconfirmed: string[];
}

/**
 * "I want an 8.0 CGPA by graduation" -> the SGPA every semester still to be
 * sat has to average, this one included.
 *
 * Solves target = (pastPoints + sgpa * (credits + horizon.credits)) /
 * (pastCredits + credits + horizon.credits) for sgpa. A graduation CGPA and a
 * this-semester SGPA are two different goals, and solving the first as though
 * the degree ended in December makes almost every worthwhile target look
 * impossible - which removed the plan panel and with it the point of the app.
 * Pass `NO_HORIZON` to ask the this-semester question deliberately.
 *
 * Impossibility is still reported honestly over whatever horizon is given:
 * past semesters are frozen, so a target can be arithmetically out of reach no
 * matter what happens next, and telling a student to chase it anyway would be
 * the cruel kind of wrong.
 */
export function requiredSgpaForCgpa(
  targetCgpa: number,
  history: Record<string, SemesterHistory>,
  semesterCredits: number,
  horizon: GoalHorizon,
): RequiredSgpa {
  const past = Object.values(history).map((v) => [historyCredits(v), v.sgpa || 0] as const);
  const pastCredits = past.reduce((sum, [c]) => sum + c, 0);
  const pastPoints = past.reduce((sum, [c, sgpa]) => sum + sgpa * c, 0);
  const credits = toFloat(semesterCredits, 0);
  const unconfirmed = unconfirmedSemesters(history);

  if (credits <= 0) {
    return {
      required: null, possible: false, horizon, unconfirmed,
      reason: "no credits registered this semester",
    };
  }

  // Everything still to be earned, this semester plus the horizon.
  const open = credits + Math.max(0, toFloat(horizon.credits, 0));
  const needed = round((targetCgpa * (pastCredits + open) - pastPoints) / open, 3);

  if (needed > 10) {
    // Even straight S grades cannot get there.
    const ceiling = round((pastPoints + 10 * open) / (pastCredits + open), 3);
    const left = horizon.semesters + 1;
    return {
      required: needed,
      possible: false,
      ceiling,
      horizon,
      unconfirmed,
      reason: left > 1
        ? `even all-S across the ${left} semesters left tops out at ${ceiling.toFixed(2)}`
        : `even all-S this semester tops out at ${ceiling.toFixed(2)}`,
    };
  }
  if (needed <= 0) {
    return {
      required: 0, possible: true, slack: true, horizon, unconfirmed,
      reason: "already secured by past semesters",
    };
  }
  return { required: needed, possible: true, slack: false, horizon, unconfirmed };
}

export interface CourseOption {
  grade: Grade;
  gp: number;
  ese: number;
  locked: boolean;
  credits: number;
  eseMax: number;
  /**
   * Priced from a full CIE because nothing has been marked yet, so `ese` is
   * the least this grade could cost rather than what it will cost. Whoever
   * shows this row has to say so.
   */
  unassessed: boolean;
}

/**
 * Every grade still reachable in a course, with what it costs.
 *
 * Cost is the ESE mark required - the only currency a student actually spends.
 * Grades already impossible are omitted rather than shown greyed out, because
 * a plan built on them is not a plan.
 *
 * An unassessed course has no CIE to price against: its components are
 * unmarked, and the attendance marks R 7.5.ii may already have earned are not
 * a CIE. Reverse-solving off that near-zero would call every letter impossible
 * and drop the course - one ungraded lab would then take the whole semester's
 * plan with it. So the ladder is priced from a full CIE bucket instead, which
 * is the strongest bound that is actually true: whatever the internals turn
 * out to be, the grade cannot cost less than this. `unassessed` is set on
 * every such row so the figure is never read as a settled requirement.
 *
 * On an internal-only course that bound is zero for every letter, since there
 * is no exam to spend anything in. True, and useless to a planner - see
 * `unplannable`.
 *
 * A withdrawn or incomplete course yields no rows at all: there is no ladder
 * to climb in a course that is not being sat this semester.
 */
export function courseOptions(course: Course): CourseOption[] {
  const ev = evaluate(course);
  if (isIncomplete(ev.grade)) {
    // Withdrawn or incomplete. No grade is on offer in a course nobody is
    // sitting, and a locked row would price it into the plan at a grade point
    // it does not have.
    return [];
  }
  if (ev.grade !== null) {
    // Already decided by a published grade.
    return [{
      grade: ev.grade, gp: GRADE_POINTS[ev.grade], ese: ev.ese ?? 0,
      locked: true, credits: ev.credits, eseMax: ev.eseMax, unassessed: false,
    }];
  }

  const options: CourseOption[] = [];
  const cie = ev.assessed ? ev.cie : ev.cieMax;
  for (const [letter, , gp] of GRADE_BANDS) {
    const need = requiredEse(cie, letter, ev.eseMax);
    if (need.possible) {
      options.push({
        grade: letter, gp, ese: need.value, locked: false,
        credits: ev.credits, eseMax: ev.eseMax, unassessed: !ev.assessed,
      });
    }
  }
  options.sort((a, b) => a.gp - b.gp);
  return options;
}

export interface PlanRow {
  code: string;
  grade: Grade;
  ese: number;
  credits: number;
  locked: boolean;
  /**
   * The paper `ese` is out of. Zero for an internal-only course, where there
   * is no exam at all - whoever renders the row must not call `ese` an exam
   * mark in that case.
   */
  eseMax: number;
  /** `ese` is a floor priced from an unmarked CIE. See `CourseOption`. */
  unassessed: boolean;
}

export interface SgpaPlan {
  reachable: boolean;
  sgpa?: number;
  target?: number;
  credits?: number;
  plan: PlanRow[];
  maxSgpa?: number;
  /**
   * Why the plan is what it is. Set on a reachable plan too, when courses had
   * to be left out of it - the student is owed the omission either way.
   */
  reason?: string;
}

/**
 * Why the plan cannot move this course, or null if it can.
 *
 * The plan is denominated in ESE marks, so a course with no exam left to sit
 * is not something a student can be told to do anything about:
 *
 *   - Withdrawn or incomplete. There is no exam of theirs left this semester,
 *     and the course is out of the SGPA being solved for.
 *   - Debarred. Instructing a mark in an exam they will not be admitted to is
 *     worse than saying nothing.
 *   - Internal-only (`eseMax === 0`) with nothing marked yet. `courseOptions`
 *     truthfully reports every grade still open at a cost of zero exam marks,
 *     because there is no exam - but the greedy below buys rungs by cost, and
 *     a whole ladder priced at zero is free grade points. It would climb that
 *     one course to an S before asking a single mark of any other and call the
 *     target met with every real paper left at P.
 *
 * A published GRADE decides the course whatever else is true of it, so it is
 * plannable - as a locked row that costs nothing because it is already earned.
 * A published I or W is not a grade and does not: it is the first case above.
 */
function unplannable(ev: Evaluation): string | null {
  // Withdrawn or incomplete. Out of the SGPA the plan is solving for, so its
  // credits have to leave the plan's denominator with it - exactly what
  // `summarise` does with them - and there is no exam of its own to aim at.
  if (isIncomplete(ev.grade)) return ev.grade === "W" ? "withdrawn" : "incomplete";
  if (ev.grade !== null) return null;
  if (isDebarred(ev)) return `attendance below ${ATTENDANCE_CONDONE}%`;
  if (ev.eseMax === 0 && !ev.assessed) return "no exam to aim at, and no internals marked yet";
  return null;
}

/**
 * Cheapest route to a target SGPA: which subject to push, and how far.
 *
 * Greedy on the DIFFICULTY OF THE RESULT, not on marginal cost. Minimising
 * total marks looks optimal and gives terrible advice: it buys the biggest
 * credit jumps first and hands back a plan demanding 60/60 in two papers while
 * leaving others at D. Pushing whichever subject has the easiest next rung
 * spreads the load and produces a plan a person can actually attempt.
 *
 * Ladders are keyed by position, not by course code - two courses sharing a
 * code (a re-registered backlog alongside its current sitting) would otherwise
 * silently collapse into one.
 *
 * Courses the plan has no mark to move are left out of it entirely, marks and
 * credits both, and `reason` names each one - see `unplannable`. A plan that
 * quietly shrinks is a plan that overstates what the semester is worth.
 */
export function planForSgpa(courses: Course[], targetSgpa: number): SgpaPlan {
  const plannable: Course[] = [];
  const left: string[] = [];
  for (const course of courses) {
    const why = unplannable(evaluate(course));
    if (why === null) plannable.push(course);
    else left.push(`${course.code || course.name || "?"} left out: ${why}`);
  }
  /** Carry the exclusions alongside whatever else there is to report. */
  const note = (reason?: string) => [reason, ...left].filter(Boolean).join("; ") || undefined;

  const totalCredits = plannable.reduce((sum, c) => sum + toFloat(c.credits, 0), 0);
  if (totalCredits <= 0) {
    // Not "no credits" when the courses were excluded rather than absent -
    // that would name the wrong problem.
    return { reachable: false, plan: [], reason: note() ?? "no credits" };
  }

  const neededPoints = targetSgpa * totalCredits;
  const ladders: CourseOption[][] = [];
  const labels: string[] = [];
  let current = 0;

  for (const course of plannable) {
    const options = courseOptions(course);
    const label = course.code || course.name || "?";
    if (options.length === 0) {
      return { reachable: false, plan: [], reason: note(`${label} cannot be passed`) };
    }
    ladders.push(options);
    labels.push(label);
    current += options[0]!.gp * options[0]!.credits;
  }

  const chosen = ladders.map(() => 0);
  const ceiling = ladders.reduce((sum, opts) => {
    const best = opts[opts.length - 1]!;
    return sum + best.gp * best.credits;
  }, 0);

  if (neededPoints > ceiling + 1e-9) {
    return {
      reachable: false, plan: [],
      maxSgpa: round(ceiling / totalCredits, 3),
      reason: note("target is above the best still available"),
    };
  }

  while (current < neededPoints - 1e-9) {
    let bestIndex = -1;
    let bestCost = Infinity;
    let bestGain = 0;
    for (let i = 0; i < ladders.length; i += 1) {
      const options = ladders[i]!;
      const at = chosen[i]!;
      if (at + 1 >= options.length) continue;
      const here = options[at]!;
      const next = options[at + 1]!;
      const gain = (next.gp - here.gp) * here.credits;
      if (gain <= 0) continue;
      // How hard the resulting requirement is, as a share of the paper.
      const cost = next.ese / Math.max(next.eseMax || 60, 1e-9);
      if (cost < bestCost) {
        bestIndex = i;
        bestCost = cost;
        bestGain = gain;
      }
    }
    if (bestIndex < 0) break;
    chosen[bestIndex] = chosen[bestIndex]! + 1;
    current += bestGain;
  }

  const plan: PlanRow[] = chosen.map((at, i) => {
    const pick = ladders[i]![at]!;
    return {
      code: labels[i]!, grade: pick.grade, ese: pick.ese, credits: pick.credits,
      locked: pick.locked, eseMax: pick.eseMax, unassessed: pick.unassessed,
    };
  });
  plan.sort((a, b) => b.ese - a.ese);

  return {
    reachable: current >= neededPoints - 1e-9,
    sgpa: round(current / totalCredits, 3),
    target: targetSgpa,
    credits: totalCredits,
    plan,
    maxSgpa: round(ceiling / totalCredits, 3),
    reason: note(),
  };
}

export interface CgpaResult {
  cgpa: number;
  credits: number;
  percent: number;
  /**
   * Semesters weighted by their earned credits because the registered total
   * is unknown. Non-empty means the CGPA is a best effort, not the figure
   * KTU would print, and the student has a number to supply.
   */
  unconfirmed: string[];
}

export function cgpaFromSemesters(
  semMap: Record<string, SemesterHistory>,
): CgpaResult {
  const rows = Object.entries(semMap);
  const unconfirmed = unconfirmedSemesters(semMap);
  const credits = rows.reduce((sum, [, v]) => sum + historyCredits(v), 0);
  if (credits <= 0) return { cgpa: 0, credits: 0, percent: 0, unconfirmed };
  const weighted = rows.reduce((sum, [, v]) => sum + (v.sgpa || 0) * historyCredits(v), 0);
  const cgpa = round(weighted / credits, 3);
  // 2024 scheme: Percentage = 10 x CGPA. No (10 x CGPA) - 2.5 legacy fudge.
  return { cgpa, credits, percent: round(cgpa * 10, 2), unconfirmed };
}
