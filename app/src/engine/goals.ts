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

/**
 * Semesters whose CGPA weight is not the registered total KTU uses.
 *
 * Two different states, and this list does not tell them apart. Where
 * `creditsEarned` is known the weight falls back to it. Where neither total is
 * known `historyCredits` yields 0, so the semester weighs nothing at all and
 * drops out of the CGPA. Both are a figure the student should be asked for;
 * only the first is a fallback.
 */
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
   * Priced from the best CIE the course can still reach rather than from the
   * one it has, because that CIE can still move - so `ese` is the least this
   * grade could cost rather than what it will cost, and whoever shows this row
   * has to say so. Set whenever `Evaluation.cieCeiling` is above `cie`, which
   * covers all three ways an internal is still open: a component with no mark
   * yet, an attendance percentage nobody has recorded, and an attendance
   * percentage that is recorded but not yet worth its full `attMax`.
   */
  cieUnknown: boolean;
}

/**
 * Every grade still reachable in a course, with what it costs.
 *
 * Cost is the ESE mark required - the only currency a student actually spends.
 * Grades already impossible are omitted rather than shown greyed out, because
 * a plan built on them is not a plan.
 *
 * A course whose CIE can still move has nothing exact to price against - a
 * component may be unmarked, the attendance may be unrecorded, or it may be
 * recorded below the band that pays all `attMax` marks. Reverse-solving off
 * the figure `evaluate` reports overstates every rung, and off a near-zero it
 * calls every letter impossible and drops the course - one part-marked lab
 * would then take the whole semester's plan with it. So the ladder is priced
 * from the HIGHEST CIE the course can still reach, and `cieUnknown` is set on
 * every such row so the figure is read as the least the grade could cost
 * rather than as a settled requirement.
 *
 * That bound is `Evaluation.cieCeiling`, and reaching instead for the full
 * `cieMax` bucket prices the ladder off marks the course has already ruled
 * out: measured on a TH 40/60 with 10/50, 10/50 and 2/10 recorded and no
 * attendance, the bucket says A+ costs 45 of 60 when the best total still
 * available is 12 + 60 = 72, a B. A cost that is too low is the one a student
 * acts on. Reaching for `cie` instead is the mirror of it - measured on a
 * LAB 75/25 with one 10/50 series mark in, 28 marks of unmarked components
 * and a floor of 13.4, the floor prices every letter impossible,
 * `courseOptions` returns nothing at all, and one lab with one mark in it
 * takes the whole semester's plan down with it.
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
      locked: true, credits: ev.credits, eseMax: ev.eseMax, cieUnknown: false,
    }];
  }

  const options: CourseOption[] = [];
  // One bound, and it is the true one in every case: `cieCeiling` is the whole
  // bucket where nothing is marked, the recorded marks plus what is still
  // earnable where some are, and the internal itself where the CIE is settled.
  // `cieUnknown` follows from the same figure rather than from a second
  // predicate that could disagree with it.
  const cie = ev.cieCeiling;
  const cieUnknown = ev.cieCeiling > ev.cie;
  for (const [letter, , gp] of GRADE_BANDS) {
    const need = requiredEse(cie, letter, ev.eseMax);
    if (need.possible) {
      options.push({
        grade: letter, gp, ese: need.value, locked: false,
        credits: ev.credits, eseMax: ev.eseMax, cieUnknown,
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
  /** `ese` is a floor priced from an unsettled CIE. See `CourseOption`. */
  cieUnknown: boolean;
}

export interface SgpaPlan {
  /**
   * The route reaches the target WHATEVER the courses it could not price do.
   *
   * A guarantee, not a best case. Where the answer turns on a course the plan
   * has no mark to move - see `unpriced` - this is false and `conditional` is
   * true, so a caller that reads this field alone gets the safe end of the
   * range rather than the convenient one.
   */
  reachable: boolean;
  /**
   * The route falls short on its own but the target is still open, because the
   * `unpriced` courses could carry the rest. Never true alongside `reachable`,
   * and never true when the target is out of reach at every end.
   */
  conditional?: boolean;
  /**
   * Courses inside `credits` whose grade points the plan cannot price: they
   * have no exam to aim at and their internals are not settled, so the SGPA
   * this route yields is a range rather than a number. Named so a screen can
   * say which course the answer is waiting on.
   */
  unpriced?: string[];
  /**
   * The SGPA this route yields with every `unpriced` course scoring nothing -
   * the floor of that range, and the figure `reachable` is decided against.
   */
  sgpa?: number;
  target?: number;
  /**
   * The credits the SGPA is divided by: every course registered this semester
   * bar the withdrawn and incomplete ones. Deliberately the SAME total
   * `summarise` reports, because `requiredSgpaForCgpa` is solved against that
   * one - a target solved over eight credits and a route built over four are
   * two answers to two different questions.
   */
  credits?: number;
  /** The best SGPA still available, `unpriced` courses at their own ceiling. */
  maxSgpa?: number;
  /**
   * Why the plan is what it is. Set on a reachable plan too, when courses had
   * to be left out of the route - the student is owed the omission either way.
   */
  reason?: string;
  plan: PlanRow[];
}

/**
 * What the plan does with a course it cannot ask for an exam mark in, or null
 * where it can.
 *
 * `basis` is the half that matters, because it decides the DENOMINATOR. An
 * SGPA is points over credits, and this is the only place that says which
 * credits those are. It has to agree with `summarise`, because the target
 * being planned for was solved over `summarise`'s total.
 *
 *   - `out` - withdrawn or incomplete. There is no exam of theirs left this
 *     semester and KTU keeps the course out of the SGPA entirely, denominator
 *     included, which is exactly what `summarise` does with it.
 *   - `zero` - debarred. They will not be admitted to the ESE, so the course
 *     scores F: a real grade with a real grade point of 0 over credits that
 *     stay registered (R 9.1 gives F, Ab and FE a grade point of 0 and divides
 *     by the total credits REGISTERED in the semester). Its credits stay in
 *     the denominator and its contribution is a known zero. It still never
 *     appears as a row - instructing a mark in an exam they will not be
 *     admitted to is worse than saying nothing.
 *   - `unknown` - internal-only (`eseMax === 0`) with an unsettled CIE. Its
 *     credits are registered like any other, but its grade points are neither
 *     plannable nor known, so one term of the SGPA is a range. `courseOptions`
 *     truthfully reports every grade still open at a cost of zero exam marks,
 *     because there is no exam - but the greedy below buys rungs by cost, and
 *     a whole ladder priced at zero is free grade points. It would climb that
 *     one course to an S before asking a single mark of any other and call the
 *     target met with every real paper left at P. Nothing marked, a series
 *     mark missing, or the attendance missing all leave the internal a floor
 *     (`cieFloor`) and produce the same free ladder, so the same treatment
 *     applies to all three. A settled internal-only course does not reach here
 *     at all: its grade is derived, so the check above returns first.
 *
 * A published GRADE decides the course whatever else is true of it, so it is
 * plannable - as a locked row that costs nothing because it is already earned.
 * A published I or W is not a grade and does not: it is the first case above.
 */
interface Excluded {
  basis: "out" | "zero" | "unknown";
  why: string;
}

function unplannable(ev: Evaluation): Excluded | null {
  if (isIncomplete(ev.grade)) {
    return { basis: "out", why: ev.grade === "W" ? "withdrawn" : "incomplete" };
  }
  if (ev.grade !== null) return null;
  if (isDebarred(ev)) {
    return { basis: "zero", why: `attendance below ${ATTENDANCE_CONDONE}%` };
  }
  if (ev.eseMax === 0 && (!ev.assessed || ev.cieFloor)) {
    if (!ev.assessed) {
      return { basis: "unknown", why: "no exam to aim at, and no internals marked yet" };
    }
    if (ev.cieIncomplete && ev.cieUnmarked) {
      return {
        basis: "unknown",
        why: "no exam to aim at, and the internal is short of marks and attendance",
      };
    }
    return {
      basis: "unknown",
      why: ev.cieIncomplete
        ? "no exam to aim at, and attendance is not recorded"
        : "no exam to aim at, and not every internal mark is in",
    };
  }
  return null;
}

/**
 * Cheapest route to a target SGPA: which subject to push, and how far.
 *
 * The target and the route are two halves of ONE piece of arithmetic, so they
 * divide by one denominator: every credit registered this semester bar the
 * withdrawn and incomplete ones, which is what `summarise` reports and what
 * `requiredSgpaForCgpa` was handed. Courses the route cannot move stay in that
 * denominator and contribute whatever they are worth -
 *
 *     sgpa = (fixedPoints + routePoints) / (fixedCredits + routeCredits)
 *
 * - so the route is solved for `target * credits - fixedPoints`, not for
 * `target * routeCredits`, and `fixedPoints` is taken at its FLOOR, which is
 * zero either way: a debarred course's is a known zero, and an unpriced
 * internal's is the bottom of a range. That is why `reachable` can be false
 * while `conditional` is true - the route is everything the priced courses can
 * give and it still does not cover the target on its own, so whoever renders
 * it has to say what the rest is waiting on.
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
 * `reason` names every course kept out of the route and says which of the
 * three things happened to it, because leaving a course out of the route and
 * leaving it out of the arithmetic are no longer the same sentence.
 */
export function planForSgpa(courses: Course[], targetSgpa: number): SgpaPlan {
  const plannable: Course[] = [];
  const notes: string[] = [];
  const unpriced: string[] = [];
  // The denominator, and the one term of the numerator the route does not
  // supply. `fixedBest` is what the unpriced courses could still add at their
  // own ceiling; their floor is taken as zero, which asks the route for more
  // than it may need rather than for less.
  let totalCredits = 0;
  let fixedBest = 0;

  for (const course of courses) {
    const ev = evaluate(course);
    const label = course.code || course.name || "?";
    const excluded = unplannable(ev);
    if (excluded === null) {
      plannable.push(course);
      totalCredits += ev.credits;
      continue;
    }
    if (excluded.basis === "out") {
      notes.push(`${label} left out: ${excluded.why}`);
      continue;
    }
    totalCredits += ev.credits;
    if (excluded.basis === "zero") {
      notes.push(`${label} counted at zero: ${excluded.why}`);
      continue;
    }
    unpriced.push(label);
    fixedBest += GRADE_POINTS[ev.maxPossibleGrade] * ev.credits;
    notes.push(`${label} not priced: ${excluded.why}`);
  }

  /** Carry the exclusions alongside whatever else there is to report. */
  const note = (reason?: string) => [reason, ...notes].filter(Boolean).join("; ") || undefined;
  const open = unpriced.length > 0 ? { unpriced } : {};

  if (totalCredits <= 0) {
    // Not "no credits" when the courses were excluded rather than absent -
    // that would name the wrong problem.
    return { reachable: false, plan: [], reason: note() ?? "no credits" };
  }

  // What the route must deliver on its own, and the least it could get away
  // with if every unpriced course reached its own ceiling. The first is what
  // the route is built for; the second only decides whether the target is out
  // of reach at every end.
  const neededPoints = targetSgpa * totalCredits;
  const neededAtBest = neededPoints - fixedBest;

  const ladders: CourseOption[][] = [];
  const labels: string[] = [];
  let current = 0;

  for (const course of plannable) {
    const options = courseOptions(course);
    const label = course.code || course.name || "?";
    if (options.length === 0) {
      return {
        reachable: false, plan: [], credits: totalCredits, ...open,
        reason: note(`${label} cannot be passed`),
      };
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
  const maxSgpa = round((ceiling + fixedBest) / totalCredits, 3);

  if (neededAtBest > ceiling + 1e-9) {
    return {
      reachable: false, plan: [], credits: totalCredits, maxSgpa, ...open,
      reason: note("target is above the best still available"),
    };
  }

  // Always chase the whole requirement, never the discounted one. Where the
  // route cannot carry it alone the greedy simply runs out of rungs and stops
  // at `ceiling`, which is the honest thing to show: the most the courses a
  // student can act on are worth, with the shortfall named as depending on the
  // unpriced ones. Solving for the discount instead would quote a cheaper
  // route that only works if those courses land at their best.
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
      locked: pick.locked, eseMax: pick.eseMax, cieUnknown: pick.cieUnknown,
    };
  });
  plan.sort((a, b) => b.ese - a.ese);

  const reachable = current >= neededPoints - 1e-9;
  return {
    reachable,
    // The gate above has already ruled out "short at every end", so a route
    // that cannot carry the target on its own is one the unpriced courses
    // could still finish.
    ...(reachable ? {} : { conditional: true }),
    ...open,
    sgpa: round(current / totalCredits, 3),
    target: targetSgpa,
    credits: totalCredits,
    plan,
    maxSgpa,
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
