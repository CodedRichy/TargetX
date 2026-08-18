import { inferCredits, lookupCourse } from "./catalogue";
import { DEFAULT_TYPE } from "./constants";
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

export interface Semester {
  courses: Course[];
}

export interface AppState {
  version: number;
  scheme: string;
  student: { name: string; reg_no: string; branch: string; college: string };
  activeSemester: string;
  etlab: Record<string, unknown>;
  semesters: Record<string, Semester>;
  history: Record<string, SemesterHistory>;
  goal?: { cgpa: number | null };
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
    goal: { cgpa: null },
  };
}
