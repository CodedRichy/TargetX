/**
 * Port of test_core.py. Same checks, same expected values.
 *
 * These are the spec for the engine, not a smoke test: every case here
 * encodes a KTU rule that was verified against the Regulations 2024 PDF or a
 * live grade card. If one of them fails, the app is lying to a student.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN, COURSE_TYPES, DL_CAP_PCT,
  GRADE_BANDS, GRADE_MIN, GRADE_POINTS, NO_HORIZON,
  TYPE_KEYS, attendanceMarks, attendancePlan, blankCourse, cgpaFromSemesters,
  computeCie, courseOptions, eseCutoff, evaluate, horizonToGraduation, isIncomplete,
  nextAttendanceBand, normaliseGrade, parseEtlab, historyCredits, planForSgpa, requiredEse,
  requiredEseCell, requiredSgpaForCgpa, round, sgpa, statusFor, summarise,
} from "../index";
import fixture from "./parity.json";
import type { Course, Grade, Letter, TypeKey } from "../types";

describe("CIE scaling", () => {
  it("scales each component onto its weight inside a 40-mark CIE", () => {
    const c: Course = { ...blankCourse("PCCST302", "DSA", 4, "TH 40/60"), s1: 40, s2: 30, other: 8 };
    // Components share cieMax - attMax = 35, so the weights are 13.125/13.125/8.75:
    // 40/50*13.125 + 30/50*13.125 + 8/10*8.75 = 10.5 + 7.875 + 7 = 25.375.
    // Attendance is blank, so its component cannot be priced and the sum is a
    // lower bound - not a claim that none of those marks were earned. The
    // scaling is what is under test here; `evaluate` is where the bound is
    // flagged and the grade withheld.
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

describe("an unknown attendance is not spent as a zero inside the CIE", () => {
  /**
   * The seam between two rules: attendance is worth 5 CIE marks (R 7.5.ii),
   * and a blank field is unknown rather than zero. Summing them as zero grades
   * the course a whole band low and files the result as confirmed - a number
   * the app does not have the data to state.
   */
  const os = (extra: Partial<Course> = {}): Course => ({
    ...blankCourse("PCCST504", "OS", 4, "TH 40/60"),
    s1: 45, s2: 45, other: 9, ese: 42, ...extra,
  });

  it("withholds the grade instead of deriving one from a floor", () => {
    const unknown = evaluate(os());
    const known = evaluate(os({ attendance: 90 }));

    // Components alone: 45/50*13.125 + 45/50*13.125 + 9/10*8.75 = 31.5. The
    // same 31.5 either way - what changes is whether the missing 5 marks are
    // spent as earned-nothing or left unpriced.
    expect(unknown.cie).toBe(31.5);
    expect(known.cie).toBe(36.5);
    expect(unknown.cieIncomplete).toBe(true);
    expect(known.cieIncomplete).toBe(false);

    // 31.5 + 42 = 73.5 is a B and 36.5 + 42 = 78.5 is a B+. One band apart on
    // marks nobody has recorded, so neither total nor grade may be stated.
    expect(unknown.total).toBeNull();
    expect(unknown.grade).toBeNull();
    expect(statusFor(unknown)).toBe("PENDING");
    expect(known.total).toBe(78.5);
    expect(known.grade).toBe("B+");
    expect(statusFor(known)).toBe("SAFE");
  });

  it("keeps the withheld course out of the confirmed SGPA, and out of lowAttendance", () => {
    const withheld = summarise([os()]);
    expect(withheld.sgpaConfirmed).toBe(0);
    expect(withheld.creditsConfirmed).toBe(0);
    // Registered credits do not leave the semester - only the grade point does.
    expect(withheld.credits).toBe(4);
    // Unknown is not a shortage. Task 3's rule, and it still holds here.
    expect(withheld.lowAttendance).toEqual([]);
    // Still projected against its target, exactly like an unwritten exam.
    expect(withheld.sgpaProjected).toBe(8.0);

    expect(summarise([os({ attendance: 90 })]).sgpaConfirmed).toBe(8.0);
  });

  it("tells a recorded 0% apart from an unrecorded attendance", () => {
    // 0% is evidence. It earns no attendance marks, and the grade that
    // follows is real - the same B the unknown case was wrongly reporting.
    const zero = evaluate(os({ attendance: 0 }));
    expect(zero.cieIncomplete).toBe(false);
    expect(zero.attMarks).toBe(0);
    expect(zero.cie).toBe(31.5);
    expect(zero.total).toBe(73.5);
    expect(zero.grade).toBe("B");
    // Below the condonation floor, so it is debarred rather than safe.
    expect(statusFor(zero)).toBe("DEBARRED");

    expect(evaluate(os()).attMarks).toBeNull();
    expect(evaluate(os()).grade).toBeNull();
  });

  it("leaves a published grade and a published internal total alone", () => {
    // Published beats derived. Neither of these needs the attendance figure:
    // the university's letter is final, and a college's internal total
    // already contains its own attendance marks.
    const graded = evaluate(os({ portal_grade: "A" }));
    expect(graded.cieIncomplete).toBe(true);
    expect(graded.grade).toBe("A");
    expect(statusFor(graded)).toBe("SAFE");
    expect(summarise([os({ portal_grade: "A" })]).sgpaConfirmed).toBe(8.5);

    const override = evaluate(os({ cie_override: 30 }));
    expect(override.cieIncomplete).toBe(false);
    expect(override.total).toBe(72);
    expect(override.grade).toBe("B");
  });

  it("still plans a semester whose attendance has not been synced", () => {
    // The core loop must survive a failed attendance scrape: every course
    // unplannable would leave the student with no route at all.
    const plan = planForSgpa([
      { ...os(), ese: null },
      { ...os(), code: "PCCST505", ese: null },
    ], 7.0);
    expect(plan.plan.length).toBe(2);
    expect(plan.credits).toBe(8);
    // Priced from the best CIE each course can still reach, so every rung is
    // the least that grade could cost and says so.
    expect(plan.plan.every((row) => row.cieUnknown)).toBe(true);
    // But NOT guaranteed, and this assertion read `reachable: true` until the
    // attendance interval was closed. Both rungs are priced off a CIE that
    // includes 5 attendance marks nobody has recorded: score the quoted 29 and
    // the percentage turns out low and the grade is a C, not the C+ quoted. A
    // route is still owed - that is what the rest of this test is for - but
    // calling it a guarantee made the app more confident with the field blank
    // than with a real 62% in it.
    expect(plan.reachable).toBe(false);
    expect(plan.conditional).toBe(true);
    expect(plan.bound).toEqual(["PCCST504", "PCCST505"]);
    expect(plan.plan.map((row) => [row.grade, row.ese, row.secured]))
      .toEqual([["C+", 29, "C"], ["C+", 29, "C"]]);
    expect(plan.sgpa).toBe(7);
    expect(plan.sgpaGuaranteed).toBe(6.5);
  });

  it("does not climb an internal-only course whose attendance is missing", () => {
    // PRJ 100/0 has no exam, so an unsettled CIE would offer every letter at
    // zero marks and the greedy would buy an S with nothing.
    const project: Course = {
      ...blankCourse("PRJST501", "Project", 4, "PRJ 100/0"), s1: 50, s2: 50, other: 10,
    };
    const ev = evaluate(project);
    expect(ev.cieIncomplete).toBe(true);
    expect(ev.grade).toBeNull();

    const plan = planForSgpa([
      { ...blankCourse("PCCST501", "CN", 4), cie_override: 25 },
      { ...blankCourse("PCCST502", "DAA", 4), cie_override: 25 },
      project,
    ], 7.5);
    expect(plan.plan.map((row) => row.code)).not.toContain("PRJST501");
    expect(plan.reason).toContain("attendance is not recorded");
    // Out of the ROUTE, not out of the arithmetic: its four credits are
    // registered and stay in the denominator the target was solved over.
    expect(plan.credits).toBe(12);
    expect(plan.unpriced).toEqual(["PRJST501"]);
  });
});

describe("an unknown attendance is not spent as a full CIE either", () => {
  /**
   * The other end of the same null. Refusing to read a blank attendance as a
   * zero is half the fix: the ladder then read it as a whole empty CIE bucket
   * and offered grades the recorded marks had already ruled out. Zero and
   * `cieMax` are the same mistake with the sign flipped, and this one made a
   * student's number BETTER than the truth, which is the kind they act on.
   *
   * TH 40/60, 4 credits, 10/50 and 10/50 in the series, 2/10 elsewhere:
   * 10/50*13.125 + 10/50*13.125 + 2/10*8.75 = 2.625 + 2.625 + 1.75 = 7. With
   * attendance unrecorded the CIE lies in [7, 12], so the best total the
   * course can reach is 12 + 60 = 72 - a B. Nothing above B is on the table
   * at any exam mark, and the bucket's 40 is not a bound the course allows.
   */
  const weak = (): Course => ({
    ...blankCourse("H1", "Hard", 4, "TH 40/60"), s1: 10, s2: 10, other: 2,
  });

  it("bounds the CIE by the marks recorded, not by the size of the bucket", () => {
    const ev = evaluate(weak());
    expect(ev.cie).toBe(7);
    expect(ev.cieIncomplete).toBe(true);
    expect(ev.cieMax).toBe(40);
    expect(ev.cieCeiling).toBe(12);
    // Read off the top of the interval: 12 + 60 = 72.
    expect(ev.maxPossibleGrade).toBe("B");
  });

  /**
   * The one test here that must pass on the commit BEFORE the flag existed as
   * well as on this one. It asserts only the property both are owed - nothing
   * unattainable is on the ladder - because the pricing that broke it was a
   * REGRESSION: the earlier code was wrong in the safe direction and offered
   * too few grades, and a test that pinned the exact set would hide that.
   */
  it("offers no grade that 60 out of 60 could not reach", () => {
    for (const option of courseOptions(weak())) {
      // 12 at the very best, plus the whole exam: 72. `courseOptions` walks
      // GRADE_BANDS, so an offered grade is always a Letter and never an F.
      expect(GRADE_MIN[option.grade as Letter]).toBeLessThanOrEqual(72);
    }
    const plan = planForSgpa([weak()], 9.0);
    expect(plan.reachable).toBe(false);
    expect(plan.plan).toEqual([]);
  });

  it("prices each rung off the top of the interval, not off the whole bucket", () => {
    const offered = courseOptions(weak());
    expect(offered.every((o) => o.cieUnknown)).toBe(true);
    // Not merely safe - tight. The floor-priced version stopped at C+.
    expect(offered.map((o) => o.grade)).toEqual(["P", "D", "C", "C+", "B"]);
    // B is 70 in total and the CIE can reach 12, so 58 of 60 is the least the
    // exam could be asked for. Off the empty bucket it read 30.
    expect(offered.find((o) => o.grade === "B")!.ese).toBe(58);
    // A pass is 50 in total, so 38 - above the 24-mark ESE cutoff, which is
    // what the floor-priced version was quoting.
    expect(offered.find((o) => o.grade === "P")!.ese).toBe(38);
    expect(planForSgpa([weak()], 9.0).maxSgpa).toBe(7.5);
  });

  it("leaves a course with nothing marked at all priced from the bucket", () => {
    // Every component is still open there, and so is the attendance, so the
    // whole bucket genuinely is available and the ladder is unchanged.
    const fresh = blankCourse("H2", "Fresh", 4, "TH 40/60");
    const ev = evaluate(fresh);
    expect(ev.assessed).toBe(false);
    expect(ev.cieCeiling).toBe(40);
    expect(courseOptions(fresh).find((o) => o.grade === "S")!.ese).toBe(50);
  });

  it("does not file a course as unreachable over marks nobody has recorded", () => {
    // PRJ 100/0, internals all marked, attendance blank: floor 47.5, ceiling
    // 52.5, and a pass is 50 - so a pass is genuinely open. Read off the
    // floor, the rollup called the course impossible and projected it at an F
    // while its own row read PENDING.
    const project: Course = {
      ...blankCourse("PRJ1", "Project", 4, "PRJ 100/0"), s1: 25, s2: 25, other: 5,
    };
    const ev = evaluate(project);
    expect(ev.cie).toBe(47.5);
    expect(ev.cieCeiling).toBe(52.5);
    expect(ev.maxPossibleGrade).toBe("P");
    expect(statusFor(ev)).toBe("PENDING");

    const sum = summarise([project]);
    expect(sum.impossible).toEqual([]);
    expect(sum.sgpaProjected).toBe(5.5);
  });

  it("counts it as a third state, neither pending nor settled", () => {
    const marked = (code: string): Course => ({
      ...blankCourse(code, "Paper", 4, "TH 40/60"), s1: 45, s2: 45, other: 9,
    });
    const sum = summarise([marked("A1"), marked("B1")]);
    // Assessed, so `pending` never sees them; ungraded, so nothing is
    // confirmed. Without the third count a screen reads "every subject has
    // been assessed" over a confirmed SGPA of zero.
    expect(sum.pending).toBe(0);
    expect(sum.unsettled).toBe(2);
    expect(sum.assessed).toBe(2);
    expect(sum.creditsConfirmed).toBe(0);
    expect(sum.credits).toBe(8);

    // Attendance in, and the count clears even though the exams are unwritten.
    const settled = summarise([
      { ...marked("A1"), attendance: 90 }, { ...marked("B1"), attendance: 90 },
    ]);
    expect(settled.unsettled).toBe(0);
    expect(settled.pending).toBe(0);
    // Nothing has been marked here at all, so this one is pending instead.
    expect(summarise([blankCourse("C1", "New", 4)]).unsettled).toBe(0);
    expect(summarise([blankCourse("C1", "New", 4)]).pending).toBe(1);
  });

  it("keeps a settled course's ceiling at its own CIE", () => {
    // The interval collapses wherever the CIE is known, which is what keeps
    // every other course in the engine reading exactly as it did.
    const known = evaluate({
      ...blankCourse("D1", "Paper", 4, "TH 40/60"),
      s1: 45, s2: 45, other: 9, attendance: 90,
    });
    expect(known.cieIncomplete).toBe(false);
    expect(known.cieUnmarked).toBe(false);
    expect(known.cieFloor).toBe(false);
    // 90% earns all five attendance marks, so there is nothing left to reach.
    expect(known.cieCeiling).toBe(known.cie);
    expect(known.cieCeiling).toBe(36.5);

    // A published internal total is the college's own arithmetic, attendance
    // marks included, so it is settled with no attendance figure at all.
    const override = evaluate({ ...blankCourse("D2", "Paper", 4), cie_override: 30 });
    expect(override.cieIncomplete).toBe(false);
    expect(override.cieCeiling).toBe(30);
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

  it("can waste a fraction of a class, which is why the ledger rounds up", () => {
    // 47 held allows 4.7, so a 5-class claim wastes 0.3. Rounding a figure
    // like this to nearest for display would render it as 0 and drop the
    // warning entirely, which the legend promises never happens - hence the
    // `Math.ceil` in `Ledger.tsx` rather than `Math.round`.
    expect(attendancePlan(30, 47, 5)!.dlWasted).toBe(0.3);
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
    // 60/100 with 100 classes of DL claimed: only 10 are creditable today, so
    // the portal reads 70%. Attend n and the cap is 10% of (100+n), not 100.
    // At n=15: 75/115 attended, 11.5 creditable, 86.5/115 = 75.2%. At n=14 it
    // is 85.4/114 = 74.9%. Crediting 10 up front asks for 20.
    const plan = attendancePlan(60, 100, 100)!;
    expect(plan.current).toBe(70);
    expect(plan.state).toBe("deficit");
    expect(plan.attend).toBe(15);
  });

  it("grows the cap with the classes held, when spending a surplus", () => {
    // 140/200 with 30 classes claimed: 20 creditable today, so 160/200 = 80%.
    // Skipping raises held, which raises the cap - at 15 skips the cap is 21.5
    // and 161.5/215 = 75.1%; at 16 it is 161.6/216 = 74.8%. Holding the credit
    // at today's 20 would say 13.
    const plan = attendancePlan(140, 200, 30)!;
    expect(plan.current).toBe(80);
    expect(plan.state).toBe("surplus");
    expect(plan.skip).toBe(15);
  });

  it("stops clipping claim that a larger held has room for", () => {
    // 95/100 with 10 claimed sits exactly at the cap, so the cap is not what
    // moves here: today's 100% ceiling clips the credit at 100 and throws the
    // rest away. Skipping raises that ceiling along with held - at 40 skips
    // 105/140 = 75.0% clears, at 41 it is 105/141 = 74.5% and does not.
    // Dividing the clipped 100 instead says 33.
    const plan = attendancePlan(95, 100, 10)!;
    expect(plan.current).toBe(100);
    expect(plan.skip).toBe(40);
  });

  it("leaves the budget alone when the claim already fits under the cap", () => {
    // 5 classes claimed against 200 held is nowhere near the 20 allowed, so
    // the growing cap never binds: the answer is the plain 155/(200+s) >= 75%.
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
    expect(options.every((o) => o.cieUnknown)).toBe(true);
    // A full 60-mark CIE leaves 30 of the 40-mark ESE for the 90 an S needs...
    expect(options.find((o) => o.grade === "S")!.ese).toBe(30);
    // ...while a pass still costs the 40% ESE cutoff, which no CIE can buy off.
    expect(options.find((o) => o.grade === "P")!.ese).toBe(16);
  });

  it("prices an assessed course from its real CIE, and says so", () => {
    const options = courseOptions({ ...blankCourse("PCCST501", "CN", 4), cie_override: 30 });
    expect(options.some((o) => o.cieUnknown)).toBe(false);
    // CIE 30 of 40: a pass needs 20 more, above the 24-mark cutoff it is not.
    expect(options.find((o) => o.grade === "P")!.ese).toBe(24);
  });

  it("carries the assumption into the plan rather than burying it", () => {
    const plan = planForSgpa(semester(), 7.5);
    const pbl = plan.plan.find((row) => row.code === "PBLST506")!;
    expect(pbl.cieUnknown).toBe(true);
    expect(plan.plan.filter((row) => row.cieUnknown).length).toBe(1);
  });
});

describe("an unmarked component is unknown, not a zero", () => {
  /**
   * The same rule as the attendance one, on the other axis of the same sum.
   * A series exam nobody has marked yet is worth its whole weight still, so a
   * CIE summed without it is a floor - and reading a verdict off that floor
   * cost more than a wrong number: it stamped UNREACHABLE on a lab with one
   * mark in it, emptied its ladder, and took the whole semester's plan down
   * with it, because `planForSgpa` gives up when any course has no route.
   *
   * `LAB 75/25`, 2 credits, `s1 10/50` entered and attendance 90% synced -
   * ordinary mid-semester data. The floor is 13.4; 28 of the internal's marks
   * are simply not awarded yet, so the CIE can still reach 41.4.
   */
  const lab = (): Course => ({
    ...blankCourse("LAB1", "Lab", 2, "LAB 75/25"), s1: 10, attended: 90, held: 100,
  });
  const healthy = (): Course => ({
    ...blankCourse("PCCST501", "CN", 4), cie_override: 30, attended: 90, held: 100,
  });

  it("does not call a pass impossible over marks that are not in yet", () => {
    const ev = evaluate(lab());
    expect(ev.cie).toBe(13.4);
    expect(ev.cieCeiling).toBe(41.4);
    expect(ev.cieUnmarked).toBe(true);
    expect(ev.cieFloor).toBe(true);
    // The floor still prices the requirement, and off the floor a pass really
    // is impossible - which is exactly why nothing may ask it that question.
    expect(ev.needPass.possible).toBe(false);
    expect(ev.needPassBest.possible).toBe(true);
    expect(statusFor(ev)).toBe("PENDING");
    expect(summarise([lab()]).impossible).toEqual([]);
  });

  it("keeps one half-marked lab from destroying the whole semester's plan", () => {
    const options = courseOptions(lab());
    // 41.4 plus the 25-mark paper is 66.4, so C+ is the last rung and a pass
    // costs 10 - the 40% exam minimum, which no CIE can buy off.
    expect(options.map((o) => o.grade)).toEqual(["P", "D", "C", "C+"]);
    expect(options.find((o) => o.grade === "P")!.ese).toBe(10);
    expect(options.every((o) => o.cieUnknown)).toBe(true);

    const plan = planForSgpa([lab(), healthy()], 7.0);
    expect(plan.reachable).toBe(true);
    expect(plan.plan.map((row) => row.code).sort()).toEqual(["LAB1", "PCCST501"]);
    expect(plan.credits).toBe(6);
    expect(plan.reason).toBeUndefined();
  });

  it("does not confirm an F for a project with evaluations still to come", () => {
    // `PRJ 100/0` is graded on its internal alone, so a floor there went
    // straight into `sgpaConfirmed` as a hard F - 4 credits of confirmed
    // failure for a project with three evaluations left.
    const project: Course = {
      ...blankCourse("PRJ1", "Project", 4, "PRJ 100/0"), s1: 10, attended: 90, held: 100,
    };
    const ev = evaluate(project);
    expect(ev.cie).toBe(14.5);
    expect(ev.cieCeiling).toBe(62);
    expect(ev.grade).toBeNull();
    expect(ev.total).toBeNull();
    expect(statusFor(ev)).toBe("PENDING");

    const sum = summarise([project]);
    expect(sum.sgpaConfirmed).toBe(0);
    expect(sum.creditsConfirmed).toBe(0);
    expect(sum.unsettled).toBe(1);
  });

  it("reaches the same contradiction by the blank-component route", () => {
    // The attendance axis of this was fixed first; this is the identical
    // course reported unreachable and projected at zero for want of a mark
    // instead of for want of an attendance figure.
    const project: Course = {
      ...blankCourse("PRJZ", "Project", 4, "PRJ 100/0"), s1: 10,
    };
    const ev = evaluate(project);
    expect(ev.cieIncomplete).toBe(true);
    expect(ev.cieUnmarked).toBe(true);
    expect(ev.cieCeiling).toBe(62);
    expect(ev.maxPossibleGrade).toBe("C");
    expect(statusFor(ev)).toBe("PENDING");

    const sum = summarise([project]);
    expect(sum.impossible).toEqual([]);
    expect(sum.sgpaProjected).toBe(6.5);
    expect(sum.unsettled).toBe(1);
  });

  it("still states the F the exam minimum decides, floor or no floor", () => {
    // The one verdict that never reads the CIE: 9 of 50 is below the 40%
    // ESE minimum, and no internal mark still to come can buy it off. Refusing
    // to state it would drop a certain F out of the confirmed SGPA and leave
    // the average reading better than the truth.
    const failed: Course = {
      ...blankCourse("LAB2", "Lab", 3, "LAB 50/50"),
      s2: 33, other: 3, ese: 9, attended: 90, held: 100,
    };
    const ev = evaluate(failed);
    expect(ev.cieFloor).toBe(true);
    expect(ev.grade).toBe("F");
    expect(ev.failedReason).toBe("ESE 9 < cutoff 20");
    // The grade is known; the total is not, and is not invented.
    expect(ev.total).toBeNull();
    expect(statusFor(ev)).toBe("FAILED");
    expect(summarise([failed]).creditsConfirmed).toBe(3);
  });

  it("leaves a settled course exactly as it was", () => {
    const settled: Course = {
      ...blankCourse("PCCST504", "OS", 4), s1: 45, s2: 45, other: 9,
      attendance: 90, ese: 42,
    };
    const ev = evaluate(settled);
    expect(ev.cieFloor).toBe(false);
    expect(ev.cieCeiling).toBe(ev.cie);
    expect(ev.total).toBe(78.5);
    expect(ev.grade).toBe("B+");
    expect(statusFor(ev)).toBe("SAFE");
    expect(courseOptions(settled).every((o) => !o.cieUnknown)).toBe(true);
  });
});

describe("attendance marks are recoverable, and the ceiling says so", () => {
  /**
   * The other half of the ruling. A recorded 62% is not a permanent fact the
   * way a recorded series mark is: `attBand` on the same evaluation tells the
   * student how many classes buy the next mark, so a bound that froze
   * attendance where it stands would be the mirror of the `cieMax` error -
   * pessimistic instead of optimistic, but wrong in the same way.
   */
  const at62 = (extra: Partial<Course> = {}): Course => ({
    ...blankCourse("T1", "Theory", 4, "TH 40/60"), attended: 62, held: 100, ...extra,
  });

  it("prices the attendance component at its maximum even when it is known", () => {
    const ev = evaluate(at62({ s1: 45, s2: 45, other: 9 }));
    expect(ev.attMarks).toBe(1);
    expect(ev.cie).toBe(32.5);
    // 31.5 of components, and the four attendance marks still to be earned.
    expect(ev.cieCeiling).toBe(36.5);
    expect(ev.attBand).toEqual({ earned: 1, nextMarks: 2, attend: 27, atPct: 70 });
    // Every component is marked and the attendance figure is known, so nothing
    // is a floor and the grade is not withheld - only the ladder is a bound.
    expect(ev.cieFloor).toBe(false);
    expect(courseOptions(at62({ s1: 45, s2: 45, other: 9 }))
      .find((o) => o.grade === "S")!.ese).toBe(54);
  });

  it("keeps the whole bucket open for a course with nothing marked", () => {
    // The case that must NOT become pessimistic: low attendance and no marks
    // is a course with everything still to play for.
    const ev = evaluate(at62());
    expect(ev.assessed).toBe(false);
    expect(ev.cie).toBe(1);
    expect(ev.cieCeiling).toBe(40);
    expect(ev.cieCeiling).toBe(ev.cieMax);
    expect(courseOptions(at62()).find((o) => o.grade === "S")!.ese).toBe(50);
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

  it("projects it at the zero it is certain to score, credits and all", () => {
    const sum = summarise([attending, debarred]);
    // No grade is invented for an exam this student will not be admitted to -
    // but R 9.1 already names the grade point of the F they will be given, and
    // the credits stay registered. Dropping the course from the average
    // instead handed its four credits PCCST501's own B+, which is the one
    // assumption nobody made deliberately.
    expect(summarise([attending]).sgpaProjected).toBe(8);
    expect(sum.sgpaProjected).toBe(4);
    // Not counted as assessed: there is no verdict about it beyond the
    // attendance, whatever term it contributes to the projection.
    expect(sum.assessed).toBe(1);
    expect(sum.lowAttendance).toContain("PCCST502");
    // Its credits are still registered, whatever becomes of them.
    expect(sum.credits).toBe(8);
  });

  it("keeps it out of the route but not out of the denominator", () => {
    // 7.5 over both courses needs 60 points and only PCCST501 can earn any,
    // so the most on offer is an S in it: 40 points, an SGPA of 5.00.
    const plan = planForSgpa([attending, debarred], 7.5);
    expect(plan.reachable).toBe(false);
    expect(plan.conditional).toBeUndefined();
    expect(plan.credits).toBe(8);
    expect(plan.maxSgpa).toBe(5);
    expect(plan.reason).toContain("PCCST502 counted at zero: attendance below 60%");
  });

  it("plans the target it can actually reach over both courses", () => {
    // 4.0 over eight credits is 32 points, which is a B+ in the one course
    // that can still earn them.
    const plan = planForSgpa([attending, debarred], 4.0);
    expect(plan.reachable).toBe(true);
    expect(plan.plan.map((row) => row.code)).toEqual(["PCCST501"]);
    expect(plan.plan[0]!.grade).toBe("B+");
    expect(plan.credits).toBe(8);
    expect(plan.sgpa).toBe(4);
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
    expect(options.every((o) => o.ese === 0 && o.eseMax === 0 && o.cieUnknown)).toBe(true);
  });

  it("does not climb an unmarked one to an S and call the target met", () => {
    const plan = planForSgpa([...papers(), project()], 7.5);
    expect(plan.plan.map((row) => row.code)).not.toContain("PRJST501");
    expect(plan.reason).toContain("PRJST501 not priced");
    // Its four credits are registered, so the denominator is 12 - but no grade
    // point is invented for them, and the papers are asked to carry the target
    // rather than being subsidised by a grade nobody earned.
    expect(plan.credits).toBe(12);
    expect(plan.unpriced).toEqual(["PRJST501"]);
    expect(plan.plan.every((row) => row.ese > 0)).toBe(true);
  });

  it("plans one whose internals are marked, since the CIE is the whole grade", () => {
    const marked: Course = { ...project(), cie_override: 86 };
    const plan = planForSgpa([...papers(), marked], 7.5);
    const row = plan.plan.find((r) => r.code === "PRJST501")!;
    expect(row.grade).toBe("A+");
    // eseMax 0 is what tells the screen not to call this an exam mark.
    expect(row.eseMax).toBe(0);
    expect(row.cieUnknown).toBe(false);
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

/**
 * The goal solve and the goal plan have to divide by the same credits.
 *
 * `requiredSgpaForCgpa` is handed `summarise().credits`, so `planForSgpa` has
 * to price its route over that same total or the two are answers to different
 * questions - the seam that let a debarred course be counted in the target and
 * dropped from the route at the same time.
 */
describe("the target and the route divide by one denominator", () => {
  const paper = (code: string, attended: number): Course => ({
    ...blankCourse(code, code, 4), cie_override: 30, attended, held: 100,
  });

  it("does not promise a goal the route cannot reach", () => {
    // Two four-credit papers, one debarred, and a graduation goal of 8.0 from
    // a single past semester of 20 credits at 7.0.
    const courses = [paper("A", 90), paper("B", 40)];
    const history = { S1: { sgpa: 7.0, creditsRegistered: 20, creditsEarned: 20 } };
    const credits = summarise(courses).credits;
    expect(credits).toBe(8);

    const horizon = horizonToGraduation("S5", history, credits);
    const need = requiredSgpaForCgpa(8.0, history, credits, horizon);
    expect(need.required).toBe(8.294);
    expect(need.possible).toBe(true);

    const plan = planForSgpa(courses, need.required!);
    // 8.294 over eight credits is 66.35 points. B is debarred and will be
    // graded F, so only A can earn any, and an S in it is 40 - an SGPA of
    // 5.00 over the semester the goal was solved against.
    expect(plan.credits).toBe(credits);
    expect(plan.reachable).toBe(false);
    expect(plan.maxSgpa).toBe(5);
    expect(plan.plan).toEqual([]);
    expect(plan.reason).toContain("B counted at zero");
  });

  it("plans the shipped S7 preset over the credits it registers", () => {
    // The compulsory half of the CSE S7 preset: a four-credit project with no
    // exam and nothing marked, beside a two-credit paper. No debarment, no
    // withdrawal - this is what a student sees on the day they seed it.
    const courses: Course[] = [
      blankCourse("PCCSI706", "Project", 4, "PRJ 100/0"),
      blankCourse("UEHUT704", "Humanities", 2, "TH 50/50"),
    ];
    expect(summarise(courses).credits).toBe(6);

    const plan = planForSgpa(courses, 7.5);
    expect(plan.credits).toBe(6);
    expect(plan.unpriced).toEqual(["PCCSI706"]);
    // The paper alone cannot carry 7.5 across six credits: an S in it is 20 of
    // the 45 points needed. That is not "unreachable" - the project has not
    // been marked - so the route is still shown and the shortfall is named.
    expect(plan.reachable).toBe(false);
    expect(plan.conditional).toBe(true);
    expect(plan.plan.map((row) => row.code)).toEqual(["UEHUT704"]);
    expect(plan.plan[0]!.grade).toBe("S");
    expect(plan.sgpa).toBe(3.333);
    expect(plan.maxSgpa).toBe(10);
  });

  it("does not call a goal unreachable over one unmarked project", () => {
    // Same shape, a target the paper alone still cannot cover, and the answer
    // is a route plus a caveat rather than a bare refusal.
    const courses: Course[] = [
      blankCourse("PCCSI706", "Project", 4, "PRJ 100/0"),
      { ...blankCourse("UEHUT704", "Humanities", 2, "TH 50/50"), cie_override: 40 },
    ];
    const plan = planForSgpa(courses, 6.0);
    expect(plan.reachable).toBe(false);
    expect(plan.conditional).toBe(true);
    expect(plan.plan.length).toBe(1);
    expect(plan.reason).toContain("PCCSI706 not priced");
  });

  it("still refuses a target that is out of reach at every end", () => {
    // 9.5 across six credits is 57 points; the project at an S is 40 and the
    // paper at an S is 20, so 60 clears it - but 10.0 needs 60 exactly and
    // anything above it cannot be met however the project lands.
    const courses: Course[] = [
      blankCourse("PCCSI706", "Project", 4, "PRJ 100/0"),
      blankCourse("UEHUT704", "Humanities", 2, "TH 50/50"),
    ];
    expect(planForSgpa(courses, 9.5).conditional).toBe(true);
    const over = planForSgpa(courses, 10.5);
    expect(over.reachable).toBe(false);
    expect(over.conditional).toBeUndefined();
    expect(over.maxSgpa).toBe(10);
    expect(over.reason).toContain("target is above the best still available");
  });

  it("keeps a withdrawal out of both, the way summarise does", () => {
    const courses: Course[] = [
      { ...blankCourse("PCCST501", "CN", 4), cie_override: 30, attended: 90, held: 100 },
      { ...blankCourse("PCCST504", "Economics", 3), portal_grade: "W" },
    ];
    expect(summarise(courses).credits).toBe(4);
    const plan = planForSgpa(courses, 7.5);
    expect(plan.credits).toBe(4);
    expect(plan.unpriced).toBeUndefined();
    expect(plan.reason).toBe("PCCST504 left out: withdrawn");
  });

  it("divides by summarise's credits on every corpus semester", () => {
    // The property the seam broke, held over all 60 semesters of the parity
    // corpus: whenever a plan reports a denominator at all, that denominator
    // is the one the goal was solved against.
    //
    // A standing guard rather than the proof of the fix. Measured at the base
    // commit, the old planner stated a denominator on only 34 of these 180
    // answers - it returned early without one everywhere else - and on those
    // 34 it happened to agree, because no corpus semester pairs a debarred or
    // unpriced course with a plan that completes. The cases above are what
    // catch the seam; this is what keeps it caught.
    const rows = (fixture.semesters as unknown as Array<{ courses: Course[] }>);
    const bad: string[] = [];
    let compared = 0;
    rows.forEach(({ courses }, i) => {
      const want = summarise(courses).credits;
      for (const target of [5.0, 7.5, 9.0]) {
        const got = planForSgpa(courses, target).credits;
        if (got === undefined) continue;
        compared += 1;
        if (got !== want) bad.push(`semester ${i} at ${target}: ${got} vs ${want}`);
      }
    });
    expect(bad.slice(0, 3).join(" | ")).toBe("");
    // Not vacuous: 57 of the 60 semesters report a denominator at all three
    // targets. The other three register no credits at all - `summarise` gives
    // them 0 and the plan declines to state a total - so there is nothing to
    // compare and nothing hidden by the skip.
    expect(compared).toBe(171);
    expect(rows.filter(({ courses }) => summarise(courses).credits === 0).length).toBe(3);
  });
});

describe("a requirement is quoted at the end the rest of the app is solved against", () => {
  // Every component marked, so the internal is not a floor - but attendance is
  // 80%, so one of the five R 7.5.ii marks is still to be earned and the CIE
  // can still rise from 24.07 to 25.07. The requirement priced off each end is
  // a different answer, and one of them is the one every other verdict on the
  // row already uses.
  const lab = (): Course => ({
    ...blankCourse("PCCST504", "Networks Lab", 2, "LAB 75/25"),
    s1: 23, s2: 2, other: 0, attendance: 80,
  });

  it("prices the pass off the reachable CIE, not off today's", () => {
    const ev = evaluate(lab());
    expect(ev.cieFloor).toBe(false);
    expect([ev.cie, ev.cieCeiling]).toEqual([24.07, 25.07]);
    // 50 - 24.07 = 26 of a 25-mark paper; 50 - 25.07 = 25 of it.
    expect(ev.needPass).toMatchObject({ value: 26, possible: false });
    expect(ev.needPassBest).toMatchObject({ value: 25, possible: true });
    const cell = requiredEseCell(ev.needPass, ev.needPassBest);
    expect([cell.shown.text, cell.bound]).toEqual(["25/25", true]);
    // And the pill agrees, because it is solved off the same figure.
    expect(statusFor(ev)).toBe("TIGHT");
  });

  it("marks nothing where the requirement cannot fall", () => {
    // Fully marked at 62%: the CIE can still rise by 4 of the 5 attendance
    // marks, but the 40% ESE minimum is what binds, so the requirement is 24
    // of 60 at both ends and a bound marker would promise a fall that cannot
    // happen. This is why the marker asks whether the two figures differ
    // rather than whether the CIE can move.
    const th: Course = {
      ...blankCourse("PCCST505", "Compilers", 4, "TH 40/60"),
      s1: 45, s2: 45, other: 9, attendance: 62,
    };
    const ev = evaluate(th);
    expect(ev.cieCeiling).toBeGreaterThan(ev.cie);
    expect(ev.needPass.value).toBe(24);
    expect(ev.needPassBest.value).toBe(24);
    expect(requiredEseCell(ev.needPass, ev.needPassBest).bound).toBe(false);
    // The target can fall, though, so that column is marked on the same row.
    expect(ev.target).toBe("B+");
    expect([ev.needTarget.value, ev.needTargetBest.value]).toEqual([43, 39]);
    expect(requiredEseCell(ev.needTarget, ev.needTargetBest).shown.value).toBe(39);
  });

  it("never quotes an impossible pass beside a status that says otherwise", () => {
    // The property, over the whole parity corpus rather than over the two
    // rows above. Where the required-mark column applies at all - assessed,
    // not a floor, not a withdrawal - the figure it prints is impossible
    // exactly when `statusFor` calls the course unreachable.
    //
    // Measured on this corpus: 51 of the 612 courses print a marked bound,
    // and on 8 of them the floor-priced figure read "Impossible" where the
    // printed one does not. All 8 already carry a published grade, so the
    // corpus does not by itself reproduce the pill disagreement the LAB row
    // above does - what it adds is 612 real rows on which the pairing must
    // never invent one.
    const rows = (fixture.courses as unknown as Array<{ course: Course }>)
      .map(({ course }) => course);
    const bad: string[] = [];
    let rescued = 0;
    let bounded = 0;
    rows.forEach((course, i) => {
      const ev = evaluate(course);
      if (!ev.assessed || ev.cieFloor || isIncomplete(ev.grade)) return;
      const cell = requiredEseCell(ev.needPass, ev.needPassBest);
      // The floor-priced figure is never below the best-case one, or the
      // interval is upside down.
      if (ev.needPass.value < ev.needPassBest.value) bad.push(`case ${i}: floor below ceiling`);
      const tcell = requiredEseCell(ev.needTarget, ev.needTargetBest);
      if (cell.bound || tcell.bound) bounded += 1;
      if ((!ev.needPass.possible && cell.shown.possible)
          || (!ev.needTarget.possible && tcell.shown.possible)) rescued += 1;
      if (ev.grade !== null) return;
      const unreachable = statusFor(ev) === "UNREACHABLE";
      if (unreachable !== !cell.shown.possible) {
        bad.push(`case ${i}: cell ${cell.shown.text} vs status ${statusFor(ev)}`);
      }
    });
    expect(bad.slice(0, 3).join(" | ")).toBe("");
    expect(rows.length).toBe(612);
    expect(bounded).toBe(51);
    expect(rescued).toBe(8);
  });
});

describe("one course a student cannot pass is not a dead semester", () => {
  // Every component marked and 90% attendance, so the internal is settled at
  // 6.21 of 75 and cannot rise. A full 25-mark paper on top of it reaches
  // 31.21, under the 50 a pass needs, so this lab really is an F - the one
  // case where saying so is not a forecast.
  const dead = (): Course => ({
    ...blankCourse("DEAD", "Networks Lab", 2, "LAB 75/25"),
    s1: 1, s2: 1, other: 0, attendance: 90,
  });
  // The same lab with nobody's attendance recorded. The five attendance marks
  // are counted at their maximum either way, so the verdict does not move -
  // but the row reads PENDING, and the plan used to contradict it out loud.
  const deadUnrecorded = (): Course => ({ ...dead(), code: "DEADB", attendance: "" });
  const healthy = (): Course => ({
    ...blankCourse("PCCST501", "Networks", 4, "TH 40/60"),
    s1: 40, s2: 40, other: 8, attendance: 90,
  });

  it("plans the rest of the semester around it and names it", () => {
    // The premise first: this is an F at the TOP of its own internal, not
    // merely a bad row, which is what lets the plan count it at a known zero.
    const ev = evaluate(dead());
    expect(ev.cie).toBe(6.21);
    expect(ev.cieCeiling).toBe(6.21);
    expect(ev.needPassBest.possible).toBe(false);
    expect(ev.maxPossibleGrade).toBe("F");
    expect(courseOptions(dead())).toEqual([]);

    const plan = planForSgpa([dead(), healthy()], 6.0);
    expect(plan.reachable).toBe(true);
    expect(plan.plan.map((row) => row.code)).toEqual(["PCCST501"]);
    // 6.0 over both courses' 6 credits is 36 points, and the dead lab
    // contributes none of them, so the healthy course has to carry all 36
    // over its 4 credits: grade point 9, an A+, at 52 of 60.
    expect(plan.plan[0]!.grade).toBe("A+");
    expect(plan.plan[0]!.ese).toBe(52);
    expect(plan.sgpa).toBe(6.0);
    expect(plan.reason).toBe(
      "DEAD counted at zero: even full marks in the exam leave the total under 50",
    );
    // A course you cannot pass still counts against the SGPA, so its credits
    // stay in the denominator - the same total `summarise` reports. Dropping
    // them would divide 36 points by 4 and quote a target this semester does
    // not have.
    expect(plan.credits).toBe(6);
    expect(summarise([dead(), healthy()]).credits).toBe(6);
    // Not `conditional` either: nothing about this course is unknown, so the
    // answer is a number rather than a range.
    expect(plan.conditional).toBeUndefined();
    expect(plan.unpriced).toBeUndefined();
  });

  it("does not contradict a PENDING row when the attendance is blank", () => {
    expect(statusFor(evaluate(deadUnrecorded()))).toBe("PENDING");
    const plan = planForSgpa([deadUnrecorded(), healthy()], 6.0);
    expect(plan.reachable).toBe(true);
    expect(plan.plan.map((row) => row.code)).toEqual(["PCCST501"]);
    expect(plan.reason).toBe(
      "DEADB counted at zero: even full marks in the exam leave the total under 50",
    );
  });

  it("still refuses the target when the dead course is the whole semester", () => {
    const plan = planForSgpa([dead()], 6.0);
    expect(plan.reachable).toBe(false);
    expect(plan.maxSgpa).toBe(0);
    expect(plan.credits).toBe(2);
    expect(plan.reason).toBe(
      "target is above the best still available; "
      + "DEAD counted at zero: even full marks in the exam leave the total under 50",
    );
  });

  it("never ends a plan over an empty ladder, on any course the engine can build", () => {
    // Two properties over a pseudo-random corpus spanning every course type,
    // marks present and absent, attendance either side of both thresholds, an
    // exam mark or none, and the published grades that outrank all of it.
    //
    // First: a plan that offers no rows has to say what the best still
    // available was, and that best has to be under the target. A plan that
    // gives up while `maxSgpa` still covers the target has thrown away a route
    // it had, and one that gives up without stating `maxSgpa` at all has not
    // even looked - which is precisely what abandoning the whole semester over
    // one course did.
    //
    // Second: an empty ladder is exactly "no pass is left at the top of the
    // internal", because P is the cheapest letter on the board. That is what
    // lets `unplannable` carry this rather than the ladder loop, and checking
    // the two predicates against each other keeps the loop's remaining guard
    // the unreachable branch its comment says it is.
    const types: TypeKey[] = [...TYPE_KEYS];
    const grades = ["", "B+", "W", "I", "F"];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const maybe = (max: number) => (rnd() < 0.3 ? "" : Math.round(rnd() * max));
    let empty = 0;
    let notSat = 0;
    let disagreed = 0;
    const collapsed: string[] = [];
    for (let i = 0; i < 20000; i += 1) {
      const course: Course = {
        ...blankCourse(`C${i}`, "", 1 + Math.floor(rnd() * 4), types[Math.floor(rnd() * types.length)]!),
        s1: maybe(50), s2: maybe(50), other: maybe(10),
        attended: maybe(100), held: 100,
        ese: rnd() < 0.5 ? "" : Math.round(rnd() * 60),
        portal_grade: rnd() < 0.1 ? grades[Math.floor(rnd() * grades.length)]! : null,
      };
      const ev = evaluate(course);
      const noRungs = courseOptions(course).length === 0;
      if (noRungs) empty += 1;
      if (isIncomplete(ev.grade)) notSat += 1;
      const noPassLeft = isIncomplete(ev.grade)
        || (ev.grade === null && !ev.needPassBest.possible);
      if (noRungs !== noPassLeft) disagreed += 1;
      const plan = planForSgpa([course, healthy()], 6.0);
      if (plan.plan.length === 0 && !((plan.maxSgpa ?? Infinity) < 6.0 - 1e-9)) {
        collapsed.push(`${i}: ${plan.reason}`);
      }
    }
    expect(disagreed).toBe(0);
    expect(collapsed.slice(0, 3).join(" | ")).toBe("");
    // Not vacuous: 1345 of the 20000 courses have no rung to offer - 697 of
    // them published an I or a W, and the other 648 are the case this block is
    // about, a course still being sat whose best total cannot reach 50. Each
    // is paired with a healthy course whose own route has to survive it.
    expect(empty).toBe(1345);
    expect(notSat).toBe(697);
  });
});

/**
 * The projection divides by the same credits as the goal and the route.
 *
 * `requiredSgpaForCgpa` is solved over `summarise().credits` and `planForSgpa`
 * plans over that same total, which Task 11 reconciled. `sgpaProjected` was
 * the third denominator: it averaged only the courses it could price, so the
 * app compared a figure over part of the register against a requirement over
 * all of it. Every reader that subtracts one from the other - the off-target
 * banner, the shortfall it quotes, the goal gauge - was reading a difference
 * between two different questions.
 */
describe("the projection divides by the credits the goal is solved over", () => {
  const paper = (code: string, attended: number): Course => ({
    ...blankCourse(code, code, 4), cie_override: 30, attended, held: 100,
  });

  it("does not project a semester it cannot half of", () => {
    // The Task 11 case. A is on 30/40 with an exam to sit; B is debarred at
    // 40% and will be graded F over credits that stay registered.
    const courses = [paper("A", 90), paper("B", 40)];
    const sum = summarise(courses);
    expect(sum.credits).toBe(8);
    // Before: 8.00, A's projected B+ averaged over A's four credits alone,
    // beside a requirement solved over all eight.
    expect(sum.sgpaProjected).toBe(4);
    expect(sum.percentProjected).toBe(40);

    const history = { S1: { sgpa: 7.0, creditsRegistered: 20, creditsEarned: 20 } };
    const horizon = horizonToGraduation("S5", history, sum.credits);
    const need = requiredSgpaForCgpa(8.0, history, sum.credits, horizon);
    expect(need.required).toBe(8.294);
    // The banner's own arithmetic. It used to read "short by 0.29" on a
    // semester the route cannot take past 5.00; the shortfall is really 4.29.
    expect(round(need.required! - sum.sgpaProjected, 3)).toBe(4.294);
    // And it is now on the right side of the plan's own ceiling, which is the
    // check the two numbers existed to survive.
    const plan = planForSgpa(courses, need.required!);
    expect(plan.maxSgpa).toBe(5);
    expect(sum.sgpaProjected).toBeLessThanOrEqual(plan.maxSgpa!);
  });

  it("does not report a shortfall on a semester with nothing marked", () => {
    // The shipped CSE S7 preset on the day it is seeded. Before: an empty
    // projected population, so `sgpa([])` returned 0.00 and the banner
    // announced a 7.50 shortfall against a semester nobody has marked.
    const courses: Course[] = [
      blankCourse("PCCSI706", "Project", 4, "PRJ 100/0"),
      blankCourse("UEHUT704", "Humanities", 2, "TH 50/50"),
    ];
    const sum = summarise(courses);
    expect(sum.credits).toBe(6);
    expect(sum.pending).toBe(2);
    expect(sum.assessed).toBe(0);
    // Both courses can still reach the default B+ target, so both project it.
    expect(sum.sgpaProjected).toBe(8);

    const need = requiredSgpaForCgpa(7.5, {}, sum.credits, NO_HORIZON);
    expect(need.required).toBe(7.5);
    // `risky` in App.tsx and `short` in Home.tsx, verbatim.
    expect(need.required! > sum.sgpaProjected + 0.005).toBe(false);
    expect(Math.max(0, need.required! - sum.sgpaProjected)).toBe(0);
  });

  it("counts an unmarked course at what it can reach, never at zero", () => {
    // The repair that would have re-inflicted the pessimism of three fix
    // rounds: putting the unmarked project into the denominator at zero
    // points. Six credits at a B+ is 8.00; the project at a zero would read
    // 2.67 and the paper alone 8.00, and neither is what this returns.
    const courses: Course[] = [
      blankCourse("PCCSI706", "Project", 4, "PRJ 100/0"),
      { ...blankCourse("UEHUT704", "Humanities", 2, "TH 50/50"),
        s1: 50, s2: 50, other: 10, attended: 90, held: 100, ese: 50 },
    ];
    const sum = summarise(courses);
    // The paper is settled at an S; the project is unmarked and internal-only,
    // so the plan cannot price it at all - and the projection still counts it
    // at the target it can still reach.
    expect(sum.creditsConfirmed).toBe(2);
    expect(sum.sgpaConfirmed).toBe(10);
    expect(sum.sgpaProjected).toBe(round((4 * 8 + 2 * 10) / 6, 3));
    expect(sum.sgpaProjected).toBe(8.667);
    // Which is deliberately NOT the floor the route is guaranteed against.
    // `reachable` has to take the bottom of an open range; a forecast does not.
    const plan = planForSgpa(courses, 8.667);
    expect(plan.unpriced).toEqual(["PCCSI706"]);
    expect(plan.reachable).toBe(false);
    expect(plan.conditional).toBe(true);
    expect(plan.sgpa).toBe(3.333);
    expect(plan.maxSgpa).toBe(round((4 * 10 + 2 * 10) / 6, 3));
  });

  it("keeps a withdrawn course out of both ends and everything else in", () => {
    // The three treatments `unplannable` names, on one semester. `out` leaves
    // the register; `zero` stays in the denominator at a known zero; anything
    // that can still move counts what it can still reach.
    const courses: Course[] = [
      { ...blankCourse("OUT", "OUT", 4), portal_grade: "W", cie_override: 30 },
      paper("ZERO", 40),
      blankCourse("MOVES", "MOVES", 2, "PRJ 100/0"),
    ];
    const sum = summarise(courses);
    expect(sum.credits).toBe(6);
    expect(sum.sgpaProjected).toBe(round((4 * 0 + 2 * 8) / 6, 3));
    expect(sum.sgpaProjected).toBe(2.667);
    // The route divides by the same six and agrees about which course is out.
    expect(planForSgpa(courses, 5).credits).toBe(6);
  });

  it("recomputes over all 60 corpus semesters without an oracle", () => {
    // A property, not an expected value: the projection is the credit-weighted
    // mean over EVERY registered course, with the term each contributes fixed
    // by its own state. Ranges over the parity corpus, which the fixture is
    // still the source of even though these fields are not compared to it.
    const bad: string[] = [];
    let debarredTerms = 0;
    let unmarkedTerms = 0;
    const semesterRows = (fixture.semesters as unknown as Array<{ courses: Course[] }>)
      .map(({ courses }) => courses);
    semesterRows.forEach((rows, i) => {
      const got = summarise(rows);
      const terms: Array<[number, number]> = [];
      for (const c of rows) {
        const ev = evaluate(c);
        if (isIncomplete(ev.grade)) continue;
        if (ev.grade !== null) terms.push([ev.credits, GRADE_POINTS[ev.grade]]);
        else if (ev.attendance !== null && ev.attendance < ATTENDANCE_CONDONE) {
          terms.push([ev.credits, 0]);
          debarredTerms += 1;
        } else {
          if (!ev.assessed) unmarkedTerms += 1;
          terms.push([ev.credits, GRADE_POINTS[
            ev.needTargetBest.possible ? ev.target : ev.maxPossibleGrade]]);
        }
      }
      const credits = terms.reduce((sum, [c]) => sum + c, 0);
      if (credits !== got.credits) bad.push(`semester ${i}: credits ${credits} vs ${got.credits}`);
      if (sgpa(terms) !== got.sgpaProjected) {
        bad.push(`semester ${i}: projected ${sgpa(terms)} vs ${got.sgpaProjected}`);
      }
      // Nothing may be projected outside the scale, and the projection can
      // never beat the confirmed average by more than the scale allows.
      if (got.sgpaProjected < 0 || got.sgpaProjected > 10) bad.push(`semester ${i}: off scale`);
    });
    expect(bad.slice(0, 3).join(" | ")).toBe("");
    expect(bad.length).toBe(0);
    // Not vacuous, but only barely, and the thinness is the point of writing
    // the counts down. Every figure below is an assertion as well as a claim,
    // so a wrong one fails the suite instead of misleading a reader.
    //
    // The two populations this task added to the sum are each represented by
    // exactly ONE course in the whole corpus. The recomputation above
    // therefore ranges over real data but leans on a single instance of each;
    // the hand-written cases in this block carry the rest of the weight.
    const kinds = semesterRows.flat().map((c) => evaluate(c));
    expect(semesterRows.length).toBe(60);
    expect(kinds.length).toBe(276);
    expect(kinds.filter((ev) => isIncomplete(ev.grade)).length).toBe(0);
    expect(kinds.filter((ev) => ev.grade !== null).length).toBe(266);
    expect(kinds.filter((ev) => ev.grade === null).length).toBe(10);
    expect(debarredTerms).toBe(1);
    expect(unmarkedTerms).toBe(1);
    // Both live in semester 55, which is consequently the only one of the 60
    // whose projection this task moves at all: 5.143 at c698194, 5.778 here.
    // The `after` half is pinned so it cannot rot; the `before` half is a fact
    // about a commit and cannot.
    expect(summarise(semesterRows[55]!).sgpaProjected).toBe(5.778);
  });
});

/**
 * `reachable` has to survive the student doing exactly what the plan says.
 *
 * `courseOptions` prices its ladder off `Evaluation.cieCeiling`, which counts
 * the `attMax` attendance marks a student has not earned yet. That is the
 * right end to quote from - the alternative collapses ladders and writes off
 * courses that can still be passed - but summing the quoted GRADES then
 * promises a total the quoted MARKS do not secure. `PlanRow.secured` is the
 * other end of each row and `SgpaPlan.sgpaGuaranteed` is the sum of it.
 */
describe("the route guarantees what it quotes", () => {
  /** LAB 50/50, 4 credits, everything marked, 70 of 100 classes attended. */
  const lab = (): Course => ({
    ...blankCourse("P", "P", 4, "LAB 50/50"),
    s1: 10, s2: 12, other: 7, attended: 70, held: 100,
  });

  it("does not promise a pass the quoted mark does not buy", () => {
    const ev = evaluate(lab());
    // Nothing is unmarked and the attendance is recorded, so the CIE is not a
    // floor - it is exactly today's internal. It can still rise, but only by
    // the three attendance marks 70% has not earned.
    expect(ev.cieFloor).toBe(false);
    expect(ev.cie).toBe(16.04);
    expect(ev.cieCeiling).toBe(19.04);
    expect(ev.attMarks).toBe(2);

    const plan = planForSgpa([lab()], 5.5);
    // The quote is unchanged - 31 really is the least a pass could cost, and
    // the row still says so through `cieUnknown`.
    expect(plan.plan[0]!.ese).toBe(31);
    expect(plan.plan[0]!.grade).toBe("P");
    expect(plan.plan[0]!.cieUnknown).toBe(true);
    // What changed is the promise. Score 31 and attend nothing more and the
    // total is 16.04 + 31 = 47.04, an F - which is what `secured` says and
    // what `evaluate` confirms.
    expect(plan.plan[0]!.secured).toBe("F");
    expect(evaluate({ ...lab(), ese: 31 }).total).toBe(47.04);
    expect(evaluate({ ...lab(), ese: 31 }).grade).toBe("F");
    // At c698194 this plan read `reachable: true` with no caveat of any kind.
    expect(plan.reachable).toBe(false);
    expect(plan.conditional).toBe(true);
    expect(plan.bound).toEqual(["P"]);
    expect(plan.sgpa).toBe(5.5);
    expect(plan.sgpaGuaranteed).toBe(0);
  });

  /** TH 40/60, fully marked, 62% attended: CIE 29 today, 33 at its ceiling. */
  const th = (): Course => ({
    ...blankCourse("TH1", "TH1", 4, "TH 40/60"),
    s1: 40, s2: 40, other: 8, attended: 62, held: 100,
  });

  it("does not warn on a row whose requirement is the same at both ends", () => {
    const ev = evaluate(th());
    expect([ev.cie, ev.cieCeiling, ev.attMarks, ev.eseCutoff]).toEqual([29, 33, 1, 24]);
    // A pass costs max(50 - cie, 24) at either end, and the 40% ESE minimum
    // wins both times: a rising CIE buys the requirement down by nothing. So
    // the row is priced off a CIE that CAN move and is still not bound.
    const plan = planForSgpa([th()], 5.5);
    expect(plan.plan[0]!.ese).toBe(24);
    expect(plan.plan[0]!.cieUnknown).toBe(true);
    expect(plan.plan[0]!.secured).toBe("P");
    expect(plan.reachable).toBe(true);
    expect(plan.conditional).toBeUndefined();
    expect(plan.bound).toBeUndefined();
    expect(plan.sgpaGuaranteed).toBe(plan.sgpa);
  });

  it("warns on the same row when the requirement does differ", () => {
    // Same course, same attendance, harder target. B+ needs 75: 42 off the
    // ceiling and 46 off today's CIE, so 42 buys a B and not the B+ quoted.
    // The discriminator is the QUOTED REQUIREMENT, not the row.
    const plan = planForSgpa([th()], 8.0);
    expect(plan.plan[0]!.grade).toBe("B+");
    expect(plan.plan[0]!.ese).toBe(42);
    expect(plan.plan[0]!.secured).toBe("B");
    expect(plan.reachable).toBe(false);
    expect(plan.conditional).toBe(true);
    expect(plan.bound).toEqual(["TH1"]);
    expect(plan.sgpa).toBe(8);
    expect(plan.sgpaGuaranteed).toBe(7.5);
  });

  it("does not take an unmarked component off the guarantee", () => {
    // The pessimism this must not re-inflict. A LAB 75/25 with one series mark
    // in has 28 marks of unmarked components; taking those off as well as the
    // attendance would call its route unreachable, which is the exact failure
    // three of Task 10's fix rounds went into removing. Absence of a mark is
    // not a zero on this axis either - and here the attendance marks ARE all
    // earned, so nothing is outstanding at all.
    const half = (): Course => ({
      ...blankCourse("LAB1", "LAB1", 2, "LAB 75/25"), s1: 10, attended: 90, held: 100,
    });
    const ev = evaluate(half());
    expect([ev.cie, ev.cieCeiling, ev.attMarks, ev.cieFloor]).toEqual([13.4, 41.4, 5, true]);
    const plan = planForSgpa([half(), {
      ...blankCourse("OK", "OK", 4, "TH 40/60"), cie_override: 30, attended: 95, held: 100,
    }], 6.0);
    expect(plan.plan.find((r) => r.code === "LAB1")!.secured).toBe("P");
    expect(plan.reachable).toBe(true);
    expect(plan.bound).toBeUndefined();
    expect(plan.sgpaGuaranteed).toBe(plan.sgpa);
  });

  it("has nothing outstanding on a published internal, whatever the attendance", () => {
    // A published total already contains the college's own attendance marks,
    // so both ends of the CIE are that figure and nothing is owed - even at
    // 70%, where the course's own attendance is worth 2 of the 5 marks and a
    // subtraction off the ceiling would take the other 3 off a settled total.
    const pub: Course = {
      ...blankCourse("PUB", "PUB", 3, "TH 40/60"), cie_override: 30, attended: 70, held: 100,
    };
    const ev = evaluate(pub);
    expect([ev.cie, ev.cieCeiling, ev.attMarks]).toEqual([30, 30, 2]);
    const plan = planForSgpa([pub], 8.0);
    expect(plan.plan[0]!.secured).toBe("B+");
    expect(plan.reachable).toBe(true);
    expect(plan.sgpaGuaranteed).toBe(8);
  });

  it("does not grow more confident when the attendance field is emptied", () => {
    // The monotonicity inversion, and the sharpest statement of what a
    // collapsed interval costs. One TH 40/60, every component marked, only the
    // attendance evidence changing.
    const marked = (extra: Partial<Course>): Course => ({
      ...blankCourse("TH1", "TH1", 4, "TH 40/60"), s1: 30, s2: 30, other: 6, ...extra,
    });
    const recorded = marked({ attended: 62, held: 100 });
    const blank = marked({});
    expect(evaluate(recorded).attMarks).toBe(1);
    expect(evaluate(blank).attMarks).toBeNull();

    const withData = planForSgpa([recorded], 8.0);
    const withoutData = planForSgpa([blank], 8.0);
    // Same quote either way - the ladder is priced off the ceiling and that is
    // deliberate.
    expect(withData.plan[0]!.ese).toBe(49);
    expect(withoutData.plan[0]!.ese).toBe(49);
    // And now the same verdict either way. At 6b761ae the blank case read
    // `reachable: true`, `sgpaGuaranteed: 8`, `bound: undefined`,
    // `secured: "B+"` - strictly more confident about a student the app knew
    // strictly less about, and typing in a real 62% flipped it to unreachable.
    expect(withData.reachable).toBe(false);
    expect(withoutData.reachable).toBe(false);
    expect(withoutData.bound).toEqual(["TH1"]);
    expect(withoutData.plan[0]!.secured).toBe("B");
    expect(withoutData.sgpaGuaranteed).toBe(7.5);

    // And the promise the old bound made was false: score the quoted 49, let
    // the attendance turn out to be 50%, and the grade is a B.
    const executed = evaluate({ ...blank, attended: 50, held: 100, ese: 49 });
    expect(executed.total).toBe(70);
    expect(executed.grade).toBe("B");
    // Never worse than the recorded case, either: an unknown resolves to the
    // bottom of its interval, which is where a recorded 0% would put it.
    // Never better than the worst recorded case that still sits the exam: at
    // 60% - the lowest percentage that is not a debarment - the guarantee is
    // the same 7.5, because both secure a B.
    expect(planForSgpa([marked({ attended: 60, held: 100 })], 8.0).sgpaGuaranteed).toBe(7.5);
  });

  it("re-derives the discriminators it rejected, so the numbers cannot rot", () => {
    // `SgpaPlan.conditional` and `SgpaPlan.reachable` quote firing rates for
    // the two discriminators Task 15 measured and rejected. Nothing asserted
    // them, so they were right by luck. This re-derives all three from the
    // current engine over the population they describe - the clean one, every
    // component marked AND every attendance recorded, which is the population
    // in which the attendance interval is closed and the two ends of the CIE
    // differ only by marks the student has provably not yet earned.
    const types: TypeKey[] = [...TYPE_KEYS];
    let seed = 20000;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let plans = 0, anyCieUnknown = 0, anyBound = 0, notGuaranteed = 0;
    let cieUnknownButFine = 0, boundButFine = 0, harderRouteExists = 0;
    for (let i = 0; i < 20000; i += 1) {
      const courses: Course[] = [];
      const k = 2 + Math.floor(rnd() * 4);
      for (let j = 0; j < k; j += 1) {
        const type = types[Math.floor(rnd() * types.length)]!;
        courses.push({
          ...blankCourse(`C${j}`, `C${j}`, 1 + Math.floor(rnd() * 4), type),
          s1: Math.round(rnd() * 50), s2: Math.round(rnd() * 50), other: Math.round(rnd() * 10),
          attended: Math.round(rnd() * 100), held: 100,
        });
      }
      if (courses.some((c) => evaluate(c).cieFloor)) throw new Error("not the clean population");
      const target = round(1 + rnd() * 8, 2);
      const plan = planForSgpa(courses, target);
      // The ceiling gate rules these out before any of this applies.
      if (plan.plan.length === 0) continue;
      if (!plan.reachable && !plan.conditional) continue;
      plans += 1;
      const a = plan.plan.some((row) => row.cieUnknown);
      const b = (plan.bound?.length ?? 0) > 0;
      const c = !plan.reachable;
      if (a) anyCieUnknown += 1;
      if (b) anyBound += 1;
      if (c) notGuaranteed += 1;
      if (a && !c) cieUnknownButFine += 1;
      if (b && !c) boundButFine += 1;
      if (!c) continue;
      // `reachable`'s doc claims a harder route would have carried most of
      // these at today's internal. Re-derived here rather than asserted from
      // memory: the semester's ceiling priced off the CIE each course HOLDS,
      // against the same target.
      let floorCeiling = 0;
      for (const course of courses) {
        const ev = evaluate(course);
        if (isIncomplete(ev.grade)) continue;
        let best = 0;
        for (const [letter, , gp] of GRADE_BANDS) {
          if (requiredEse(ev.cie, letter, ev.eseMax).possible) best = Math.max(best, gp);
        }
        floorCeiling += best * ev.credits;
      }
      if (floorCeiling / plan.credits! >= target - 1e-9) harderRouteExists += 1;
    }
    // 5379 routes were reachable at c698194 and the same 5379 are the plans
    // seen here, because the route itself never changed - only the verdict on
    // it did. Of those: a row priced off a movable CIE is present on 3825 and
    // 1286 of them reach the target anyway; a row that is actually bound is
    // present on 3204 and 665 of them do; the chosen discriminator fires on
    // 2539 and, per the sweeps above, none of those reach it.
    expect(plans).toBe(5379);
    expect(anyCieUnknown).toBe(3825);
    expect(cieUnknownButFine).toBe(1286);
    expect(anyBound).toBe(3204);
    expect(boundButFine).toBe(665);
    expect(notGuaranteed).toBe(2539);
    // And the claim on `reachable` that `false` here does not mean "nothing
    // does": 2409 of the 2539 are still carried at today's internal by a route
    // the greedy stops short of, because it stops at the first one that covers
    // the target at the ceiling.
    expect(harderRouteExists).toBe(2409);
  });

  it("keeps the promise on every reachable route it builds", () => {
    // The sweep that certifies the guarantee, and the population is the whole
    // point of it. The version committed at 6b761ae threw away every course
    // whose CIE was a floor - `if (cieFloor) throw new Error("dirty input")` -
    // and an unrecorded attendance IS `cieFloor`, so the sweep excluded by
    // construction the exact class that broke the property it asserted. Its
    // `expect(broken).toBe(0)` was true of a population the counterexample had
    // been removed from. This one generates that class deliberately: roughly a
    // third of courses have no attendance recorded at all.
    //
    // Executing a route means scoring exactly the mark it quotes in every
    // course and changing nothing else. For a course with no attendance on
    // record there is nothing to change it TO, so the sweep draws a hidden true
    // percentage and executes against that - adversarially, over the whole
    // range in which the student is actually admitted to the exam (60% and up;
    // below that they are debarred and the plan's premise is gone, which is a
    // different failure).
    //
    // Components are always marked here, and that is a real limit rather than
    // a tidy one: the unmarked-component axis has the same defect and is a
    // disclosed open item, not something this property covers. The block below
    // measures it rather than hiding it.
    const types: TypeKey[] = [...TYPE_KEYS];
    let seed = 20000;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let reachable = 0, conditional = 0, broken = 0, unknownRows = 0;
    let boundViolated = 0, notExact = 0, blankSets = 0, reachableWithBlank = 0;
    for (let i = 0; i < 20000; i += 1) {
      const courses: Course[] = [];
      const truth = new Map<string, number>();
      const k = 2 + Math.floor(rnd() * 4);
      let anyBlank = false;
      for (let j = 0; j < k; j += 1) {
        const type = types[Math.floor(rnd() * types.length)]!;
        const credits = 1 + Math.floor(rnd() * 4);
        const blank = rnd() < 0.35;
        const recorded = Math.round(rnd() * 100);
        // Where the field is blank, what the percentage will turn out to be.
        const hidden = 60 + Math.round(rnd() * 40);
        const course: Course = {
          ...blankCourse(`C${j}`, `C${j}`, credits, type),
          s1: Math.round(rnd() * 50), s2: Math.round(rnd() * 50), other: Math.round(rnd() * 10),
        };
        if (blank) { anyBlank = true; truth.set(`C${j}`, hidden); } else {
          course.attended = recorded;
          course.held = 100;
          truth.set(`C${j}`, recorded);
        }
        courses.push(course);
      }
      // Every component is marked, so the only unsettled half is attendance.
      if (courses.some((c) => evaluate(c).cieUnmarked)) throw new Error("unmarked component");
      if (anyBlank) blankSets += 1;
      const target = round(1 + rnd() * 8, 2);
      const plan = planForSgpa(courses, target);
      if (plan.conditional) conditional += 1;
      if (plan.plan.some((row) => row.cieUnknown)) unknownRows += 1;
      if (!plan.reachable) continue;
      reachable += 1;
      if (anyBlank) reachableWithBlank += 1;
      const byCode = new Map(courses.map((c) => [c.code!, c]));
      let points = 0;
      for (const row of plan.plan) {
        const after = evaluate({
          ...byCode.get(row.code)!, attended: truth.get(row.code)!, held: 100, ese: row.ese,
        });
        points += (after.grade === null || isIncomplete(after.grade)
          ? 0 : GRADE_POINTS[after.grade as Grade]) * after.credits;
      }
      const got = round(points / plan.credits!, 3);
      if (got < target - 1e-9) broken += 1;
      if (got < plan.sgpaGuaranteed! - 1e-9) boundViolated += 1;
      if (!anyBlank && got !== plan.sgpaGuaranteed) notExact += 1;
    }
    // The promise, and the reason this task and its repair both exist. At
    // 6b761ae this same population produced 6240 reachable routes of which
    // 2395 then missed - every one of them carrying a blank-attendance course,
    // and none without one. The bound was violated on 3543.
    expect(broken).toBe(0);
    // `sgpaGuaranteed` is a genuine floor everywhere...
    expect(boundViolated).toBe(0);
    // ...and where every attendance is on record it is not merely a floor but
    // the figure execution actually yields. With a blank field it cannot be:
    // the percentage may turn out anywhere in its range, and the guarantee
    // takes the bottom.
    expect(notExact).toBe(0);
    // Every count is an assertion so a wrong one fails rather than misleads.
    // Non-vacuity first: the counterexample class the old sweep excluded is
    // present in 15138 of the 20000 semesters and survives into 1151 of the
    // reachable routes, so `broken === 0` is a statement about it and not a
    // statement about its absence.
    expect(blankSets).toBe(15138);
    expect(reachableWithBlank).toBe(1550);
    expect(reachable).toBe(2692);
    expect(conditional).toBe(6066);
    expect(unknownRows).toBe(8070);
  });

  it("does not cover the unmarked-component axis, and this is what that costs", () => {
    // The disclosed open item, pinned rather than described. `heldCie` keeps an
    // unmarked component at its whole weight on purpose - scoring it at zero is
    // a prediction about a paper that has not been sat, and it flips three of
    // the cases above from a route to no route at all - so a student whose
    // unwritten series exam comes in low can still miss a `reachable: true`
    // route. That is a real hole and it should fail here the day someone closes
    // it, rather than being discovered by a reader trusting the word
    // "guarantee".
    //
    // Same generator as the sweep above with one change: a quarter of courses
    // have `s2` unmarked.
    const types: TypeKey[] = [...TYPE_KEYS];
    let seed = 20000;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    let reachable = 0, broken = 0, boundViolated = 0;
    for (let i = 0; i < 20000; i += 1) {
      const courses: Course[] = [];
      const truth = new Map<string, number>();
      const k = 2 + Math.floor(rnd() * 4);
      for (let j = 0; j < k; j += 1) {
        const type = types[Math.floor(rnd() * types.length)]!;
        const credits = 1 + Math.floor(rnd() * 4);
        const blank = rnd() < 0.35;
        const recorded = Math.round(rnd() * 100);
        const hidden = 60 + Math.round(rnd() * 40);
        const s2 = rnd() < 0.25 ? "" : Math.round(rnd() * 50);
        const course: Course = {
          ...blankCourse(`C${j}`, `C${j}`, credits, type),
          s1: Math.round(rnd() * 50), s2, other: Math.round(rnd() * 10),
        };
        if (blank) truth.set(`C${j}`, hidden); else {
          course.attended = recorded;
          course.held = 100;
          truth.set(`C${j}`, recorded);
        }
        courses.push(course);
      }
      const target = round(1 + rnd() * 8, 2);
      const plan = planForSgpa(courses, target);
      if (!plan.reachable) continue;
      reachable += 1;
      const byCode = new Map(courses.map((c) => [c.code!, c]));
      let points = 0;
      for (const row of plan.plan) {
        // The unmarked component comes in at zero, which is the worst case the
        // ladder priced at its whole weight.
        const after = evaluate({
          ...byCode.get(row.code)!, s2: byCode.get(row.code)!.s2 === "" ? 0 : byCode.get(row.code)!.s2,
          attended: truth.get(row.code)!, held: 100, ese: row.ese,
        });
        points += (after.grade === null || isIncomplete(after.grade)
          ? 0 : GRADE_POINTS[after.grade as Grade]) * after.credits;
      }
      const got = round(points / plan.credits!, 3);
      if (got < target - 1e-9) broken += 1;
      if (got < plan.sgpaGuaranteed! - 1e-9) boundViolated += 1;
    }
    // The hole is real and this is its size. If either number reaches zero the
    // axis has been closed and this test should be deleted, not adjusted.
    expect(reachable).toBe(2532);
    expect(broken).toBe(741);
    expect(boundViolated).toBe(1174);
  });
});
