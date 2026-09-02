import { inferCredits, lookupCourse } from "./catalogue";
import { DEFAULT_TYPE } from "./constants";
import { defaultTargets } from "./targets";
import type { Targets } from "./targets";
import type { Change } from "./changes";
import type { DaywiseArchive } from "./daywise";
import type {
  Course, DaywiseAttendance, SemesterHistory, Timetable, TypeKey,
} from "./types";

/**
 * A fresh row. Mark fields start as "" rather than 0 so an untouched course
 * reads as unassessed instead of as a student who scored nothing.
 */
export function blankCourse(
  code = "", name = "", credits: number | "" = 3, typeKey: TypeKey = DEFAULT_TYPE,
): Course {
  return {
    code, name, credits, type: typeKey,
    s1: "", s2: "", other: "",
    s1_max: "", s2_max: "", other_max: "",
    attendance: "", attended: "", held: "", dl: "",
    ese: "", target: "B+", cie_override: "", portal_grade: null,
  };
}

/**
 * What to call a course in front of a student.
 *
 * The NAME wins. A code is the university's key, not the subject: a student
 * reading "24 classes in a row in GAMAT401 buys 1 mark" has to go and look up
 * which class that is, which is the whole of issue #7. The code keeps the one
 * place it is the thing being handled rather than the thing being named - the
 * Ledger's code column, where it is edited.
 *
 * Falling back to the code matters as much as preferring the name. A row
 * seeded from a pasted code has no name yet, and "?" would tell the student
 * less than the code they typed themselves.
 *
 * This is a DISPLAY label and nothing keys off it. `summarise` deliberately
 * does not use it: its lists are pinned in the frozen parity corpus and are
 * only ever rendered as counts, so the identifier there stays an identifier.
 */
export function courseLabel(course: Pick<Course, "code" | "name">): string {
  return (course.name || "").trim() || (course.code || "").trim() || "?";
}

/** Seed a row from the catalogue when the code is known, else infer. */
export function courseFromCode(code: string): Course {
  const listed = lookupCourse(code);
  return blankCourse(
    code.toUpperCase(),
    listed?.name ?? "",
    listed?.credits ?? inferCredits(code),
    listed?.type ?? DEFAULT_TYPE,
  );
}

import type { CreditCheck } from "./catalogue";

export interface Semester {
  courses: Course[];
  /** Seeded credits vs the total the portal published. Null when unchecked. */
  creditCheck?: CreditCheck;
}

export interface AppState {
  version: number;
  scheme: string;
  student: { name: string; reg_no: string; branch: string; college: string };
  activeSemester: string;
  etlab: Record<string, unknown>;
  semesters: Record<string, Semester>;
  history: Record<string, SemesterHistory>;
  /**
   * Every personal target the student has set - CGPA, attendance, SGPA per
   * semester. See `Targets` in engine/targets.ts, and the split it enforces:
   * KTU's own thresholds are constants and are not reachable from here.
   *
   * The field kept the name it had when it held the CGPA target alone, so
   * `goal.cgpa` is at the same path in an old save and a new one and no key
   * has to move. Optional because a save may predate it entirely;
   * `normaliseTargets` is what turns whatever is stored into a complete set.
   */
  goal?: Targets;
  /**
   * Whether first-run setup has been completed.
   *
   * Stored rather than inferred from "are there any courses", because a student
   * who deletes every subject to start a semester over should not be dragged
   * back through onboarding.
   */
  onboarded?: boolean;
  /** "system" | "light" | "dark". Absent means system. */
  theme?: string;
  /**
   * Whether the analytics drawer is open beside the ledger.
   *
   * Stored, because the reason to close it is that the window is too narrow to
   * hold both it and the table - and a window does not get wider between
   * launches. Absent means open, so an existing save is unchanged by this
   * field arriving.
   */
  drawerOpen?: boolean;
  /** ISO timestamp of the last successful portal sync. */
  lastSync?: string;
  /**
   * What the most recent sync moved, against the record as it stood before it.
   *
   * Written by `applySync` and only ever from the SECOND sync onward - a first
   * sync has nothing to diff against, and reporting a whole freshly-pulled
   * record as "changes" would be noise dressed as news. `at` stamps the sync
   * that produced the list so Home can date it and the student can dismiss a
   * batch they have read (an empty `items` with a fresh `at` means "synced,
   * nothing moved", which is itself worth saying). Absent until the second
   * sync, and after a reset.
   */
  changes?: { at: string; items: Change[] };
  /**
   * The day-by-day per-period attendance grid, as last synced. A bonus page,
   * so absent until a sync that could read it - and never cleared to null by a
   * later sync that could not, so a good grid survives a portal hiccup.
   */
  daywiseAttendance?: DaywiseAttendance | null;
  /**
   * Every month of that grid the app has ever seen, keyed `YYYY-MM`.
   *
   * `daywiseAttendance` above holds one month and is overwritten by each sync,
   * so on the first of October the student's September was gone - and a
   * wrongly marked absence is only ever found by looking back at a day you
   * remember being in class (issue #13). This keeps them.
   *
   * It accumulates forward. The portal serves one month, so the archive can
   * only hold months the app was running for; it cannot reach back and invent
   * a September it never saw. `daywiseAttendance` is kept beside it as the
   * most recent pull, so a record written by an older build still opens.
   */
  daywiseMonths?: DaywiseArchive;
  /**
   * What the portal's attendance page offers for changing month, as seen by
   * the last sync that read the page.
   *
   * Not a feature: an open question, written down. The archive above can only
   * accumulate forward, and whether it could reach back depends on whether the
   * portal serves a past month at all. Rather than guess parameter names at a
   * college's server, the page's own navigation is read off the HTML the sync
   * already fetched. Structure only - element and attribute names - so what is
   * stored, shown and pasted carries no record in it.
   */
  monthControls?: { kind: string; detail: string }[] | null;
  /** The weekly timetable and its substitutions, as last synced. See above. */
  timetable?: Timetable | null;
}

export function defaultState(): AppState {
  return {
    version: 1,
    scheme: "KTU 2024",
    student: { name: "", reg_no: "", branch: "", college: "" },
    activeSemester: "S1",
    etlab: {},
    semesters: { S1: { courses: [] } },
    history: {},
    goal: defaultTargets(),
    onboarded: false,
  };
}
