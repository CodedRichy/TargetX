import type { Component, CourseSpec, Grade, Letter, TypeKey } from "./types";

/**
 * KTU 2024 scheme constants.
 *
 * Every number here was checked against the B.Tech Regulations 2024 PDF or a
 * live grade card. Where a value contradicts what older KTU calculators show,
 * the comment says why - those tools mostly still encode the 2019 scheme.
 */

export const GRADE_BANDS: ReadonlyArray<readonly [Letter, number, number]> = [
  ["S", 90, 10.0],
  ["A+", 85, 9.0],
  ["A", 80, 8.5],
  ["B+", 75, 8.0],
  ["B", 70, 7.5],
  ["C+", 65, 7.0],
  ["C", 60, 6.5],
  ["D", 55, 6.0],
  ["P", 50, 5.5],
];

export const GRADE_POINTS: Record<Grade, number> = {
  ...(Object.fromEntries(GRADE_BANDS.map(([l, , gp]) => [l, gp])) as Record<Letter, number>),
  F: 0.0,
};

export const GRADE_MIN: Record<Letter, number> = Object.fromEntries(
  GRADE_BANDS.map(([l, lo]) => [l, lo]),
) as Record<Letter, number>;

/** CIE + ESE must reach 50/100. */
export const TOTAL_PASS_MARK = 50;
/** Separate ESE minimum: 40% of the ESE maximum. Both conditions bind. */
export const ESE_PASS_FRACTION = 0.4;
/** Eligibility threshold (%). */
export const ATTENDANCE_MIN = 75.0;
/**
 * R 6.2: the Principal may condone attendance below 75% only down to 60%,
 * for at most two semesters and against a fee. Below 60% there is no appeal.
 */
export const ATTENDANCE_CONDONE = 60.0;
/** R 6.3.ii: "Attendance relaxation is allowed up to a maximum of 10%". */
export const DL_CAP_PCT = 10.0;

/**
 * R 7.5.ii - CIE Marks for Attendance.
 *
 * Attendance is not only an eligibility gate, it is worth marks inside the
 * internal total. This is the part every other KTU calculator misses: a
 * student sitting at 76% is not "fine", they are two marks down before
 * writing a single exam.
 */
export const ATTENDANCE_MARK_BANDS: ReadonlyArray<readonly [number, number]> = [
  [85.0, 5],
  [80.0, 4],
  [75.0, 3],
  [70.0, 2],
  [60.0, 1],
];
export const ATTENDANCE_MARK_MAX = 5;

const comp = (
  key: Component["key"], header: string, rawMax: number, weight: number,
): Component => ({ key, header, rawMax, weight });

/**
 * Course evaluation patterns. Each component is entered on its own natural
 * scale and scaled into the CIE bucket, so a series marked out of 50 stays
 * entered as /50 instead of being pre-scaled by hand on paper.
 */
export const COURSE_TYPES: Record<TypeKey, CourseSpec> = {
  "TH 40/60": {
    label: "Theory - CIE 40 / ESE 60",
    cieMax: 40,
    eseMax: 60,
    components: [comp("s1", "S1", 50, 15), comp("s2", "S2", 50, 15), comp("other", "Asg", 10, 10)],
  },
  "TH 50/50": {
    label: "Theory - CIE 50 / ESE 50",
    cieMax: 50,
    eseMax: 50,
    components: [comp("s1", "S1", 50, 20), comp("s2", "S2", 50, 20), comp("other", "Asg", 10, 10)],
  },
  // The 2024 scheme's real lab split. Earlier schemes used 75/25, which is
  // why so many calculators still show it - the pass mark differs.
  "LAB 50/50": {
    label: "Lab / Practical - CIE 50 / ESE 50",
    cieMax: 50,
    eseMax: 50,
    components: [comp("s1", "Cont", 50, 25), comp("s2", "Test", 50, 15), comp("other", "Rec", 10, 10)],
  },
  // Project-based-learning courses invert the split: more weight inside the
  // semester, a smaller final exam - but the 40% ESE rule still applies, so
  // the cutoff is 16/40.
  "PBL 60/40": {
    label: "Project-based course - CIE 60 / ESE 40",
    cieMax: 60,
    eseMax: 40,
    components: [comp("s1", "Eval1", 50, 25), comp("s2", "Eval2", 50, 25), comp("other", "Work", 10, 10)],
  },
  "LAB 75/25": {
    label: "Lab / Practical - CIE 75 / ESE 25",
    cieMax: 75,
    eseMax: 25,
    components: [comp("s1", "Cont", 50, 45), comp("s2", "Test", 50, 20), comp("other", "Rec", 10, 10)],
  },
  "PRJ 100/0": {
    label: "Project / Internal only - CIE 100",
    cieMax: 100,
    eseMax: 0,
    components: [comp("s1", "Eval1", 50, 50), comp("s2", "Eval2", 50, 40), comp("other", "Rep", 10, 10)],
  },
};

export const TYPE_KEYS = Object.keys(COURSE_TYPES) as TypeKey[];
export const DEFAULT_TYPE: TypeKey = "TH 40/60";
export const TARGET_CHOICES: Letter[] = ["S", "A+", "A", "B+", "B", "C+", "C", "D", "P"];
