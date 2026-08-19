import { attendanceMarks, effectiveAttendance } from "./attendance";
import { COURSE_TYPES, DEFAULT_TYPE, ESE_PASS_FRACTION } from "./constants";
import type { Course, CourseSpec, MarkInput, TypeKey } from "./types";
import { ceil, clamp, round, toFloat, toOptionalFloat } from "./util";

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
 * The CIE the college would record.
 *
 * If the portal has published an internal total, that number IS the CIE - the
 * registrar's arithmetic is authoritative and second-guessing it would show
 * the student a figure their own result sheet contradicts. That published
 * total already contains the college's own attendance marks, so nothing is
 * added on top of it. Components and attendance are only summed when nothing
 * has been published yet.
 *
 * `attendancePct` defaults to the same effective figure `evaluate` uses;
 * callers that have already derived it pass it in rather than deriving it
 * twice.
 */
export function computeCie(
  course: Course, attendancePct: number | null = effectiveAttendance(course),
): number {
  const spec = specFor(course.type);
  const published = toOptionalFloat(course.cie_override);
  if (published !== null) return round(clamp(published, 0, spec.cieMax), 2);

  let total = 0;
  for (const { key, rawMax, weight } of spec.components) {
    const limit = componentMax(course, key, rawMax);
    const raw = clamp(toFloat((course as Record<string, MarkInput>)[key], 0), 0, limit);
    total += limit ? (raw / limit) * weight : 0;
  }
  // R 7.5.ii: attendance is the fourth component of the internal, not just an
  // eligibility gate. When the percentage is unknown that component cannot be
  // priced at all, so the sum returned here is a LOWER BOUND - the components
  // that are marked, and none of the `spec.attMax` marks attendance may still
  // be worth. It is not a claim that the student earned zero of them.
  // `evaluate` flags a sum reached this way as `cieIncomplete` and withholds
  // the grade rather than deriving one from a bound; nothing else may read
  // this number as a settled CIE.
  total += attendanceMarks(attendancePct, spec.attMax) ?? 0;
  return round(clamp(total, 0, spec.cieMax), 2);
}
