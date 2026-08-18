/**
 * Shared shapes for the TargetX calculation core.
 *
 * Marks fields are `MarkInput` rather than `number` on purpose. A blank field
 * is not a zero: an ESE nobody has written and an ESE of 0 are different
 * facts, and collapsing them is the single most common way a grade calculator
 * lies to a student. Everything downstream distinguishes null from 0.
 */

export type MarkInput = number | string | null | undefined;

export type TypeKey =
  | "TH 40/60"
  | "TH 50/50"
  | "LAB 50/50"
  | "PBL 60/40"
  | "LAB 75/25"
  | "PRJ 100/0";

export type Letter = "S" | "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "P";
export type Grade = Letter | "F";

/** (json key, column header, raw maximum, weight inside the CIE bucket) */
export interface Component {
  key: "s1" | "s2" | "other";
  header: string;
  rawMax: number;
  weight: number;
}

export interface CourseSpec {
  label: string;
  cieMax: number;
  eseMax: number;
  /** CIE marks reserved for attendance under R 7.5.ii. */
  attMax: number;
  components: Component[];
}

export interface Course {
  code?: string;
  name?: string;
  credits?: MarkInput;
  type?: TypeKey;
  s1?: MarkInput;
  s2?: MarkInput;
  other?: MarkInput;
  /** Per-course component maxima, when the portal publishes them. */
  s1_max?: MarkInput;
  s2_max?: MarkInput;
  other_max?: MarkInput;
  attendance?: MarkInput;
  attended?: MarkInput;
  held?: MarkInput;
  /** Approved duty leave, in classes. */
  dl?: MarkInput;
  ese?: MarkInput;
  target?: Letter;
  /** Internal total as published by the college. Outranks the components. */
  cie_override?: MarkInput;
  /** Grade as published by the university. Outranks everything derived. */
  portal_grade?: string | null;
  /**
   * True once the student has checked this course's credit against their own
   * curriculum. Credits are never published per course, only per semester, so
   * an unconfirmed credit is an inference and a re-sync may overwrite it; a
   * confirmed one is evidence and must not be.
   */
  creditsConfirmed?: boolean;
}

export interface RequiredEse {
  value: number;
  possible: boolean;
  text: string;
  binding: "cutoff" | "aggregate" | "cie-only";
}

export interface AttendancePlan {
  raw: number;
  current: number;
  dlClaimed: number;
  dlCredited: number;
  dlWasted: number;
  state: "surplus" | "deficit";
  skip: number;
  attend: number | null;
}

export interface AttendanceBand {
  earned: number;
  nextMarks: number | null;
  attend: number;
  atPct: number | null;
}

export interface Evaluation {
  cie: number;
  cieMax: number;
  eseMax: number;
  ese: number | null;
  eseCutoff: number;
  total: number | null;
  grade: Grade | null;
  failedReason: string;
  /** Null when the portal has published nothing yet - not a full 100%. */
  attendance: number | null;
  /**
   * Null when attendance itself is unknown, distinct from `false` (known and
   * below 75%). Collapsing the two would flag a blank field as a shortage.
   */
  eligible: boolean | null;
  /** False when nothing has been marked yet - absence of data, not a zero. */
  assessed: boolean;
  plan: AttendancePlan | null;
  attMarks: number | null;
  attBand: AttendanceBand | null;
  credits: number;
  needPass: RequiredEse;
  needTarget: RequiredEse;
  target: Letter;
  maxPossibleGrade: Grade;
}

export type Status =
  | "SAFE" | "TIGHT" | "PENDING"
  | "SHORTAGE" | "DEBARRED" | "FAILED" | "UNREACHABLE";

/**
 * A finished semester, as the university published it.
 *
 * KTU weights the CGPA by REGISTERED credits: a failed course scores zero
 * grade points but its credits stay in the denominator. Storing the earned
 * total under a field the CGPA reads inflates every semester that carries a
 * backlog, so the two totals are named apart and never conflated.
 */
export interface SemesterHistory {
  sgpa: number;
  /**
   * Credits the student registered for - the CGPA denominator.
   *
   * Null when it is genuinely unknown. Saves written before the two totals
   * were told apart hold only the earned figure, and no arithmetic recovers
   * the registered one from it; see `migrateHistory` in state/store.ts.
   */
  creditsRegistered: number | null;
  /**
   * Credits passed. Shown to the student, never weighted into the CGPA.
   * Null when nothing published it.
   */
  creditsEarned: number | null;
}
