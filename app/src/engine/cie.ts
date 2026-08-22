import { attendanceMarks, effectiveAttendance } from "./attendance";
import { COURSE_TYPES, DEFAULT_TYPE, ESE_PASS_FRACTION } from "./constants";
import type { Course, CourseSpec, MarkInput, TypeKey } from "./types";
import { ceil, clamp, round, toOptionalFloat } from "./util";

export const specFor = (typeKey: TypeKey | undefined): CourseSpec =>
  COURSE_TYPES[typeKey as TypeKey] ?? COURSE_TYPES[DEFAULT_TYPE];

/** Separate ESE minimum, rounded up so the printed number always passes. */
export function eseCutoff(eseMax: number): number {
  if (eseMax <= 0) return 0;
  return ceil(eseMax * ESE_PASS_FRACTION);
}

/**
 * Per-course component maximum.
 *
 * Series exams are marked out of 40 at some colleges and 50 at others, and
 * the portal states which. A published maximum always beats a built-in
 * assumption, so sync writes it here and the scaling follows it.
 */
export function componentMax(course: Course, key: string, defaultMax: number): number {
  const value = toOptionalFloat((course as Record<string, MarkInput>)[`${key}_max`]);
  return value && value > 0 ? value : defaultMax;
}

/**
 * The CIE the college would record, and the highest one still reachable.
 *
 * If the portal has published an internal total, that number IS the CIE - the
 * registrar's arithmetic is authoritative and second-guessing it would show
 * the student a figure their own result sheet contradicts. That published
 * total already contains the college's own attendance marks, so nothing is
 * added on top of it, and there is nothing left to reach: both bounds are the
 * published figure.
 *
 * Otherwise the two ends are computed from the same loop, because they differ
 * only in what an ABSENT number is worth:
 *
 *   - `cie` is the floor. A component with no mark counts nothing, and an
 *     unknown attendance is not priced at all. It is what the college would
 *     record if the semester stopped here, and it is NOT a claim that the
 *     missing marks were failed.
 *   - `ceiling` is the most this course can still reach. An unmarked
 *     component is unknown, not zero, so it counts its whole weight; a marked
 *     one cannot move and counts what it scored. Attendance counts `attMax`
 *     whatever the current percentage is, because attendance marks are the
 *     one part of a CIE a student can still go and earn - which is the whole
 *     point of `attBand` and of this app.
 *
 * Anything asking what a student still HAS reads the floor; anything asking
 * what is still POSSIBLE reads the ceiling. `Evaluation.cieFloor` flags the
 * one case where the floor is not even today's mark - a component or the
 * attendance figure missing - and `evaluate` withholds any grade that would
 * have to be read off it: R 7.5.ii makes attendance the fourth component of
 * the internal, and a band read off a sum that is short of a component is a
 * band the data does not support. That flag is NOT the gap between the two
 * ends. The gap is wider: it also opens on a fully marked internal below 85%
 * attendance, where the CIE is exactly today's mark and still has attendance
 * marks left to earn. Asking `cieFloor` when the question is "can this number
 * still move" is how a required mark came to be printed as though it were
 * exact.
 *
 * `attendancePct` defaults to the same effective figure `evaluate` uses;
 * callers that have already derived it pass it in rather than deriving it
 * twice.
 */
export function cieBounds(
  course: Course, attendancePct: number | null = effectiveAttendance(course),
): { cie: number; ceiling: number } {
  const spec = specFor(course.type);
  const published = toOptionalFloat(course.cie_override);
  if (published !== null) {
    const settled = round(clamp(published, 0, spec.cieMax), 2);
    return { cie: settled, ceiling: settled };
  }

  let floor = 0;
  let ceiling = 0;
  for (const { key, rawMax, weight } of spec.components) {
    const limit = componentMax(course, key, rawMax);
    const mark = toOptionalFloat((course as Record<string, MarkInput>)[key]);
    const scaled = mark === null || !limit ? 0 : (clamp(mark, 0, limit) / limit) * weight;
    floor += scaled;
    ceiling += mark === null && limit ? weight : scaled;
  }
  floor += attendanceMarks(attendancePct, spec.attMax) ?? 0;
  ceiling += spec.attMax;

  return {
    cie: round(clamp(floor, 0, spec.cieMax), 2),
    ceiling: round(clamp(ceiling, 0, spec.cieMax), 2),
  };
}

