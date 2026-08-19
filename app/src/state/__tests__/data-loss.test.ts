/**
 * The two operations that could destroy work the student cannot get back.
 *
 * Everything else a sync does is recoverable by syncing again. These are not:
 * a grade card is imported once, and a restore is what you reach for after
 * something has already gone wrong. Both of them used to quietly widen the
 * damage instead of repairing it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { blankCourse } from "../../engine";
import type { GradeCard } from "../../sync/gradecard";
import { applyGradeCard, exportJson, importJson, resetEverything } from "../actions";
import { edit, setHistory, state } from "../store";

/** A card carrying just the subjects listed - what a supplementary card is. */
const card = (semester: string, courses: Array<[string, string, number, string]>): GradeCard => ({
  semesterDetected: true,
  semesters: {
    [semester]: {
      courses: courses.map(([code, name, credits, grade]) => ({
        code, name, credits, grade: grade as never, passed: grade !== "F",
      })),
      sgpaCalc: 0,
      credits: courses.reduce((n, [, , c]) => n + c, 0),
      creditsEarned: courses.reduce((n, [, , c]) => n + c, 0),
      mismatch: false,
    },
  },
});

const seedS3 = () => {
  edit((s) => {
    s.semesters["S3"] = {
      courses: [
        { ...blankCourse("PCCST301", "Data Structures", 4, "TH 40/60"), attendance: 82, s1: 31 },
        { ...blankCourse("PCCST302", "DBMS", 4, "TH 40/60"), attendance: 91, s1: 28 },
        { ...blankCourse("PCCSL303", "DS Lab", 2, "LAB 75/25"), attendance: 96 },
      ],
    };
  });
};

describe("a grade card writes what it carries and deletes nothing", () => {
  beforeEach(() => resetEverything());

  it("keeps the subjects a supplementary card does not mention", () => {
    seedS3();
    // The defect: the semester was rebuilt out of the card's contents, so a
    // supplementary card listing one re-registered subject deleted the other
    // two outright - for exactly the students who sit supplementary exams.
    applyGradeCard(card("S3", [["PCCST301", "Data Structures", 4, "P"]]));

    expect(state.semesters["S3"]!.courses.map((c) => c.code))
      .toEqual(["PCCST301", "PCCST302", "PCCSL303"]);
  });

  it("leaves untouched subjects byte-for-byte alone", () => {
    seedS3();
    const before = { ...state.semesters["S3"]!.courses[1]! };
    applyGradeCard(card("S3", [["PCCST301", "Data Structures", 4, "P"]]));
    expect(state.semesters["S3"]!.courses[1]).toEqual(before);
  });

  it("writes the grade onto the listed subject without losing its working data", () => {
    seedS3();
    applyGradeCard(card("S3", [["PCCST301", "Data Structures", 4, "B+"]]));

    const course = state.semesters["S3"]!.courses[0]!;
    expect(course.portal_grade).toBe("B+");
    // Attendance and series marks are never on a card, so they must survive it.
    expect(course.attendance).toBe(82);
    expect(course.s1).toBe(31);
  });

  it("appends a subject the semester did not already have", () => {
    seedS3();
    applyGradeCard(card("S3", [["PCCST999", "Re-registered Backlog", 3, "P"]]));

    const codes = state.semesters["S3"]!.courses.map((c) => c.code);
    expect(codes).toEqual(["PCCST301", "PCCST302", "PCCSL303", "PCCST999"]);
    expect(state.semesters["S3"]!.courses[3]!.portal_grade).toBe("P");
  });
});

describe("a restore replaces the document rather than merging into it", () => {
  beforeEach(() => resetEverything());

  it("clears fields the backup does not carry", () => {
    // A student who has synced, restoring a backup taken before they ever did.
    edit((s) => {
      s.lastSync = "2026-08-01T00:00:00.000Z";
      s.student.college = "mits.etlab.in";
    });
    const backup = JSON.parse(exportJson());
    delete backup.lastSync;
    delete backup.student;

    // The defect: Object.assign only overwrote the keys the backup HAD, so
    // every key it omitted stayed behind from the session being replaced. The
    // result claimed a sync, and a college, that this document never had.
    importJson(JSON.stringify(backup));
    expect(state.lastSync).toBeUndefined();
    expect(state.student.college).toBe("");
  });

  it("restores the history the backup does carry", () => {
    setHistory("S1", 8.1, 22);
    const backup = exportJson();
    resetEverything();

    importJson(backup);
    expect(state.history["S1"]).toEqual(
      { sgpa: 8.1, creditsRegistered: 22, creditsEarned: null });
  });

  it("restores the semesters the backup does carry", () => {
    seedS3();
    const backup = exportJson();
    resetEverything();
    expect(state.semesters["S3"]).toBeUndefined();

    importJson(backup);
    expect(state.semesters["S3"]!.courses.map((c) => c.code))
      .toEqual(["PCCST301", "PCCST302", "PCCSL303"]);
  });

  it("refuses a backup written by a newer build instead of half-reading it", () => {
    const backup = JSON.parse(exportJson());
    backup.version = 99;
    expect(() => importJson(JSON.stringify(backup))).toThrow(/newer version/i);
  });

  it("still refuses a file that is not a TargetX backup at all", () => {
    expect(() => importJson('{"hello":"world"}')).toThrow(/not a TargetX backup/i);
  });
});
