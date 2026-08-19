/**
 * Port of test_core.py. Same checks, same expected values.
 *
 * These are the spec for the engine, not a smoke test: every case here
 * encodes a KTU rule that was verified against the Regulations 2024 PDF or a
 * live grade card. If one of them fails, the app is lying to a student.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_MARK_MAX, COURSE_TYPES, DL_CAP_PCT, TYPE_KEYS,
  attendanceMarks, attendancePlan, blankCourse, cgpaFromSemesters, computeCie,
  eseCutoff, evaluate, nextAttendanceBand, normaliseGrade, parseEtlab,
  historyCredits, planForSgpa, requiredEse, requiredSgpaForCgpa, sgpa, statusFor,
  summarise,
} from "../index";
import type { Course, TypeKey } from "../types";

describe("CIE scaling", () => {
  it("scales each component onto its weight inside a 40-mark CIE", () => {
    const c: Course = { ...blankCourse("PCCST302", "DSA", 4, "TH 40/60"), s1: 40, s2: 30, other: 8 };
    // Components share cieMax - attMax = 35, so the weights are 13.125/13.125/8.75:
    // 40/50*13.125 + 30/50*13.125 + 8/10*8.75 = 10.5 + 7.875 + 7 = 25.375.
    // Attendance is blank here and so earns nothing.
    expect(computeCie(c)).toBe(25.38);
  });

  it("fills a 50-mark bucket exactly at full components and full attendance", () => {
    const c: Course = {
      ...blankCourse("X", "Y", 3, "TH 50/50"), s1: 50, s2: 50, other: 10, attendance: 90,
    };
    // 18 + 18 + 9 = 45 of components, plus the 5 attendance marks.
    expect(computeCie(c)).toBe(50.0);
  });

  it("lets a published internal total override the components", () => {
    const c: Course = { ...blankCourse("X", "Y", 3, "TH 40/60"), s1: 10, s2: 10, cie_override: 37 };
    expect(computeCie(c)).toBe(37);
  });
});

describe("attendance is spent, not just displayed (R 7.5.ii)", () => {
  /** Same course throughout; only the attendance evidence changes. */
  const dsa = (extra: Partial<Course> = {}): Course => ({
    ...blankCourse("PCCST302", "DSA", 4, "TH 40/60"), s1: 40, s2: 30, other: 8, ...extra,
  });

  it("splits every CIE bucket into components plus a 5-mark attendance slot", () => {
    for (const key of TYPE_KEYS) {
      const spec = COURSE_TYPES[key];
      const weights = spec.components.reduce((sum, c) => sum + c.weight, 0);
      expect(spec.attMax).toBe(ATTENDANCE_MARK_MAX);
      // A spec whose parts do not total cieMax is a silent mis-scaling: every
      // mark in the bucket has to be reachable, and none twice.
      expect(weights + spec.attMax).toBeCloseTo(spec.cieMax, 10);
    }
  });

  it("separates two courses that differ only in attendance", () => {
    const poor = evaluate(dsa({ attendance: 45, ese: 30 }));
    const good = evaluate(dsa({ attendance: 90, ese: 30 }));
    expect(good.cie - poor.cie).toBe(5);
    expect(good.total! - poor.total!).toBe(5);
    expect(poor.needPass.value).toBeGreaterThan(good.needPass.value);
    expect(poor.needTarget.value - good.needTarget.value).toBe(5);
  });

  it("pays the full 5 marks from 85% and nothing below 60%", () => {
    const components = computeCie(dsa({ attendance: 45 }));
    expect(computeCie(dsa({ attendance: 85 }))).toBe(components + 5);
    expect(computeCie(dsa({ attendance: 59.9 }))).toBe(components);
  });

  it("earns nothing for attendance nobody has published, without voiding the components", () => {
    const ev = evaluate(dsa({ attendance: "" }));
    expect(ev.attMarks).toBeNull();
    expect(ev.cie).toBe(25.38);
    expect(ev.cie).toBe(computeCie(dsa({ attendance: 45 })));
  });

  it("spends the duty-leave-adjusted percentage, not the raw one", () => {
    // 14/18 is 77.78% (3 marks). Two DL classes are claimed but only 1.8 are
    // credited, at the 10% cap on 18 held, which lifts it to 87.78% (5 marks)
    // - and the CIE has to move with it.
    const raw = computeCie(dsa({ attended: 14, held: 18 }));
    const withDl = computeCie(dsa({ attended: 14, held: 18, dl: 2 }));
    expect(withDl - raw).toBe(2);
  });

  it("prefers the raw counts over a stale published percentage", () => {
    const stale = computeCie(dsa({ attendance: 60, attended: 14, held: 18, dl: 2 }));
    expect(stale).toBe(computeCie(dsa({ attendance: 87.78 })));
  });

  it("reports the marks earned on the same scale the CIE spends them", () => {
    // `attMax` is per-type by design, so the displayed figure has to follow
    // the spec rather than the module default - a ledger quoting /5 while the
    // CIE spends out of 10 is the same drift the single derivation kills.
    // No shipped type differs today, so stand one up and put it back.
    const key: TypeKey = "TH 40/60";
    const shipped = COURSE_TYPES[key];
    COURSE_TYPES[key] = { ...shipped, attMax: 10 };
    try {
      expect(evaluate(dsa({ attendance: 90 })).attMarks).toBe(10);
    } finally {
      COURSE_TYPES[key] = shipped;
    }
  });

  it("does not top up a published internal total with attendance marks", () => {
    // The college's own internal already contains its attendance component;
    // adding five more would count them twice.
    const c = dsa({ cie_override: 37, attendance: 90 });
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

describe("a blank attendance field is not invented as 100%", () => {
  it("leaves attendance, eligibility and attendance marks unknown", () => {
    const ev = evaluate(blankCourse("PCCST777", "Blank Att", 4));
    expect(ev.attendance).toBeNull();
    expect(ev.eligible).toBeNull();
    expect(ev.attMarks).toBeNull();
  });

  it("reports PENDING, not SAFE and not DEBARRED", () => {
    const ev = evaluate(blankCourse("PCCST777", "Blank Att", 4));
    expect(statusFor(ev)).toBe("PENDING");
  });

  it("keeps an unassessed, unknown-attendance course out of lowAttendance", () => {
    const summary = summarise([blankCourse("PCCST777", "Blank Att", 4)]);
    expect(summary.lowAttendance).not.toContain("PCCST777");
    expect(summary.pending).toBe(1);
  });

  it("does not report SHORTAGE or DEBARRED once the course is graded, if attendance is still unknown", () => {
    const course: Course = {
      ...blankCourse("PCCST778", "Graded, No Att", 4, "TH 40/60"),
      s1: 50, s2: 50, other: 10, ese: 50,
    };
    const ev = evaluate(course);
    expect(ev.attendance).toBeNull();
    expect(ev.eligible).toBeNull();
    const status = statusFor(ev);
    expect(status).not.toBe("SHORTAGE");
    expect(status).not.toBe("DEBARRED");
  });

  it("does not let duty-leave-adjusted attendance stay hidden behind a blank raw field", () => {
    // The percentage field is blank, but attended/held counts are present -
    // the plan.current figure must still surface, exactly as it does when the
    // portal also published a raw percentage.
    const ev = evaluate({
      ...blankCourse("PCCST779", "DL Only", 4), attendance: "", attended: 30, held: 40,
    });
    expect(ev.attendance).toBe(75);
    expect(ev.eligible).toBe(true);
  });
});

describe("SGPA and percentage", () => {
  it("weights grade points by credits", () => {
    expect(sgpa([[4, 10.0], [2, 5.5]])).toBe(8.5);
  });

  it("uses percentage = 10 x CGPA, with no legacy fudge", () => {
    expect(cgpaFromSemesters({
      S1: { sgpa: 8.5, creditsRegistered: 20, creditsEarned: 20 },
    }).percent).toBe(85.0);
  });
});

describe("registered credits are the CGPA denominator", () => {
  // The traced case from the audit. S3 carries one 4-credit F: 20 credits
  // registered, 16 earned, and the printed SGPA of 4.75 already scores that
  // F as zero grade points. Weighting the semester by 16 instead of 20 lets
  // the worst semester count for less than the student sat for.
  //   registered: (9.55x20 + 4.75x20) / 40 = 286 / 40      = 7.15
  //   earned:     (9.55x20 + 4.75x16) / 36 = 267 / 36      = 7.417
  const traced = {
    S1: { sgpa: 9.55, creditsRegistered: 20, creditsEarned: 20 },
    S3: { sgpa: 4.75, creditsRegistered: 20, creditsEarned: 16 },
  };

  it("weights a semester with a backlog by what was registered", () => {
    const out = cgpaFromSemesters(traced);
    expect(out.cgpa).toBe(7.15);
    expect(out.credits).toBe(40);
    expect(out.unconfirmed).toEqual([]);
  });

  it("would read 7.417 if the earned total were weighted instead", () => {
    // Not a rule - this is the defect, pinned so it cannot come back.
    expect(cgpaFromSemesters({
      ...traced,
      S3: { sgpa: 4.75, creditsRegistered: 16, creditsEarned: 16 },
    }).cgpa).toBe(7.417);
  });

  it("falls back to the earned total only when nothing registered is known", () => {
    expect(historyCredits({ sgpa: 4.75, creditsRegistered: 20, creditsEarned: 16 })).toBe(20);
    expect(historyCredits({ sgpa: 4.75, creditsRegistered: null, creditsEarned: 16 })).toBe(16);
    expect(historyCredits({ sgpa: 4.75, creditsRegistered: null, creditsEarned: null })).toBe(0);
  });

  it("names every semester it had to fall back on, and only those", () => {
    // A save written before the two totals were told apart. The CGPA is the
    // old one rather than a silent correction, and says so.
    const out = cgpaFromSemesters({
      ...traced,
      S3: { sgpa: 4.75, creditsRegistered: null, creditsEarned: 16 },
    });
    expect(out.unconfirmed).toEqual(["S3"]);
    expect(out.cgpa).toBe(7.417);
  });

  it("has nothing to report on an empty history", () => {
    const out = cgpaFromSemesters({});
    expect([out.cgpa, out.credits]).toEqual([0, 0]);
    expect(out.unconfirmed).toEqual([]);
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
  const history = {
    S1: { sgpa: 8.0, creditsRegistered: 20, creditsEarned: 20 },
    S2: { sgpa: 8.0, creditsRegistered: 20, creditsEarned: 20 },
  };

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

describe("an untouched eseMax === 0 course is not graded on attendance alone", () => {
  it("leaves a blank PRJ 100/0 with good attendance ungraded and PENDING", () => {
    // Attendance alone fills the 5-mark R 7.5.ii slot and makes cie nonzero,
    // but nobody has entered a single series mark - grading that would be
    // grading attendance, not project work.
    const course: Course = { ...blankCourse("PCCST601", "Project", 4, "PRJ 100/0"), attendance: 90 };
    const ev = evaluate(course);
    expect(ev.cie).toBeGreaterThan(0);
    expect(ev.assessed).toBe(false);
    expect(ev.grade).toBeNull();
    expect(ev.total).toBeNull();
    expect(statusFor(ev)).toBe("PENDING");
  });

  it("keeps that course out of sgpaConfirmed", () => {
    const course: Course = { ...blankCourse("PCCST601", "Project", 4, "PRJ 100/0"), attendance: 90 };
    const summary = summarise([course]);
    expect(summary.pending).toBe(1);
    expect(summary.sgpaConfirmed).toBe(0);
  });

  it("still grades a PRJ 100/0 once a component is entered", () => {
    // The gate is on `assessed`, not on eseMax === 0 wholesale - real project
    // marks must still resolve to a grade.
    const course: Course = {
      ...blankCourse("PCCST602", "Project", 4, "PRJ 100/0"),
      s1: 50, s2: 40, other: 10, attendance: 90,
    };
    const ev = evaluate(course);
    expect(ev.assessed).toBe(true);
    expect(ev.grade).not.toBeNull();
  });
});

describe("a published grade is never read as UNREACHABLE or TIGHT", () => {
  it("shows SAFE, not UNREACHABLE, for a finished LAB 75/25 with no CIE entered", () => {
    // A grade-card import carries the letter but no marks, so `cie` is 0 - a
    // reverse-solve off that 0 would say the pass is impossible, but the
    // grade already settles it.
    const course: Course = {
      ...blankCourse("PCCST701", "Networks Lab", 3, "LAB 75/25"), portal_grade: "A",
    };
    const ev = evaluate(course);
    expect(ev.needPass.possible).toBe(false);
    expect(ev.grade).toBe("A");
    expect(statusFor(ev)).toBe("SAFE");
  });

  it("does not show TIGHT for a published P on a TH 40/60 with no CIE entered", () => {
    const course: Course = {
      ...blankCourse("PCCST702", "Seminar", 2, "TH 40/60"), portal_grade: "P",
    };
    const ev = evaluate(course);
    expect(ev.grade).toBe("P");
    expect(statusFor(ev)).not.toBe("TIGHT");
    expect(statusFor(ev)).toBe("SAFE");
  });
});
