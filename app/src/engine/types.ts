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
   * The highest CIE this course can still reach.
   *
   * Not `cieMax`, which is the bucket's capacity and says nothing about what
   * this course allows. Every component that HAS a mark counts what it
   * scored, because a recorded mark cannot move; every component that does
   * not counts its whole weight, because an unwritten series exam is unknown
   * rather than zero; and the attendance component counts `attMax` whatever
   * today's percentage is, because attendance marks are the one part of a CIE
   * a student can still go and earn - `attBand` on this same object is the
   * engine telling them how many classes that takes. A published
   * `cie_override` settles both ends at the published figure.
   *
   * It follows that this equals `cie` only where nothing can move it - a
   * published total, or every component marked with the attendance component
   * already full - and that it is the figure every
   * forward-looking question must read: what could this grade cost at least,
   * can this course still pass, what is the best grade left. `cie` would
   * answer all three as though the missing marks were zeros and the missing
   * attendance were unrecoverable.
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
   * True when the attendance component of `cie` could not be priced.
   *
   * Attendance is worth `CourseSpec.attMax` marks of the internal (R 7.5.ii),
   * and an unknown percentage cannot be priced - so those marks are neither
   * spent nor awarded and `cie` is short by up to `attMax`. Absence is not
   * zero. A published `cie_override` clears it, that total already being the
   * college's own arithmetic.
   *
   * One of the two halves of `cieFloor`, which is what the arithmetic keys
   * on; this one exists so a screen can say WHICH figure is missing, since
   * the student can supply an attendance percentage and cannot supply a
   * series mark.
   *
   * Two ways a grade is still reported while this is true, and both are
   * deliberate: a `portal_grade` the university published (reported because
   * it was published, not because anything read it off `cie`), and an F
   * decided by the separate 40% ESE minimum, which never touches the CIE at
   * all.
   */
  cieIncomplete: boolean;
  /**
   * True when a CIE component has no mark yet, so `cie` is short by its
   * weight. The other half of `cieFloor`, and the reason it is separate: a
   * screen that explains the missing figure has to name the right one, and
   * "enter your attendance" is wrong advice for an unwritten series exam.
   * A published `cie_override` clears it, as it does `cieIncomplete`.
   */
  cieUnmarked: boolean;
  /**
   * True when `cie` is a lower bound rather than the internal as it stands
   * today - either flag above. This is what the arithmetic keys on: no grade
   * is derived off a floor (the ESE-cutoff F excepted, which never reads the
   * CIE at all), the status is PENDING, the required-mark columns say
   * nothing, and the CIE cell is marked as a bound.
   *
   * Not to be confused with `cieCeiling > cie`, which is the wider question of
   * whether the CIE can still rise at all: a fully marked internal below 85%
   * attendance has this flag false and that gap open, because the attendance
   * marks of R 7.5.ii are still there to be earned. Anything deciding whether
   * a number derived from the CIE is exact must compare the two ends.
   */
  cieFloor: boolean;
  plan: AttendancePlan | null;
  attMarks: number | null;
  attBand: AttendanceBand | null;
  credits: number;
  /**
   * What a pass / the target costs in the exam if the CIE stays exactly where
   * it is: priced off `cie`, so this is the MOST either can cost. On a row
   * whose CIE can still rise it is an upper bound and not the answer, and
   * `.possible` on it is not the possibility question - it says "impossible"
   * for a course whose attendance marks or component marks are simply not all
   * in yet. Ask `needPassBest.possible` for that, and pair the two through
   * `requiredEseCell` before printing either.
   */
  needPass: RequiredEse;
  needTarget: RequiredEse;
  target: Letter;
  /**
   * The same two questions asked of `cieCeiling`: the LEAST a pass / the
   * target can cost, and - through `.possible` - whether either is still
   * reachable at all. One shared answer, because `statusFor`, `summarise`,
   * Home and both surfaces that print a required mark all ask it, and three
   * private copies of one question is how they drift apart.
   */
  needPassBest: RequiredEse;
  needTargetBest: RequiredEse;
  /** The best grade `cieCeiling` plus a full exam could still produce. */
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
