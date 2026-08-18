import {
  ATTENDANCE_CONDONE, ATTENDANCE_MIN, GRADE_MIN, GRADE_POINTS, TOTAL_PASS_MARK,
} from "./constants";
import {
  attendanceMarks, attendancePlan, effectiveAttendance, nextAttendanceBand,
} from "./attendance";
import { computeCie, eseCutoff, specFor } from "./cie";
import { gradeForTotal, normaliseGrade, requiredEse } from "./grade";
import type { Course, Evaluation, Grade, Letter, MarkInput, Status } from "./types";
import { clamp, round, toFloat, toOptionalFloat } from "./util";

/** Full per-course verdict: CIE, projected total, grade, targets, flags. */
export function evaluate(course: Course): Evaluation {
  const spec = specFor(course.type);
  const eseMax = spec.eseMax;
  const cutoff = eseCutoff(eseMax);

  let ese = toOptionalFloat(course.ese);
  if (ese !== null) ese = clamp(ese, 0, eseMax);

  // Duty leave changes the figure, and a blank field is not a full attendance
  // record - both are settled inside `effectiveAttendance`, which the CIE is
  // then billed against so eligibility and marks can never disagree.
  const plan = attendancePlan(course.attended, course.held, course.dl ?? 0);
  const attendance = effectiveAttendance(course, plan);
  // Unknown stays unknown: `null` here must never read as "below 75%" (that
  // is `false`) or "fine" (`true`) to any consumer.
  const eligible = attendance === null ? null : attendance >= ATTENDANCE_MIN;
  const cie = computeCie(course, attendance);

  // A grade published by the university is final. It outranks anything this
  // app could derive, and it arrives WITHOUT an ESE mark - portals publish the
  // letter, never the exam score. Requiring an ESE before trusting it would
  // leave completed semesters permanently "unconfirmed".
  const publishedGrade = normaliseGrade(course.portal_grade);

  let total: number | null = null;
  let grade: Grade | null = null;
  let failedReason = "";

  if (publishedGrade !== null) {
    grade = publishedGrade;
    if (ese !== null) total = round(cie + ese, 2);
  } else if (ese !== null || eseMax === 0) {
    total = round(cie + (ese ?? 0), 2);
    if (eseMax && ese !== null && ese < cutoff) {
      grade = "F";
      failedReason = `ESE ${ese.toFixed(0)} < cutoff ${cutoff}`;
    } else if (total < TOTAL_PASS_MARK) {
      grade = "F";
      failedReason = `Total ${total.toFixed(0)} < ${TOTAL_PASS_MARK}`;
    } else {
      grade = gradeForTotal(total);
    }
  }

  let target = (course.target ?? "B+") as Letter;
  if (!(target in GRADE_MIN)) target = "B+";

  // Has this course been assessed at all yet? With no series marks and no
  // published internal, a CIE of 0 is an absence of data, not a score of zero
  // - and reporting "you need 50/25, impossible" for a lab nobody has graded
  // yet would be a straight falsehood.
  const assessed =
    publishedGrade !== null ||
    toOptionalFloat(course.cie_override) !== null ||
    spec.components.some(
      ({ key }) => toOptionalFloat((course as Record<string, MarkInput>)[key]) !== null,
    );

  return {
    cie,
    cieMax: spec.cieMax,
    eseMax,
    ese,
    eseCutoff: cutoff,
    total,
    grade,
    failedReason,
    attendance,
    eligible,
    assessed,
    plan,
    attMarks: attendanceMarks(attendance),
    attBand: nextAttendanceBand(course.attended, course.held, course.dl ?? 0),
    credits: clamp(toFloat(course.credits, 0), 0, 20),
    needPass: requiredEse(cie, "P", eseMax),
    needTarget: requiredEse(cie, target, eseMax),
    target,
    maxPossibleGrade: gradeForTotal(cie + eseMax),
  };
}

/** Single verdict per subject. Worst condition wins. */
export function statusFor(ev: Evaluation): Status {
  if (!ev.assessed && ev.total === null) {
    // No internal assessment published yet. Attendance is still real and still
    // worth flagging, but nothing can be said about the marks - and nothing
    // can be said about attendance itself when that field is also blank.
    if (ev.attendance !== null && ev.attendance < ATTENDANCE_CONDONE) return "DEBARRED";
    if (ev.eligible === false) return "SHORTAGE";
    return "PENDING";
  }
  if (!ev.needPass.possible) return "UNREACHABLE";
  if (ev.grade === "F") return "FAILED";
  if (ev.attendance !== null && ev.attendance < ATTENDANCE_CONDONE) return "DEBARRED";
  if (ev.eligible === false) return "SHORTAGE";
  if (ev.eseMax && ev.needPass.value / ev.eseMax > 0.7) return "TIGHT";
  return "SAFE";
}

/** pairs = [credits, gradePoint][] */
export function sgpa(pairs: Array<[number, number]>): number {
  const credits = pairs.reduce((sum, [c]) => sum + c, 0);
  if (credits <= 0) return 0;
  return round(pairs.reduce((sum, [c, gp]) => sum + c * gp, 0) / credits, 3);
}

export interface Summary {
  pending: number;
  assessed: number;
  sgpaConfirmed: number;
  sgpaProjected: number;
  credits: number;
  creditsConfirmed: number;
  percentConfirmed: number;
  percentProjected: number;
  atRisk: string[];
  impossible: string[];
  lowAttendance: string[];
}

/** Whole-semester rollup. Confirmed and projected are kept strictly separate. */
export function summarise(courses: Course[]): Summary {
  const confirmed: Array<[number, number]> = [];
  const projected: Array<[number, number]> = [];
  const atRisk: string[] = [];
  const impossible: string[] = [];
  const lowAttendance: string[] = [];
  let totalCredits = 0;
  let pending = 0;

  for (const course of courses) {
    const ev = evaluate(course);
    const label = course.code || course.name || "?";
    totalCredits += ev.credits;

    // An unassessed course contributes nothing but its attendance. Folding a
    // zero CIE into a projection would invent a bad prediction out of missing
    // data, which is the failure mode this app exists to avoid.
    if (ev.grade === null && !ev.assessed) {
      pending += 1;
      // Only a known shortage counts as a warning - an unknown attendance
      // field is not evidence of one.
      if (ev.eligible === false) lowAttendance.push(label);
      continue;
    }

    if (ev.grade !== null) {
      confirmed.push([ev.credits, GRADE_POINTS[ev.grade]]);
      projected.push([ev.credits, GRADE_POINTS[ev.grade]]);
    } else if (ev.needTarget.possible) {
      // Not yet written: project the target if reachable, else the best grade
      // still mathematically on the table.
      projected.push([ev.credits, GRADE_POINTS[ev.target]]);
    } else {
      projected.push([ev.credits, GRADE_POINTS[ev.maxPossibleGrade]]);
    }

    if (!ev.needPass.possible && ev.grade === null) {
      // A published grade settles the matter; do not warn that a course
      // already on the record is unreachable.
      impossible.push(label);
    } else if (ev.grade === "F") {
      atRisk.push(label);
    }
    if (ev.eligible === false) lowAttendance.push(label);
  }

  return {
    pending,
    assessed: projected.length,
    sgpaConfirmed: sgpa(confirmed),
    sgpaProjected: sgpa(projected),
    credits: totalCredits,
    creditsConfirmed: confirmed.reduce((sum, [c]) => sum + c, 0),
    percentConfirmed: round(sgpa(confirmed) * 10, 2),
    percentProjected: round(sgpa(projected) * 10, 2),
    atRisk,
    impossible,
    lowAttendance,
  };
}
