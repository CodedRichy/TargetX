import { inferCredits, lookupCourse } from "./catalogue";
import { DEFAULT_TYPE } from "./constants";
import { defaultTargets } from "./targets";
import type { Targets } from "./targets";
import type { Course, SemesterHistory, TypeKey } from "./types";

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
  /** ISO timestamp of the last successful portal sync. */
  lastSync?: string;
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
