/**
 * Port of test_core.py. Same checks, same expected values.
 *
 * These are the spec for the engine, not a smoke test: every case here
 * encodes a KTU rule that was verified against the Regulations 2024 PDF or a
 * live grade card. If one of them fails, the app is lying to a student.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN, COURSE_TYPES, DL_CAP_PCT, NO_HORIZON,
  TYPE_KEYS, attendanceMarks, attendancePlan, blankCourse, cgpaFromSemesters,
  computeCie, courseOptions, eseCutoff, evaluate, horizonToGraduation,
  nextAttendanceBand, normaliseGrade, parseEtlab, historyCredits, planForSgpa, requiredEse,
  requiredSgpaForCgpa, sgpa, statusFor, summarise,
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
  // Fitted to the figures the audit published - CGPA 7.15 where the app read
  // 7.417 - because the grade card behind that trace is not in this repo. The
  // shape is the real one: S3 carries a single 4-credit F, so 20 credits
  // registered against 16 earned, and its printed SGPA of 4.75 already scores
  // that F as zero grade points. Weighting the semester by 16 instead of 20
  // lets the worst semester count for less than the student sat for.
  //   registered: (9.55x20 + 4.75x20) / 40 = 286 / 40 = 7.15
  //   earned:     (9.55x20 + 4.75x16) / 36 = 267 / 36 = 7.417
  // The same defect on a parsed grade card is in state/__tests__/history.
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

  it("grows the cap with the classes attended, when climbing back", () => {
    // 60/100 with 100 days of DL claimed: today only 10 are creditable, so the
    // portal reads 70%. Attend n and the cap is 10% of (100+n), not of 100.
    // At n=15: 75/115 attended, 11.5 creditable, 86.5/115 = 75.2%. At n=14 it
    // is 85.4/114 = 74.9%. Crediting 10 up front asks for 20.
    const plan = attendancePlan(60, 100, 100)!;
    expect(plan.current).toBe(70);
    expect(plan.state).toBe("deficit");
    expect(plan.attend).toBe(15);
  });

  it("grows the cap with the classes held, when spending a surplus", () => {
    // 140/200 with 30 days claimed: 20 creditable today, so 160/200 = 80%.
    // Skipping raises held, which raises the cap - at 15 skips the cap is 21.5
    // and 161.5/215 = 75.1%; at 16 it is 161.6/216 = 74.8%. Holding the credit
    // at today's 20 would say 13.
    const plan = attendancePlan(140, 200, 30)!;
    expect(plan.current).toBe(80);
    expect(plan.state).toBe("surplus");
    expect(plan.skip).toBe(15);
  });

  it("leaves the budget alone when the claim already fits under the cap", () => {
    // 5 days claimed against 200 held is nowhere near the 20 allowed, so the
    // growing cap never binds and the answer is the plain 155/(200+s) >= 75%.
    const plan = attendancePlan(150, 200, 5)!;
    expect(plan.current).toBe(77.5);
    expect(plan.skip).toBe(6);
  });

  it("grows the cap when pricing the next attendance mark too", () => {
    // Same 60/100 with 100 claimed: 70% earns 2 marks, and the 75% band that
    // pays 3 is 15 consecutive classes away, not 20.
    const band = nextAttendanceBand(60, 100, 100)!;
    expect([band.earned, band.nextMarks, band.atPct]).toEqual([2, 3, 75]);
    expect(band.attend).toBe(15);
  });

  it("gives an answer that survives being played out", () => {
    // The algebra above is worth only as much as the semester it predicts, so
    // this replays every plan against the arithmetic the college would do at
    // the end of it: the answer must clear 75%, and one class cheaper must
    // not. Both directions matter - an answer that is merely safe is the
    // failure the fix is about.
    const played = (attended: number, held: number, claimed: number) =>
      (Math.min(attended + Math.min(claimed, held * (DL_CAP_PCT / 100)), held) / held) * 100;

    const wrong: string[] = [];
    for (let held = 1; held <= 120; held += 1) {
      for (let attended = 0; attended <= held; attended += 1) {
        for (const dl of [0, 1, 3, 7, 12, 40, 500]) {
          const plan = attendancePlan(attended, held, dl)!;
          const at = `${attended}/${held} dl ${dl}`;
          if (plan.state === "surplus") {
            const s = plan.skip;
            if (played(attended, held + s, dl) < ATTENDANCE_MIN) wrong.push(`${at}: skip ${s} drops below`);
            if (played(attended, held + s + 1, dl) >= ATTENDANCE_MIN) wrong.push(`${at}: skip ${s} leaves room`);
          } else {
            const n = plan.attend!;
            if (played(attended + n, held + n, dl) < ATTENDANCE_MIN) wrong.push(`${at}: attend ${n} falls short`);
            if (n > 0 && played(attended + n - 1, held + n - 1, dl) >= ATTENDANCE_MIN) {
              wrong.push(`${at}: attend ${n} is one too many`);
            }
          }
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
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
    expect(requiredSgpaForCgpa(8.0, history, 20, NO_HORIZON).required).toBe(8.0);
  });

  it("flags a CGPA that is already out of reach", () => {
    expect(requiredSgpaForCgpa(9.9, history, 20, NO_HORIZON).possible).toBe(false);
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

describe("a graduation CGPA goal is not a this-semester SGPA goal", () => {
  /**
   * The case the app's owner hit: four semesters at 23 registered credits,
   * weighted mean 7.09, 21 credits registered in the active S5. Targeting an
   * 8.0 CGPA "by the end of S5" needs 11.99 and reads as out of reach; over
   * the semesters he actually has left it is an average he can attempt.
   */
  const history = {
    S1: { sgpa: 6.5, creditsRegistered: 23, creditsEarned: 23 },
    S2: { sgpa: 7.0, creditsRegistered: 23, creditsEarned: 23 },
    S3: { sgpa: 7.3, creditsRegistered: 23, creditsEarned: 23 },
    S4: { sgpa: 7.56, creditsRegistered: 23, creditsEarned: 23 },
  };

  it("reads the horizon off the student's own record, not a programme total", () => {
    expect(cgpaFromSemesters(history).cgpa).toBe(7.09);
    // S6, S7, S8 are left, and his own semesters have averaged 23 credits.
    expect(horizonToGraduation("S5", history, 21)).toEqual({ semesters: 3, credits: 69 });
  });

  it("spreads the target across every semester left instead of demanding it now", () => {
    const need = requiredSgpaForCgpa(8.0, history, 21, horizonToGraduation("S5", history, 21));
    // (8.0 * (92 + 90) - 652.28) / 90
    expect(need.required).toBe(8.93);
    expect(need.possible).toBe(true);
    expect(need.horizon).toEqual({ semesters: 3, credits: 69 });
  });

  it("reproduces the one-semester solve when the horizon is zero", () => {
    const need = requiredSgpaForCgpa(8.0, history, 21, NO_HORIZON);
    expect(need.required).toBe(11.987);
    expect(need.possible).toBe(false);
    expect(need.reason).toBe("even all-S this semester tops out at 7.63");
  });

  it("has no horizon left in S8, so the answer collapses to the old one", () => {
    const last = horizonToGraduation("S8", history, 21);
    expect(last).toEqual({ semesters: 0, credits: 0 });
    expect(requiredSgpaForCgpa(8.0, history, 21, last))
      .toEqual(requiredSgpaForCgpa(8.0, history, 21, NO_HORIZON));
  });

  it("takes no horizon from a semester name it cannot read", () => {
    expect(horizonToGraduation("Semester 5", history, 21)).toEqual({ semesters: 0, credits: 0 });
  });

  it("falls back to this semester's credits, then to 20, for the per-semester load", () => {
    expect(horizonToGraduation("S5", {}, 21)).toEqual({ semesters: 3, credits: 63 });
    expect(horizonToGraduation("S5", {}, 0)).toEqual({ semesters: 3, credits: 60 });
  });

  it("still reports impossibility when even all-S over the horizon falls short", () => {
    const need = requiredSgpaForCgpa(9.9, history, 21, horizonToGraduation("S5", history, 21));
    expect(need.possible).toBe(false);
    // (652.28 + 10 * 90) / 182
    expect(need.ceiling).toBe(8.529);
    expect(need.reason).toBe("even all-S across the 4 semesters left tops out at 8.53");
  });

  it("names the semesters whose weight it had to guess at", () => {
    const shaky = { ...history, S2: { sgpa: 7.0, creditsRegistered: null, creditsEarned: 23 } };
    expect(requiredSgpaForCgpa(8.0, shaky, 21, NO_HORIZON).unconfirmed).toEqual(["S2"]);
    expect(requiredSgpaForCgpa(8.0, history, 21, NO_HORIZON).unconfirmed).toEqual([]);
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

describe("an ungraded course is not a zero-CIE course", () => {
  /** Four marked theory papers plus a mini project nobody has evaluated yet. */
  const semester = (): Course[] => [
    { ...blankCourse("PCCST501", "CN", 4), cie_override: 30 },
    { ...blankCourse("PCCST502", "DAA", 4), cie_override: 30 },
    { ...blankCourse("PCCST503", "OS", 4), cie_override: 30 },
    { ...blankCourse("PCCST504", "SE", 3), cie_override: 30 },
    blankCourse("PBLST506", "Mini Project", 2, "PBL 60/40"),
  ];

  it("plans a semester that contains one, instead of giving up on all of it", () => {
    const plan = planForSgpa(semester(), 7.5);
    expect(plan.reachable).toBe(true);
    expect(plan.plan.length).toBe(5);
    expect(plan.plan.map((row) => row.code)).toContain("PBLST506");
  });

  it("prices its ladder from a full CIE, as the least each grade could cost", () => {
    const options = courseOptions(blankCourse("PBLST506", "Mini Project", 2, "PBL 60/40"));
    expect(options.map((o) => o.grade)).toEqual(["P", "D", "C", "C+", "B", "B+", "A", "A+", "S"]);
    expect(options.every((o) => o.unassessed)).toBe(true);
    // A full 60-mark CIE leaves 30 of the 40-mark ESE for the 90 an S needs...
    expect(options.find((o) => o.grade === "S")!.ese).toBe(30);
    // ...while a pass still costs the 40% ESE cutoff, which no CIE can buy off.
    expect(options.find((o) => o.grade === "P")!.ese).toBe(16);
  });

  it("prices an assessed course from its real CIE, and says so", () => {
    const options = courseOptions({ ...blankCourse("PCCST501", "CN", 4), cie_override: 30 });
    expect(options.some((o) => o.unassessed)).toBe(false);
    // CIE 30 of 40: a pass needs 20 more, above the 24-mark cutoff it is not.
    expect(options.find((o) => o.grade === "P")!.ese).toBe(24);
  });

  it("carries the assumption into the plan rather than burying it", () => {
    const plan = planForSgpa(semester(), 7.5);
    const pbl = plan.plan.find((row) => row.code === "PBLST506")!;
    expect(pbl.unassessed).toBe(true);
    expect(plan.plan.filter((row) => row.unassessed).length).toBe(1);
  });
});

describe("a debarred course is not planned as a pass", () => {
  const attending: Course = {
    ...blankCourse("PCCST501", "CN", 4), cie_override: 30, attended: 90, held: 100,
  };
  /** 40% attended: below the 60% floor R 6.2 allows the Principal to condone. */
  const debarred: Course = {
    ...blankCourse("PCCST502", "DAA", 4), cie_override: 30, attended: 40, held: 100,
  };

  it("keeps it out of the projected SGPA", () => {
    const sum = summarise([attending, debarred]);
    expect(sum.sgpaProjected).toBe(summarise([attending]).sgpaProjected);
    expect(sum.assessed).toBe(1);
    expect(sum.lowAttendance).toContain("PCCST502");
    // Its credits are still registered, whatever becomes of them.
    expect(sum.credits).toBe(8);
  });

  it("keeps it out of the plan, and names what it dropped", () => {
    const plan = planForSgpa([attending, debarred], 7.5);
    expect(plan.reachable).toBe(true);
    expect(plan.plan.map((row) => row.code)).toEqual(["PCCST501"]);
    expect(plan.credits).toBe(4);
    expect(plan.reason).toContain("PCCST502");
  });

  it("says so by name when every course is debarred", () => {
    const plan = planForSgpa([debarred], 7.5);
    expect(plan.reachable).toBe(false);
    expect(plan.reason).toContain("PCCST502");
  });

  it("plans an unknown attendance normally - it is not a debarment", () => {
    const blank: Course = { ...blankCourse("PCCST503", "OS", 4), cie_override: 30 };
    expect(evaluate(blank).attendance).toBeNull();
    const plan = planForSgpa([attending, blank], 7.5);
    expect(plan.plan.map((row) => row.code).sort()).toEqual(["PCCST501", "PCCST503"]);
    expect(plan.reason).toBeUndefined();
  });

  it("lets a published grade outrank the debarment", () => {
    const graded: Course = { ...debarred, portal_grade: "B+" };
    expect(summarise([graded]).sgpaProjected).toBe(8.0);
    const plan = planForSgpa([attending, graded], 7.5);
    expect(plan.plan.map((row) => row.code).sort()).toEqual(["PCCST501", "PCCST502"]);
  });
});

describe("an internal-only course is not free grade points", () => {
  const project = (): Course => blankCourse("PRJST501", "Project", 4, "PRJ 100/0");
  const papers = (): Course[] => [
    { ...blankCourse("PCCST501", "CN", 4), cie_override: 25 },
    { ...blankCourse("PCCST502", "DAA", 4), cie_override: 25 },
  ];

  it("reports every grade open at no exam marks, because there is no exam", () => {
    // Truthful - and useless to the planner, which is why it excludes these.
    const options = courseOptions(project());
    expect(options.length).toBe(9);
    expect(options.every((o) => o.ese === 0 && o.eseMax === 0 && o.unassessed)).toBe(true);
  });

  it("does not climb an unmarked one to an S and call the target met", () => {
    const plan = planForSgpa([...papers(), project()], 7.5);
    expect(plan.plan.map((row) => row.code)).not.toContain("PRJST501");
    expect(plan.reason).toContain("PRJST501");
    // 8 credits of real papers, not 12 - and they have to carry the target
    // themselves rather than being subsidised by a grade nobody earned.
    expect(plan.credits).toBe(8);
    expect(plan.plan.every((row) => row.ese > 0)).toBe(true);
  });

  it("plans one whose internals are marked, since the CIE is the whole grade", () => {
    const marked: Course = { ...project(), cie_override: 86 };
    const plan = planForSgpa([...papers(), marked], 7.5);
    const row = plan.plan.find((r) => r.code === "PRJST501")!;
    expect(row.grade).toBe("A+");
    // eseMax 0 is what tells the screen not to call this an exam mark.
    expect(row.eseMax).toBe(0);
    expect(row.unassessed).toBe(false);
  });
});

describe("a withdrawn or incomplete course is not a failure", () => {
  /**
   * Three graded papers and one the student withdrew from. KTU leaves a
   * withdrawn course out of the SGPA until it is completed - out of the
   * denominator too, which is the part that scoring it as an F gets wrong.
   */
  const semester = (): Course[] => [
    { ...blankCourse("PCCST301", "DBMS", 4), portal_grade: "A" },
    { ...blankCourse("PCCST302", "DSA", 4), portal_grade: "B" },
    { ...blankCourse("PCCST303", "OOP", 3), portal_grade: "C" },
    { ...blankCourse("PCCST304", "Economics", 3), portal_grade: "W" },
  ];

  it("reads I and W as themselves, and AB as the fail it is", () => {
    expect(normaliseGrade("W")).toBe("W");
    expect(normaliseGrade("i")).toBe("I");
    // A student marked absent was admitted to the exam and did not appear.
    // That is a real fail and stays one.
    expect(normaliseGrade("AB")).toBe("F");
    expect(normaliseGrade("FE")).toBe("F");
  });

  it("neither grades nor totals the course, and says INCOMPLETE", () => {
    const ev = evaluate({ ...blankCourse("PCCST304", "Economics", 3), portal_grade: "W",
                          cie_override: 30, attendance: 40 });
    expect(ev.grade).toBe("W");
    expect(ev.total).toBeNull();
    expect(ev.failedReason).toBe("");
    // Withdrawal outranks the attendance the course was carrying when the
    // student left it - there is no exam to be debarred from any more.
    expect(statusFor(ev)).toBe("INCOMPLETE");
  });

  it("computes the SGPA over the other three courses' credits only", () => {
    const sum = summarise(semester());
    // (4*8.5 + 4*7.5 + 3*6.5) / 11 = 83.5 / 11. Scored as an F over 14
    // credits it would read 5.964, which is a different student.
    expect(sum.sgpaConfirmed).toBe(7.591);
    expect(sum.sgpaProjected).toBe(7.591);
    expect(sum.credits).toBe(11);
    expect(sum.creditsConfirmed).toBe(11);
    expect(sum.assessed).toBe(3);
    expect(sum.pending).toBe(0);
    expect(sum.atRisk).toEqual([]);
  });

  it("offers no grades in a course nobody is sitting", () => {
    expect(courseOptions({ ...blankCourse("PCCST304", "Economics", 3),
                           portal_grade: "W" })).toEqual([]);
  });

  it("leaves it out of the plan, credits and all, and names why", () => {
    const plan = planForSgpa(semester(), 7.5);
    expect(plan.plan.map((row) => row.code).sort())
      .toEqual(["PCCST301", "PCCST302", "PCCST303"]);
    expect(plan.credits).toBe(11);
    expect(plan.reason).toContain("PCCST304 left out: withdrawn");
  });

  it("names an incomplete course as incomplete rather than as withdrawn", () => {
    const plan = planForSgpa(
      [semester()[0]!, { ...blankCourse("PCCST305", "Physics", 3), portal_grade: "I" }], 7.5);
    expect(plan.reason).toContain("PCCST305 left out: incomplete");
  });
});
