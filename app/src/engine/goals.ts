import {
  ATTENDANCE_CONDONE, GRADE_BANDS, GRADE_POINTS, TOTAL_PASS_MARK,
} from "./constants";
import { specFor } from "./cie";
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
 * semesters are named in `CgpaResult.unconfirmed` with basis `earned` so the
 * History screen can ask for the real figure instead.
 *
 * Where NEITHER total is known this yields 0, and a semester weighing zero is
 * not in the CGPA at all - not a small error in the divisor but an average
 * over a different set of semesters. No figure is invented to fill the gap:
 * substituting a guessed credit load is exactly the kind of prediction from
 * missing data this engine exists to refuse. It is reported instead, with
 * basis `none`, and every surface that prints the CGPA has to say so.
 */
export function historyCredits(entry: SemesterHistory): number {
  return entry.creditsRegistered ?? entry.creditsEarned ?? 0;
}

/**
 * What a semester is weighed by when the registered total is missing.
 *
 *   - `earned` - `creditsEarned` stands in. The semester is still IN the CGPA
 *     and still moves it; the divisor is merely too small wherever there is a
 *     backlog, so the figure reads slightly high.
 *   - `none` - neither total is known, `historyCredits` yields 0, and the
 *     semester is NOT IN THE CGPA AT ALL. Its SGPA contributes nothing and its
 *     credits contribute nothing.
 *
 * Two facts, not one, and the gap between them is the gap between a number
 * that is a little off and a number computed over a different set of
 * semesters. They were a single `string[]` until this split, and every screen
 * described all of them with the sentence that is only true of `earned`.
 */
export type UnconfirmedBasis = "earned" | "none";

export interface UnconfirmedSemester {
  name: string;
  basis: UnconfirmedBasis;
}

/**
 * Semesters whose CGPA weight is not the registered total KTU uses.
 *
 * Both states are a figure the student should be asked for, and only `earned`
 * is a fallback - `none` is an omission. `historyCredits` is the function that
 * decides which, so this reads the same two fields in the same order rather
 * than deciding it a second way alongside it.
 */
export function unconfirmedSemesters(
  history: Record<string, SemesterHistory>,
): UnconfirmedSemester[] {
  return Object.entries(history)
    .filter(([, v]) => v.creditsRegistered == null)
    .map(([name, v]): UnconfirmedSemester => ({
      name,
      basis: v.creditsEarned == null ? "none" : "earned",
    }));
}

/** The names alone, optionally of one basis, for a screen listing them. */
export const unconfirmedNames = (
  rows: UnconfirmedSemester[], basis?: UnconfirmedBasis,
): string[] => rows.filter((r) => basis === undefined || r.basis === basis).map((r) => r.name);

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
  /**
   * True when the answer is "not enough information", not "not achievable".
   *
   * `possible: false` was carrying both, and a screen cannot tell them apart
   * from a boolean. A student on their first run, with no subjects entered
   * yet, was told in red that their target was OUT OF REACH - which is false
   * despair produced by an empty form.
   */
  insufficient?: boolean;
  /** The horizon `required` is an average over. */
  horizon: GoalHorizon;
  /**
   * Past semesters without a registered credit total, exactly as in
   * `CgpaResult`, and split by what stood in for it. Non-empty means this
   * requirement was solved against a best-effort CGPA and the screen should
   * say so - and say WHICH, because a `none` semester is not weighed by
   * anything at all.
   */
  unconfirmed: UnconfirmedSemester[];
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
      required: null, possible: false, insufficient: true, horizon, unconfirmed,
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
 * and a floor of 13.4, the floor prices every letter impossible and
 * `courseOptions` returns nothing at all - so the plan writes off as a
 * certain zero a lab whose unmarked components and attendance marks can still
 * carry it to a pass at 10 of 25.
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
  /**
   * The grade `ese` marks actually secure with no further attendance marks
   * earned - and none assumed where none is recorded.
   *
   * A bound on the ATTENDANCE axis alone. An unmarked component still counts
   * its whole weight here, exactly as `cieCeiling` counts it - see `heldCie`
   * for why the two axes are treated differently and why that is not
   * arbitrary.
   *
   * Equal to `grade` on most rows, and it can fall either side of it:
   *
   *   - BELOW, where `ese` was priced off `Evaluation.cieCeiling` and buys
   *     `grade` only once the internal reaches it. Score exactly `ese`, change
   *     nothing else, and this lower letter is what comes back. Those rows are
   *     the ones `SgpaPlan.bound` names.
   *   - ABOVE, where the 40% ESE minimum set the price of a cheap rung and the
   *     mark it forces overshoots the band it was bought for - a P quoted at 16
   *     of 40 against a CIE of 49.21 lands a C+. Not a defect and not a
   *     warning; the route simply delivers more than it charged for.
   *
   * Per row rather than per plan because the two ends of the internal often
   * produce the SAME requirement - a 40% ESE minimum binding at both ends costs
   * a rising CIE nothing - and a row like that is not bound at all.
   */
  secured: Grade;
}

export interface SgpaPlan {
  /**
   * Score every `ese` in `plan` and the target is met, whatever the attendance
   * turns out to be. Decided against `PlanRow.secured` rather than against
   * `PlanRow.grade`.
   *
   * A guarantee against TWO of the three things a plan does not know - the
   * attendance marks still outstanding, recorded or unrecorded, and the
   * `unpriced` courses - and NOT against the third. An unmarked component is
   * still counted at its whole weight (see `heldCie`), so a student whose
   * unwritten series exam comes in low can still miss. That axis is open and
   * undisclosed by this field; nothing here marks it.
   *
   * The two differ because `courseOptions` prices its ladder off
   * `Evaluation.cieCeiling` - deliberately, because pricing off the CIE a
   * course has today calls letters impossible that its own outstanding marks
   * could still buy, and a part-marked lab then takes the whole semester's
   * plan down with it. The cost of that choice is that a quoted mark is the
   * LEAST its grade could cost, so summing the quoted grades would promise a
   * total the quoted marks do not secure. Measured over 20000 randomised
   * course sets with every component marked and every attendance recorded -
   * so nothing is `cieFloor` and nothing is `unpriced` - 5379 routes summed to
   * the target at the ceiling and only 2840 of them still did once the
   * unearned attendance marks came back out. This field is the second number.
   *
   * It is NOT a promise that no better route exists: 2409 of those 2539 could
   * have been carried at today's CIE by a harder route, which the greedy does
   * not look for because it stops at the first route that covers the target.
   * So `reachable: false` here means "this route does not guarantee it", not
   * "nothing does" - `maxSgpa` is the field that answers the second question.
   *
   * Also a guarantee against the `unpriced` range, and again the floor of it:
   * where the answer turns on a course the plan has no mark to move, this is
   * false and `conditional` is true.
   */
  reachable: boolean;
  /**
   * The route does not carry the target on what today's marks guarantee, but
   * the target is still open. Never true alongside `reachable`, and never true
   * when the target is out of reach at every end.
   *
   * Two causes, each named by its own list, and a plan can carry both:
   * `unpriced` - courses the route cannot price at all, whose grade points
   * could still cover the rest - and `bound`, courses whose quoted mark only
   * buys its quoted grade once the internal reaches its ceiling. Whoever
   * renders this has to read which list is non-empty; the two are different
   * advice. An unpriced shortfall is out of the student's hands this week, a
   * bound one is the attendance and the outstanding components.
   *
   * The FLAG is the discriminator, not the lists. Over 5379 routes on a
   * population with every component marked and every attendance recorded: a
   * row merely priced off a movable CIE (`PlanRow.cieUnknown`) is present on
   * 3825 and 1286 of those reach the target anyway; a row that is actually
   * `bound` is present on 3204 and 665 of those do; the flag fires on 2539 and
   * every one of them misses. A caveat that is wrong a fifth of the time it
   * appears trains a student to skip the one that is not. Every figure here is
   * re-derived and asserted in `core.test.ts` so it cannot rot silently.
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
   * The SGPA this route yields if every quoted grade lands: every `unpriced`
   * course scoring nothing, and every internal reaching `cieCeiling`. The
   * figure the rows literally add up to.
   */
  sgpa?: number;
  /**
   * The SGPA the same route yields with every quoted mark scored and no
   * further attendance earned. `PlanRow.secured` summed instead of
   * `PlanRow.grade`, and the figure `reachable` is decided against.
   *
   * Below `sgpa` wherever `bound` is non-empty, and it can sit slightly ABOVE
   * it where a row over-delivers (see `PlanRow.secured`). Whoever tells a
   * student what a route gets them should quote this one: it is the number
   * that survives them doing exactly what the plan says and nothing else.
   */
  sgpaGuaranteed?: number;
  /**
   * Courses in the route whose quoted mark buys its quoted grade only if the
   * internal reaches `Evaluation.cieCeiling` - `PlanRow.secured` below
   * `PlanRow.grade`. Listed whether or not the shortfall turns on them, so a
   * screen can mark the rows; `conditional` is the flag that says it matters.
   */
  bound?: string[];
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
 * What the plan does with a course there is no useful exam mark to ask for, or
 * null where there is.
 *
 * `basis` is the half that matters, because it decides the DENOMINATOR. An
 * SGPA is points over credits, and this is the only place that says which
 * credits those are. It has to agree with `summarise`, because the target
 * being planned for was solved over `summarise`'s total.
 *
 *   - `out` - withdrawn or incomplete. There is no exam of theirs left this
 *     semester and KTU keeps the course out of the SGPA entirely, denominator
 *     included, which is exactly what `summarise` does with it.
 *   - `zero` - a certain F. A real grade with a real grade point of 0 over
 *     credits that stay registered (R 9.1 gives F, Ab and FE a grade point of
 *     0 and divides by the total credits REGISTERED in the semester), so its
 *     credits stay in the denominator and its contribution is a known zero,
 *     and it never appears as a row - naming a mark to aim at would be
 *     instructing a student to spend the one thing they have, study time, on
 *     a paper that cannot change their result. Two different facts land here:
 *     a DEBARRED student will not be admitted to the ESE at all, and a course
 *     whose best remaining total is under the pass mark has an exam left to
 *     sit that cannot carry it. Both are certain from the branch condition
 *     rather than from a guess: the second reads `cieCeiling`, the top of the
 *     internal, so a full paper on top of it is the most the course can
 *     possibly score.
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
    return { basis: "zero", why: `debarred, attendance below ${ATTENDANCE_CONDONE}%` };
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
  if (!ev.needPassBest.possible) {
    // A pass is out of reach at the TOP of the internal, so every letter above
    // it is too and there is no rung left to sell. The 40% ESE minimum is
    // never what fails here - it is at most `eseMax`, so it is always payable
    // - which leaves the aggregate: `cieCeiling` plus a whole paper is the
    // most this course can score and it is still under the pass mark. An F
    // that follows from the arithmetic rather than from a forecast, so the
    // course is counted at a known zero like a debarred one, and the rest of
    // the semester still gets a route. Only a course with an exam reaches
    // here: an internal-only one is either caught above or already graded,
    // since `evaluate` derives its grade the moment the internal settles.
    return {
      basis: "zero",
      why: `unreachable, even full marks in the exam leave the total under ${TOTAL_PASS_MARK}`,
    };
  }
  return null;
}

/**
 * The CIE a course is certain of: every attendance mark not KNOWN to be earned
 * taken back out, and nothing else taken out.
 *
 * `cieCeiling` counts all `attMax` attendance marks whatever the current
 * percentage - deliberately, since those marks are the one part of an internal
 * a student can still walk in and earn, and `attBand` says how many classes it
 * takes. That is the right end to PRICE a ladder from and the wrong end to
 * promise a total against: the marks are not earned yet.
 *
 * Three inputs on the attendance axis, and the third is the one that has been
 * wrong once already:
 *
 *   - a recorded percentage in the top band -> `attMarks` is `attMax`, nothing
 *     is outstanding, and this equals `cieCeiling` on that axis.
 *   - a recorded percentage below it -> the difference comes off. Those marks
 *     are not unknown, they are known to be unearned.
 *   - NO percentage recorded -> the whole `attMax` comes off. The true figure
 *     is somewhere in `[0, attMax]` and a guarantee has to take the bottom of
 *     an interval, the same way `planForSgpa` takes an `unpriced` course's
 *     contribution at zero without claiming the course will score nothing.
 *
 * THAT LAST CASE DOES NOT CONTRADICT TASK 3, and the distinction is the whole
 * point of this function. Task 3's rule is that an unrecorded attendance must
 * never be READ AS A SHORTAGE - it may not set `eligible: false`, may not enter
 * `lowAttendance`, may not debar, may not dock a displayed CIE. Those are
 * assertions ABOUT THE STUDENT, and inventing one from a blank field is a lie.
 * This is not an assertion about the student; it is the refusal to PROMISE a
 * mark nobody has evidence for. Crediting the marks instead made the app
 * strictly more confident about a student it knew strictly less about: at
 * `6b761ae`, TH 40/60 with `s1 30/50 s2 30/50 other 6/10` planned to a B+ at
 * 49 of 60 and called it reachable with the attendance field blank, and called
 * the same route UNREACHABLE the moment a real 62% was typed in. Deleting data
 * must never buy a stronger promise.
 *
 * The COMPONENT axis is different and stays at the ceiling: an unmarked series
 * exam keeps its whole weight the way `cieCeiling` counts it. Absence of a mark
 * there is not a zero either, and taking that half off too is the pessimism
 * three fix rounds went into removing - measurably, it flips three of this
 * file's own committed cases from a route to no route at all. The asymmetry is
 * real rather than convenient: an outstanding attendance mark has a KNOWN worst
 * case of zero that the student can still act on, while an unwritten series
 * exam scored at zero is a prediction about a paper that has not been sat. That
 * axis is a disclosed open item, not a claim this function makes.
 *
 * Never below `cie`: on a published internal total both ends are that total and
 * its attendance marks are already inside it, so nothing is outstanding however
 * the percentage reads.
 */
function heldCie(course: Course, ev: Evaluation): number {
  const { attMax } = specFor(course.type);
  const unearned = ev.attMarks === null ? attMax : Math.max(0, attMax - ev.attMarks);
  return Math.max(ev.cie, round(ev.cieCeiling - unearned, 2));
}

/**
 * The grade `ese` marks secure without the outstanding attendance marks.
 *
 * `courseOptions` prices its ladder off `Evaluation.cieCeiling`, so a rung's
 * mark is the LEAST that grade could cost. This is the other end of the same
 * question: hand it the mark and it walks the ladder priced off `heldCie`
 * instead, which is what the student ends up with if they score exactly that
 * mark and attend nothing further. F where the mark buys no letter at all.
 *
 * Scoped to attendance, like `heldCie`: an unmarked component still counts at
 * its whole weight, so this is not a claim about what the internal will be.
 *
 * `requiredEse` is non-decreasing in the band minimum, so the highest letter
 * the mark pays for is the answer and there is no need to check the rest.
 */
function securedGrade(course: Course, ev: Evaluation, ese: number): Grade {
  const cie = heldCie(course, ev);
  for (const [letter] of GRADE_BANDS) {
    const need = requiredEse(cie, letter, ev.eseMax);
    if (need.possible && need.value <= ese + 1e-9) return letter;
  }
  return "F";
}

/**
 * The route to a target SGPA: which subject to push, and how far.
 *
 * The cheapest one where the priced courses can carry the target - see the
 * greedy below. Where they cannot, the greedy runs out of rungs and what comes
 * back is the most they can give, with `conditional` set; "cheapest" is the
 * wrong word for that plan, and the Drawer titles it differently wherever it
 * has rows to show.
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
 * `reason` names every course kept out of the route and says what happened to
 * it, because leaving a course out of the route and leaving it out of the
 * arithmetic are no longer the same sentence. No course kept out ends the
 * plan: one subject a student cannot pass is a fact about that subject, and
 * withholding the route for every other subject over it helps nobody.
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
  const evs: Array<{ course: Course; ev: Evaluation }> = [];
  let current = 0;

  for (const course of plannable) {
    const options = courseOptions(course);
    const label = course.code || course.name || "?";
    if (options.length === 0) {
      // Unreachable by construction: `courseOptions` returns nothing only when
      // no letter is payable, and P is the cheapest letter there is, so an
      // empty ladder is exactly `!needPassBest.possible` - which `unplannable`
      // has already taken out above. Kept anyway, and kept as an EXCLUSION
      // rather than as a return, because the failure it guards against is one
      // course silently deciding the whole semester: this branch used to end
      // the plan with "<code> cannot be passed", so a single unpassable lab
      // left every healthy course beside it with no route at all. Whatever
      // else goes wrong here, that must not.
      notes.push(`${label} counted at zero: no grade is still on offer`);
      continue;
    }
    ladders.push(options);
    labels.push(label);
    evs.push({ course, ev: evaluate(course) });
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
    // A locked row is a published grade: there is no mark to score and
    // nothing left to secure it against.
    const from = evs[i]!;
    const secured = pick.locked ? pick.grade : securedGrade(from.course, from.ev, pick.ese);
    return {
      code: labels[i]!, grade: pick.grade, ese: pick.ese, credits: pick.credits,
      locked: pick.locked, eseMax: pick.eseMax, cieUnknown: pick.cieUnknown, secured,
    };
  });
  plan.sort((a, b) => b.ese - a.ese);

  // What the route is worth if the student scores every quoted mark and
  // nothing else about any internal moves. `current` is the other end: the
  // same route with every internal reaching its ceiling.
  const held = plan.reduce((sum, row) => sum + GRADE_POINTS[row.secured] * row.credits, 0);
  // Compared by GRADE POINT, not by letter. `secured` can come out ABOVE the
  // quoted grade: where the 40% ESE minimum sets the price of a cheap rung, the
  // mark it forces can overshoot the band it was bought for - measured, a P
  // quoted at 16 of 40 against a CIE of 49.21 lands a C+. That row is
  // over-delivering, not bound. Measured on the clean population: 932 of its
  // 5379 routes carry 1021 such rows, both pinned in `core.test.ts` so the
  // figure fails rather than misleads if it drifts. Naming them would put a
  // warning on good news.
  const bound = plan
    .filter((row) => GRADE_POINTS[row.secured] < GRADE_POINTS[row.grade])
    .map((row) => row.code);

  const reachable = held >= neededPoints - 1e-9;
  return {
    reachable,
    // The gate above has already ruled out "short at every end", so a route
    // that does not carry the target on what today's marks guarantee is one
    // that the unpriced courses or the outstanding internals could still
    // finish. Which of the two is named by the lists.
    ...(reachable ? {} : { conditional: true }),
    ...open,
    ...(bound.length > 0 ? { bound } : {}),
    sgpa: round(current / totalCredits, 3),
    sgpaGuaranteed: round(held / totalCredits, 3),
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
   * Semesters with no registered credit total, split by what stood in for it.
   * Non-empty means this CGPA is a best effort rather than the figure KTU
   * would print, and the student has a number to supply. A `none` entry means
   * more than that: `credits` does not include that semester and `cgpa` was
   * computed without it.
   */
  unconfirmed: UnconfirmedSemester[];
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
