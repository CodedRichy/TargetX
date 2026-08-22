import {
  ATTENDANCE_CONDONE, ATTENDANCE_MIN, GRADE_MIN, GRADE_POINTS, TOTAL_PASS_MARK,
} from "./constants";
import {
  attendanceMarks, attendancePlan, effectiveAttendance, nextAttendanceBand,
} from "./attendance";
import { cieBounds, eseCutoff, specFor } from "./cie";
import {
  gradeForTotal, isIncomplete, normaliseGrade, requiredEse, requiredEseCell,
} from "./grade";
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
  const { cie, ceiling: cieCeiling } = cieBounds(course, attendance);
  const published = toOptionalFloat(course.cie_override);

  // Three questions about the same number, and they are not the same question.
  //
  // `cieIncomplete`: the attendance component cannot be priced, so `cie` is
  // short by up to `spec.attMax` marks - enough to move a band. A published
  // internal total is not affected: it already contains the college's own
  // attendance marks, so an unknown percentage costs it nothing.
  // (`spec.attMax > 0` is defensive rather than live: all six `COURSE_TYPES`
  // entries go through `withAttendance`, which pays the regulation's 5 marks.)
  const cieIncomplete = published === null && attendance === null && spec.attMax > 0;
  // `cieUnmarked`: a series exam or an assignment has no mark yet. Absence is
  // not zero on this axis either - an unwritten series is worth its whole
  // weight still, not nothing - so `cie` is short by that too.
  const cieUnmarked = published === null && spec.components.some(
    ({ key }) => toOptionalFloat((course as Record<string, MarkInput>)[key]) === null,
  );
  // `cieFloor`: either of the above, i.e. `cie` is a LOWER BOUND rather than
  // the internal as it stands today. This is the one the arithmetic keys on;
  // the two halves are kept apart only so a screen can name which field is
  // missing. It is not the same question as "can the CIE still rise": a fully
  // marked internal below 85% attendance is exactly today's mark and still
  // has attendance marks to earn, so `cieCeiling > cie` with this flag false.
  // Anything deciding whether a derived number is exact must compare the two
  // ends, not read this.
  const cieFloor = cieIncomplete || cieUnmarked;


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
  } else if (ese !== null || (eseMax === 0 && assessed)) {
    if (eseMax && ese !== null && ese < cutoff) {
      // The separate 40% ESE minimum, and it is the one verdict here that does
      // not touch the CIE: no internal mark, recorded or still to come, can
      // buy it off. So it stands even when the internal is a floor - refusing
      // to state it would drop a certain F out of `sgpaConfirmed` and leave
      // the confirmed average reading better than the truth. The TOTAL is
      // still withheld on a floor, because that number really is unknown.
      grade = "F";
      failedReason = `ESE ${ese.toFixed(0)} < cutoff ${cutoff}`;
      if (!cieFloor) total = round(cie + ese, 2);
    } else if (!cieFloor) {
      // Everything below reads the CIE, so a floor blocks all of it: a band
      // read off a sum that is short of a component is a band the data does
      // not support. Absence is not zero, so the course waits at
      // `grade: null` - the same place a course whose exam is unwritten waits
      // - until the missing figure arrives. The published-grade branch above
      // is untouched: what the university printed outranks anything derived.
      total = round(cie + (ese ?? 0), 2);
      if (total < TOTAL_PASS_MARK) {
        grade = "F";
        failedReason = `Total ${total.toFixed(0)} < ${TOTAL_PASS_MARK}`;
      } else {
        grade = gradeForTotal(total);
      }
    }
  }

  let target = (course.target ?? "B+") as Letter;
  if (!(target in GRADE_MIN)) target = "B+";

  return {
    cie,
    cieMax: spec.cieMax,
    cieCeiling,
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
    cieUnmarked,
    cieFloor,
    plan,
    attMarks: attendanceMarks(attendance, spec.attMax),
    attBand: nextAttendanceBand(course.attended, course.held, course.dl ?? 0),
    credits: clamp(toFloat(course.credits, 0), 0, 20),
    // Both ends of the same two questions. The `cie` pair is the MOST a grade
    // can cost - the requirement if nothing about the internal improves - and
    // the `cieCeiling` pair is the LEAST, along with the only honest answer to
    // whether either is still possible at all. Nothing consults the floor pair
    // for a possibility: on a row whose CIE can still rise it calls impossible
    // what the outstanding marks would still allow. The two surfaces that
    // print a required mark pair them through `requiredEseCell` rather than
    // choosing an end each.
    needPass: requiredEse(cie, "P", eseMax),
    needTarget: requiredEse(cie, target, eseMax),
    target,
    needPassBest: requiredEse(cieCeiling, "P", eseMax),
    needTargetBest: requiredEse(cieCeiling, target, eseMax),
    maxPossibleGrade: gradeForTotal(cieCeiling + eseMax),
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
  if (ev.grade === null && ev.total === null && (!ev.assessed || ev.cieFloor)) {
    // Nothing to report yet, for one of two reasons: no internal assessment
    // has been published, or one has but the CIE is still a floor - a
    // component or the attendance figure is missing, and no grade may be
    // derived from a bound (`cieFloor`). Attendance is still real and still
    // worth flagging, but nothing can be said about the marks - and nothing
    // can be said about attendance itself when that field is also blank.
    if (isDebarred(ev)) return "DEBARRED";
    if (ev.eligible === false) return "SHORTAGE";
    return "PENDING";
  }
  // A published grade settles the matter; a projection built without an ESE
  // mark (portals never publish the exam score) is not grounds to call a
  // finished course unreachable. The best-case pair rather than `needPass`:
  // unreachable has to mean unreachable at the BEST case, or a course with one
  // series mark in and the rest to come gets stamped with a verdict its own
  // row contradicts.
  if (!ev.needPassBest.possible && ev.grade === null) return "UNREACHABLE";
  if (ev.grade === "F") return "FAILED";
  if (isDebarred(ev)) return "DEBARRED";
  if (ev.eligible === false) return "SHORTAGE";
  // TIGHT is a warning about how hard the requirement LOOKS, so it is priced
  // off the same figure the row prints - `requiredEseCell` quotes the best
  // case wherever the two differ, and a warning solved against the other end
  // would disagree with the number beside it.
  const shown = requiredEseCell(ev.needPass, ev.needPassBest).shown;
  if (ev.grade === null && ev.eseMax && shown.value / ev.eseMax > 0.7) return "TIGHT";
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
  /**
   * Assessed, ungraded, and waiting on a mark rather than on an exam: the CIE
   * is still a floor, because a component or the attendance figure is missing
   * (`Evaluation.cieFloor`).
   *
   * A third state, and it is in neither of the two counts beside it: such a
   * course HAS been assessed, so `pending` never sees it, and it is projected
   * like any other ungraded course, so `assessed` counts it. Without this
   * figure a screen reads `pending === 0` and says every subject is assessed
   * while `creditsConfirmed` sits at zero, which is the reassurance this
   * engine exists to withhold.
   */
  unsettled: number;
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
  let unsettled = 0;

  for (const course of courses) {
    const ev = evaluate(course);

    // Withdrawn or incomplete: KTU keeps the course out of the SGPA until it
    // is completed, denominator included. Its credits leave with it rather
    // than staying in `credits` the way a debarred course's do, because
    // weighing the semester by a course that will never be graded here hands
    // those credits the semester's own average.
    //
    // `credits` is the registered total for the semester in progress, and it
    // is deliberately not described here by who reads it: four successive
    // versions of this comment have named that set and all four named it
    // wrong, which is the tell that the set is the wrong thing to write down.
    // What is stable is the rule. Anything that weighs the semester in
    // progress divides by or compares against this number - the goal solve,
    // the settled-of-registered readouts and the is-there-anything-here gates
    // are examples rather than the list - so it has to be the total KTU would
    // weigh by, which is every course registered bar the withdrawn and
    // incomplete.
    //
    // Live only. What an ARCHIVED semester weighs by is written by whichever
    // ingest path saved it, from its own sum or from the student's keyboard;
    // this figure is never persisted and never read back.
    //
    // `planForSgpa` does not read it either, but it sums the SAME total over
    // the same rule, which is what makes the target and the route answers to
    // one question; see `unplannable` in goals.ts for what that costs each
    // course the route cannot move.
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

    // `unsettled` is the third state: assessed, ungraded, and waiting on a
    // mark rather than on an exam. It is in neither count beside it, and
    // without it a screen reads `pending === 0` and says every subject has
    // been assessed over a confirmed SGPA of zero.
    if (ev.grade === null && ev.assessed && ev.cieFloor) unsettled += 1;

    if (ev.grade !== null) {
      confirmed.push([ev.credits, GRADE_POINTS[ev.grade]]);
      projected.push([ev.credits, GRADE_POINTS[ev.grade]]);
    } else if (ev.needTargetBest.possible) {
      // Not yet written: project the target if reachable, else the best grade
      // still mathematically on the table.
      projected.push([ev.credits, GRADE_POINTS[ev.target]]);
    } else {
      projected.push([ev.credits, GRADE_POINTS[ev.maxPossibleGrade]]);
    }

    if (!ev.needPassBest.possible && ev.grade === null) {
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
    unsettled,
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
