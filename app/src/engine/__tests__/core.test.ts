/**
 * Port of test_core.py. Same checks, same expected values.
 *
 * These are the spec for the engine, not a smoke test: every case here
 * encodes a KTU rule that was verified against the Regulations 2024 PDF or a
 * live grade card. If one of them fails, the app is lying to a student.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CONDONE, DL_CAP_PCT,
  attendanceMarks, attendancePlan, blankCourse, cgpaFromSemesters, computeCie,
  eseCutoff, evaluate, nextAttendanceBand, normaliseGrade, parseEtlab,
  planForSgpa, requiredEse, requiredSgpaForCgpa, sgpa,
} from "../index";
import type { Course } from "../types";

describe("CIE scaling", () => {
  it("scales each component onto its weight inside a 40-mark CIE", () => {
    const c: Course = { ...blankCourse("PCCST302", "DSA", 4, "TH 40/60"), s1: 40, s2: 30, other: 8 };
    // 40/50*15 + 30/50*15 + 8/10*10 = 12 + 9 + 8 = 29
    expect(computeCie(c)).toBe(29.0);
  });

  it("caps at the CIE maximum for a 50-mark pattern", () => {
    const c: Course = { ...blankCourse("X", "Y", 3, "TH 50/50"), s1: 50, s2: 50, other: 10 };
    expect(computeCie(c)).toBe(50.0);
  });

  it("lets a published internal total override the components", () => {
    const c: Course = { ...blankCourse("X", "Y", 3, "TH 40/60"), s1: 10, s2: 10, cie_override: 37 };
    expect(computeCie(c)).toBe(37);
  });
});

describe("ESE cutoff", () => {
  it("is 40% of the paper, rounded up", () => {
    expect(eseCutoff(60)).toBe(24);
    expect(eseCutoff(50)).toBe(20);
    expect(eseCutoff(25)).toBe(10);
  });

  it("is zero when there is no end-semester exam", () => {
    expect(eseCutoff(0)).toBe(0);
  });
});

describe("reverse engine", () => {
  it("reports an out-of-range target as impossible", () => {
    const r = requiredEse(29, "S", 60);   // 90 - 29 = 61 > 60
    expect(r.value).toBe(61);
    expect(r.possible).toBe(false);
    expect(r.text).toBe("Impossible");
  });

  it("solves the aggregate constraint when it binds", () => {
    const r = requiredEse(29, "B+", 60);
    expect([r.value, r.binding]).toEqual([46, "aggregate"]);
  });

  it("lets the separate 40% ESE minimum override the aggregate", () => {
    // The aggregate alone would say 12, but 40% of 60 = 24 rules.
    const r = requiredEse(38, "P", 60);
    expect([r.value, r.binding]).toEqual([24, "cutoff"]);
  });
});

describe("grade and fail paths", () => {
  const base: Course = {
    ...blankCourse("A", "A", 4, "TH 40/60"),
    s1: 50, s2: 50, other: 10, attendance: 90,
  };

  it("does not let a large CIE buy a pass", () => {
    // CIE 40 + ESE 23 = 63 total, but ESE 23 < the 24 cutoff -> F
    expect(evaluate({ ...base, ese: 23 }).grade).toBe("F");
  });

  it("grades on the total once the cutoff is cleared", () => {
    expect(evaluate({ ...base, ese: 24 }).grade).toBe("C");
    expect(evaluate({ ...base, ese: 50 }).grade).toBe("S");
  });

  it("flags attendance below the eligibility line", () => {
    expect(evaluate({ ...base, ese: 50, attendance: 70 }).eligible).toBe(false);
  });

  it("treats a blank ESE as unwritten rather than zero", () => {
    const ev = evaluate(base);
    expect(ev.grade).toBeNull();
    expect(ev.total).toBeNull();
    expect(ev.assessed).toBe(true);
  });

  it("reports an untouched course as unassessed", () => {
    const ev = evaluate(blankCourse("PCCST999", "New", 4));
    expect(ev.assessed).toBe(false);
    expect(ev.grade).toBeNull();
  });
});

describe("SGPA and percentage", () => {
  it("weights grade points by credits", () => {
    expect(sgpa([[4, 10.0], [2, 5.5]])).toBe(8.5);
  });

  it("uses percentage = 10 x CGPA, with no legacy fudge", () => {
    expect(cgpaFromSemesters({ S1: { sgpa: 8.5, credits: 20 } }).percent).toBe(85.0);
  });
});

describe("pasted etlab text", () => {
  it("reads attendance rows and skips lines with no course code", () => {
    const rows = parseEtlab(
      "PCCST302  Data Structures   38  42  90.48%\nPCCST303  OOP   30 40\njunk line no code here 55\n",
      "attendance");
    expect(rows.length).toBe(2);
    expect(rows[0]!.attendance).toBe(90.48);
    expect(Math.round(rows[1]!.attendance! * 10) / 10).toBe(75.0);
  });

  it("maps the first three numbers onto S1, S2 and the assignment", () => {
    const rows = parseEtlab("PCCST304 Digital Logic 45 38 9\n", "marks");
    expect([rows[0]!.s1, rows[0]!.s2, rows[0]!.other]).toEqual([45, 38, 9]);
  });
});

describe("attendance marks (Regulations 2024, R 7.5.ii)", () => {
  it("awards CIE marks by band", () => {
    expect(attendanceMarks(88)).toBe(5);
    expect(attendanceMarks(83)).toBe(4);
    expect(attendanceMarks(77)).toBe(3);
    expect(attendanceMarks(72)).toBe(2);
    expect(attendanceMarks(64)).toBe(1);
    expect(attendanceMarks(55)).toBe(0);
  });

  it("returns null rather than 0 when attendance is unknown", () => {
    expect(attendanceMarks("")).toBeNull();
  });

  it("keeps the regulation thresholds", () => {
    expect(ATTENDANCE_CONDONE).toBe(60.0);
    expect(DL_CAP_PCT).toBe(10.0);
  });

  it("says how many consecutive classes buy the next mark", () => {
    const band = nextAttendanceBand(15, 18);   // 83.3% -> 4 marks
    expect([band!.earned, band!.attend, band!.nextMarks]).toEqual([4, 2, 5]);
  });
});

describe("duty leave", () => {
  it("lifts effective attendance", () => {
    expect(attendancePlan(14, 18, 2)!.current).toBe(87.78);
  });

  it("discards duty leave beyond the 10% cap", () => {
    expect(attendancePlan(30, 50, 8)!.dlWasted).toBe(3.0);
  });

  it("answers how many classes can be skipped when above the line", () => {
    const plan = attendancePlan(45, 50)!;   // 90%
    expect(plan.state).toBe("surplus");
    expect(plan.skip).toBe(10);            // 45/60 = 75%
  });

  it("answers how many must be attended when below it", () => {
    const plan = attendancePlan(30, 50)!;   // 60%
    expect(plan.state).toBe("deficit");
    expect(plan.attend).toBe(30);          // 60/80 = 75%
  });

  it("returns null when the portal gave no raw counts", () => {
    expect(attendancePlan("", "")).toBeNull();
  });
});

describe("goal engine", () => {
  const history = { S1: { sgpa: 8.0, credits: 20 }, S2: { sgpa: 8.0, credits: 20 } };

  it("says holding a CGPA needs the same SGPA", () => {
    expect(requiredSgpaForCgpa(8.0, history, 20).required).toBe(8.0);
  });

  it("flags a CGPA that is already out of reach", () => {
    expect(requiredSgpaForCgpa(9.9, history, 20).possible).toBe(false);
  });

  it("builds a plan that stays inside the paper", () => {
    const courses = [
      { ...blankCourse("PCCST501", "CN", 4), cie_override: 30 },
      { ...blankCourse("PCCST502", "DAA", 4), cie_override: 32 },
    ];
    const plan = planForSgpa(courses, 7.5);
    expect(plan.reachable).toBe(true);
    expect(plan.plan.length).toBe(2);
    expect(plan.plan.every((row) => row.ese <= 60)).toBe(true);
  });

  it("rejects a target above the ceiling and reports that ceiling", () => {
    // With CIE 30/32 straight S is still reachable, so the unreachable case
    // needs genuinely capped courses: CIE 10 tops out at 70/100.
    const capped = [
      { ...blankCourse("X1", "low", 4), cie_override: 10 },
      { ...blankCourse("X2", "low", 4), cie_override: 10 },
    ];
    const plan = planForSgpa(capped, 9.0);
    expect(plan.reachable).toBe(false);
    expect(plan.maxSgpa).toBe(7.5);
  });
});

describe("published values outrank derived ones", () => {
  const graded: Course = {
    ...blankCourse("PCCST403", "OS", 4),
    cie_override: 30, portal_grade: "C", attendance: 87,
  };

  it("takes the university grade as final, with no ESE mark needed", () => {
    expect(evaluate(graded).grade).toBe("C");
    expect(evaluate(graded).assessed).toBe(true);
  });

  it("normalises the words a portal uses for a pass", () => {
    // Pass/fail courses count in SGPA at 5.5 - the portal publishes that.
    expect(normaliseGrade("PASSED")).toBe("P");
    expect(normaliseGrade("Completed")).toBe("P");
  });

  it("refuses to read a result word as a grade", () => {
    expect(normaliseGrade("-")).toBeNull();
    expect(normaliseGrade("")).toBeNull();
    expect(normaliseGrade("N/A")).toBeNull();
  });
});
