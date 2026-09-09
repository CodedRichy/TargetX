import type { CourseSpec, Grade, Letter, TypeKey } from "./types";
import { KTU_2024, resolveCourseTypes } from "./scheme";

/**
 * The KTU 2024 numbers, in the shapes the engine has always imported them in.
 *
 * These are no longer authored here. They are derived from the `KTU_2024`
 * profile in `scheme.ts`, which is where a number gets changed and where the
 * comment explaining it lives. This file exists so that the ~30 modules that
 * import `ATTENDANCE_MIN` or `COURSE_TYPES` keep compiling unchanged while
 * the profile work lands underneath them.
 *
 * Everything here is the built-in scheme specifically. Code that should
 * follow the student's chosen profile must read the active scheme instead -
 * these bindings are fixed at module load and cannot change.
 */

export const GRADE_BANDS: ReadonlyArray<readonly [Letter, number, number]> =
  KTU_2024.gradeBands.map((b) => [b.letter, b.minPct, b.points] as const);

export const GRADE_POINTS: Record<Grade, number> = {
  ...(Object.fromEntries(
    KTU_2024.gradeBands.map((b) => [b.letter, b.points]),
  ) as Record<Letter, number>),
  F: 0.0,
};

export const GRADE_MIN: Record<Letter, number> = Object.fromEntries(
  KTU_2024.gradeBands.map((b) => [b.letter, b.minPct]),
) as Record<Letter, number>;

/** CIE + ESE must reach 50/100. */
export const TOTAL_PASS_MARK = KTU_2024.totalPassMark;
/** Separate ESE minimum: 40% of the ESE maximum. Both conditions bind. */
export const ESE_PASS_FRACTION = KTU_2024.esePassFraction;
/** Eligibility threshold (%). */
export const ATTENDANCE_MIN = KTU_2024.attendanceMin;
/** R 6.2: condonable below 75% only down to 60%. Below that there is no appeal. */
export const ATTENDANCE_CONDONE = KTU_2024.attendanceCondone;
/** R 6.3.ii: "Attendance relaxation is allowed up to a maximum of 10%". */
export const DL_CAP_PCT = KTU_2024.dlCapPct;

/** R 7.5.ii - CIE marks earned by attendance alone. */
export const ATTENDANCE_MARK_BANDS: ReadonlyArray<readonly [number, number]> =
  KTU_2024.attendanceMarkBands.map((b) => [b.minPct, b.marks] as const);
export const ATTENDANCE_MARK_MAX = KTU_2024.attendanceMarkMax;

/**
 * Course evaluation patterns, with attendance's marks already taken out of
 * the component weights. Each component is entered on its own natural scale
 * and scaled into the CIE bucket, so a series marked out of 50 stays entered
 * as /50 instead of being pre-scaled by hand on paper.
 */
export const COURSE_TYPES: Record<TypeKey, CourseSpec> = resolveCourseTypes(KTU_2024);

export const TYPE_KEYS = Object.keys(COURSE_TYPES) as TypeKey[];
export const DEFAULT_TYPE: TypeKey = KTU_2024.defaultType;
export const TARGET_CHOICES: Letter[] = [...KTU_2024.targetChoices];
