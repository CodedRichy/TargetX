import { GRADE_BANDS, GRADE_POINTS } from "./constants";
import { evaluate } from "./evaluate";
import { requiredEse } from "./grade";
import type { Course, Grade, SemesterHistory } from "./types";
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

export interface RequiredSgpa {
  required: number | null;
  possible: boolean;
  ceiling?: number;
  slack?: boolean;
  reason?: string;
}

/**
 * "I want an 8.0 CGPA" -> what this semester has to deliver.
 *
 * Solves target = (pastPoints + sgpa * credits) / (pastCredits + credits) for
 * sgpa. Reports impossibility honestly: past semesters are frozen, so a target
 * can be arithmetically out of reach no matter what happens now, and telling a
 * student to chase it anyway would be the cruel kind of wrong.
 */
export function requiredSgpaForCgpa(
  targetCgpa: number,
  history: Record<string, SemesterHistory>,
  semesterCredits: number,
): RequiredSgpa {
  const past = Object.values(history).map((v) => [historyCredits(v), v.sgpa || 0] as const);
  const pastCredits = past.reduce((sum, [c]) => sum + c, 0);
  const pastPoints = past.reduce((sum, [c, sgpa]) => sum + sgpa * c, 0);
  const credits = toFloat(semesterCredits, 0);

  if (credits <= 0) {
    return { required: null, possible: false, reason: "no credits registered this semester" };
  }

  const needed = round((targetCgpa * (pastCredits + credits) - pastPoints) / credits, 3);

  if (needed > 10) {
    // Even straight S grades cannot get there.
    const ceiling = round((pastPoints + 10 * credits) / (pastCredits + credits), 3);
    return {
      required: needed,
      possible: false,
      ceiling,
      reason: `even all-S this semester tops out at ${ceiling.toFixed(2)}`,
    };
  }
  if (needed <= 0) {
    return { required: 0, possible: true, slack: true, reason: "already secured by past semesters" };
  }
  return { required: needed, possible: true, slack: false };
}

export interface CourseOption {
  grade: Grade;
  gp: number;
  ese: number;
  locked: boolean;
  credits: number;
  eseMax: number;
}

/**
 * Every grade still reachable in a course, with what it costs.
 *
 * Cost is the ESE mark required - the only currency a student actually spends.
 * Grades already impossible are omitted rather than shown greyed out, because
 * a plan built on them is not a plan.
 */
export function courseOptions(course: Course): CourseOption[] {
  const ev = evaluate(course);
  if (ev.grade !== null) {
    // Already decided by a published grade.
    return [{
      grade: ev.grade, gp: GRADE_POINTS[ev.grade], ese: ev.ese ?? 0,
      locked: true, credits: ev.credits, eseMax: ev.eseMax,
    }];
  }

  const options: CourseOption[] = [];
  for (const [letter, , gp] of GRADE_BANDS) {
    const need = requiredEse(ev.cie, letter, ev.eseMax);
    if (need.possible) {
      options.push({
        grade: letter, gp, ese: need.value,
        locked: false, credits: ev.credits, eseMax: ev.eseMax,
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
}

export interface SgpaPlan {
  reachable: boolean;
  sgpa?: number;
  target?: number;
  credits?: number;
  plan: PlanRow[];
  maxSgpa?: number;
  reason?: string;
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
 */
export function planForSgpa(courses: Course[], targetSgpa: number): SgpaPlan {
  const totalCredits = courses.reduce((sum, c) => sum + toFloat(c.credits, 0), 0);
  if (totalCredits <= 0) return { reachable: false, reason: "no credits", plan: [] };

  const neededPoints = targetSgpa * totalCredits;
  const ladders: CourseOption[][] = [];
  const labels: string[] = [];
  let current = 0;

  for (const course of courses) {
    const options = courseOptions(course);
    const label = course.code || course.name || "?";
    if (options.length === 0) {
      return { reachable: false, plan: [], reason: `${label} cannot be passed` };
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
      reason: "target is above the best still available",
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
      code: labels[i]!, grade: pick.grade, ese: pick.ese,
      credits: pick.credits, locked: pick.locked,
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
  const unconfirmed = rows
    .filter(([, v]) => v.creditsRegistered == null)
    .map(([name]) => name);
  const credits = rows.reduce((sum, [, v]) => sum + historyCredits(v), 0);
  if (credits <= 0) return { cgpa: 0, credits: 0, percent: 0, unconfirmed };
  const weighted = rows.reduce((sum, [, v]) => sum + (v.sgpa || 0) * historyCredits(v), 0);
  const cgpa = round(weighted / credits, 3);
  // 2024 scheme: Percentage = 10 x CGPA. No (10 x CGPA) - 2.5 legacy fudge.
  return { cgpa, credits, percent: round(cgpa * 10, 2), unconfirmed };
}
