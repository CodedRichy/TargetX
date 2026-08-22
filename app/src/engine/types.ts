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

/**
 * A published mark of non-completion: I (Incomplete) or W (Withdrawn).
 *
 * The university has said something about the course, and what it said is
 * that there is no result yet - so KTU leaves it out of the SGPA entirely,
 * denominator included, until the course is completed. It carries no grade
 * point, which is why it is kept out of `Grade` rather than added to it: a
 * grade point of 0 is the F this is not.
 *
 * AB is not one of these. A student marked absent was admitted to the exam
 * and did not appear, and that is a real fail.
 */
export type Incomplete = "I" | "W";

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
  /**
   * The highest CIE this course can still reach - the top of the interval
   * `[cie, cieCeiling]`, where `cie` is the bottom.
   *
   * Not `cieMax`, which is the bucket's capacity and says nothing about what
   * the marks already recorded allow. This is `cie` itself for every course
   * whose CIE is settled, and `cie + CourseSpec.attMax` (never above `cieMax`)
   * while `cieIncomplete` is true, that being the only component still
   * unpriced there. Anything asking what is still POSSIBLE - can this course
   * still pass, what is the best grade left, what could a grade cost at least
   * - must ask it of this figure; `cie` would answer the same question as
   * though the missing marks were zeros.
   *
   * An unmarked series exam is a different unknown, and this field does not
   * model it: a blank component reads as a zero in both ends of the interval,
   * exactly as it did before.
   */
  cieCeiling: number;
  eseMax: number;
  ese: number | null;
  eseCutoff: number;
  total: number | null;
  /**
   * Three distinct states: a `Grade` (published or derived), an `Incomplete`
   * (published, but no result to score), or null (nothing published and
   * nothing derivable yet).
   */
  grade: Grade | Incomplete | null;
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
  /**
   * True when `cie` is a lower bound rather than the CIE.
   *
   * Attendance is worth `CourseSpec.attMax` marks of the internal (R 7.5.ii),
   * and an unknown percentage cannot be priced - so those marks are neither
   * spent nor awarded and `cie` is short by up to `attMax`. Absence is not
   * zero: no grade is derived while this is true, because a band read off a
   * bound is a band the data does not support. A published `cie_override`
   * clears it, that total already being the college's own arithmetic.
   *
   * A published `portal_grade` does NOT clear it - the internal really is
   * short of a component - but nothing is derived there either: that grade is
   * reported because the university published it, not because this app read
   * it off `cie`. So a course can carry this flag and still report a grade.
   *
   * `cieCeiling` is the other end of the same interval, and is what anything
   * asking what is still reachable must read.
   */
  cieIncomplete: boolean;
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
  | "SAFE" | "TIGHT" | "PENDING" | "INCOMPLETE"
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
