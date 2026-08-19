import {
  ATTENDANCE_CONDONE, ATTENDANCE_MIN, GRADE_MIN, GRADE_POINTS, TOTAL_PASS_MARK,
} from "./constants";
import {
  attendanceMarks, attendancePlan, effectiveAttendance, nextAttendanceBand,
} from "./attendance";
import { computeCie, eseCutoff, specFor } from "./cie";
import { gradeForTotal, isIncomplete, normaliseGrade, requiredEse } from "./grade";
import type {
  Course, Evaluation, Grade, Incomplete, Letter, MarkInput, Status,
} from "./types";
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
  // The internal is short of one component and nobody knows by how much.
  // `computeCie` could only sum what is marked, so `cie` is a lower bound
  // missing up to `spec.attMax` marks - enough to move a grade band. A
  // published internal total is not affected: it already contains the
  // college's own attendance marks, so an unknown percentage costs it
  // nothing.
  const published = toOptionalFloat(course.cie_override);
  const cieIncomplete = published === null && attendance === null && spec.attMax > 0;

  // A grade published by the university is final. It outranks anything this
  // app could derive, and it arrives WITHOUT an ESE mark - portals publish the
  // letter, never the exam score. Requiring an ESE before trusting it would
  // leave completed semesters permanently "unconfirmed".
  const publishedGrade = normaliseGrade(course.portal_grade);

  // Has this course been assessed at all yet? With no series marks and no
  // published internal, a nonzero CIE can still be pure attendance marks
  // (R 7.5.ii) - and reporting a grade for a lab nobody has graded yet would
  // be a straight falsehood. Computed here, ahead of the grading branch below,
  // because an eseMax === 0 course with no data must not fall through to it.
  const assessed =
    publishedGrade !== null ||
    published !== null ||
    spec.components.some(
      ({ key }) => toOptionalFloat((course as Record<string, MarkInput>)[key]) !== null,
    );

  let total: number | null = null;
  let grade: Grade | Incomplete | null = null;
  let failedReason = "";

  if (publishedGrade !== null) {
    grade = publishedGrade;
    // An I or a W has no result behind it, so there is no total to state -
    // adding a CIE to an exam mark for a course that was never completed
    // would manufacture one.
    if (!isIncomplete(publishedGrade) && ese !== null) total = round(cie + ese, 2);
  } else if (!cieIncomplete && (ese !== null || (eseMax === 0 && assessed))) {
    // `cieIncomplete` blocks this branch and only this one: a grade derived
    // from a CIE that is short of its attendance component would state a band
    // the data cannot support. Absence is not zero, so the course waits at
    // `grade: null` - the same place a course whose exam is unwritten waits -
    // until the attendance figure arrives. The published-grade branch above is
    // untouched: what the university printed outranks anything derived here.
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
    cieIncomplete,
    plan,
    attMarks: attendanceMarks(attendance, spec.attMax),
    attBand: nextAttendanceBand(course.attended, course.held, course.dl ?? 0),
    credits: clamp(toFloat(course.credits, 0), 0, 20),
    needPass: requiredEse(cie, "P", eseMax),
    needTarget: requiredEse(cie, target, eseMax),
    target,
    maxPossibleGrade: gradeForTotal(cie + eseMax),
  };
}

/**
 * Attendance known to be below the floor R 6.2 lets the Principal condone.
 *
 * Below 60% there is no appeal: the student cannot sit the ESE, so nothing
 * derived from a mark they will not be allowed to write is worth projecting.
 * Unknown attendance is `null` and is NOT a debarment - a blank field is
 * absence of evidence, and every consumer here tests the known case only.
 *
 * Says nothing about a published grade. A course the university has already
 * graded is decided whatever its attendance was, so callers that project or
 * plan check `grade === null` alongside this.
 */
export function isDebarred(ev: Evaluation): boolean {
  return ev.attendance !== null && ev.attendance < ATTENDANCE_CONDONE;
}

/** Single verdict per subject. Worst condition wins. */
export function statusFor(ev: Evaluation): Status {
  // Withdrawn or incomplete, and the university published it: the course is
  // neither passed nor failed nor waiting on a mark this semester. It comes
  // first because everything below asks about an exam this student will not
  // be sitting - including the attendance verdicts, which describe admission
  // to an exam that is no longer theirs to be admitted to.
  if (isIncomplete(ev.grade)) return "INCOMPLETE";
  if (ev.grade === null && ev.total === null && (!ev.assessed || ev.cieIncomplete)) {
    // Nothing to report yet, for one of two reasons: no internal assessment
    // has been published, or one has but its attendance component is unknown,
    // so the CIE is a lower bound and no grade may be derived from it
    // (`cieIncomplete`). Attendance is still real and still worth flagging,
    // but nothing can be said about the marks - and nothing can be said about
    // attendance itself when that field is also blank.
    if (isDebarred(ev)) return "DEBARRED";
    if (ev.eligible === false) return "SHORTAGE";
    return "PENDING";
  }
  // A published grade settles the matter; a projection built without an ESE
  // mark (portals never publish the exam score) is not grounds to call a
  // finished course unreachable.
  if (!ev.needPass.possible && ev.grade === null) return "UNREACHABLE";
  if (ev.grade === "F") return "FAILED";
  if (isDebarred(ev)) return "DEBARRED";
  if (ev.eligible === false) return "SHORTAGE";
  if (ev.grade === null && ev.eseMax && ev.needPass.value / ev.eseMax > 0.7) return "TIGHT";
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

    // Withdrawn or incomplete: KTU keeps the course out of the SGPA until it
    // is completed, denominator included. Its credits leave with it rather
    // than staying in `credits` the way a debarred course's do - `credits` is
    // what this semester is weighed by in the CGPA - live, through
    // `requiredSgpaForCgpa`, and again once the semester is archived - and
    // weighing it by a course that will never be graded here hands those
    // credits the semester's own average. (`planForSgpa` does not read this
    // total at all; it sums its own over the courses it can plan, which since
    // Task 4 excludes a debarred course as well as this one.)
    if (isIncomplete(ev.grade)) continue;

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

    // Debarred and ungraded: they will not be allowed to sit the ESE, so a
    // projected grade for this course would be a prediction about an exam
    // that will not happen. Its credits stay in `credits` - they are still
    // registered - but no grade point is invented for them.
    if (ev.grade === null && isDebarred(ev)) {
      lowAttendance.push(label);
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
