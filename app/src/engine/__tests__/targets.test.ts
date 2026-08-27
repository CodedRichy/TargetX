/**
 * Personal targets, and the line between them and the regulations.
 *
 * Two things are being pinned here. The first is the SPLIT: a student may aim
 * anywhere, including under a KTU threshold, and the engine has to say so
 * rather than either forbidding it or accepting it in silence. The second is
 * that AN UNSET TARGET IS UNKNOWN - never a zero, never a default quietly
 * substituted for a blank - which is the rule the rest of this engine is built
 * on and the one three fix rounds on the previous branch went into restoring.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_FULL_MARKS_PCT, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN,
  DEFAULT_ATTENDANCE_TARGET, GRADE_POINTS, PASSING_GPA_MIN, attendanceMarks,
  attendanceTargetGap, blankCourse, checkAttendanceTarget, checkGpaTarget,
  defaultTargets, evaluate, normaliseTargets, planForSgpa, reconcileSgpaTarget,
  sgpaTargetFor, summarise,
} from "../index";
import type { Targets } from "../index";

describe("the default attendance target teaches 85, not 75", () => {
  /**
   * The whole argument for the default, as arithmetic rather than as prose.
   *
   * 75 admits you to the exam. 85 is where R 7.5.ii finally pays all five CIE
   * marks. A student who treats 75 as the goal and lands exactly there has
   * given up 2 of the 5 marks before writing a word, and no portal anywhere
   * tells them that.
   */
  it("is the lowest attendance that pays every attendance mark", () => {
    expect(DEFAULT_ATTENDANCE_TARGET).toBe(85);
    expect(DEFAULT_ATTENDANCE_TARGET).toBe(ATTENDANCE_FULL_MARKS_PCT);
    expect(attendanceMarks(ATTENDANCE_FULL_MARKS_PCT)).toBe(ATTENDANCE_MARK_MAX);
    expect(attendanceMarks(ATTENDANCE_FULL_MARKS_PCT - 0.01)).toBeLessThan(ATTENDANCE_MARK_MAX);
  });

  it("sits above the eligibility threshold, and the gap costs 2 of the 5 marks", () => {
    expect(DEFAULT_ATTENDANCE_TARGET).toBeGreaterThan(ATTENDANCE_MIN);
    expect(attendanceMarks(ATTENDANCE_MIN)).toBe(3);
    expect(ATTENDANCE_MARK_MAX - (attendanceMarks(ATTENDANCE_MIN) ?? 0)).toBe(2);
  });

  it("takes the passing floor off the grade table rather than a literal", () => {
    expect(PASSING_GPA_MIN).toBe(5.5);
    expect(PASSING_GPA_MIN).toBe(GRADE_POINTS.P);
  });
});

describe("a saved goal widens into the full target set without losing anything", () => {
  /** The shape every save written before this branch holds. */
  const OLD_SAVE = { cgpa: 8 };

  it("keeps the CGPA target a student already set", () => {
    const out = normaliseTargets(OLD_SAVE);
    expect(out.cgpa).toBe(8);
    expect(out.attendance).toBe(DEFAULT_ATTENDANCE_TARGET);
    expect(out.sgpaBySemester).toEqual({});
    expect(out.sgpaDefault).toBeNull();
  });

  it("is idempotent, because a restored backup is an old file arriving later", () => {
    const once = normaliseTargets(OLD_SAVE);
    expect(normaliseTargets(once)).toEqual(once);
    const full: Targets = {
      cgpa: 8.5, attendance: 90, sgpaBySemester: { S3: 8, S4: 7.5 }, sgpaDefault: 8,
    };
    expect(normaliseTargets(full)).toEqual(full);
    expect(normaliseTargets(normaliseTargets(full))).toEqual(full);
  });

  it("survives the JSON round trip a save actually makes", () => {
    const stored: Targets = {
      cgpa: 8, attendance: null, sgpaBySemester: { S5: 7.25 }, sgpaDefault: null,
    };
    const reloaded = normaliseTargets(JSON.parse(JSON.stringify(stored)));
    expect(reloaded).toEqual(stored);
  });

  /**
   * The one place absent and null must not mean the same thing.
   *
   * Absent is a file from before the app had an attendance target: its student
   * never declined one, so they get the default. Null is a student who cleared
   * the field on purpose, and handing the default back would overrule them
   * every time they reopened the app.
   */
  it("tells a cleared attendance target apart from one never set", () => {
    expect(normaliseTargets({ cgpa: null, attendance: null }).attendance).toBeNull();
    expect(normaliseTargets({ cgpa: null }).attendance).toBe(DEFAULT_ATTENDANCE_TARGET);
  });

  it("starts a student with no goal on nothing but the attendance default", () => {
    expect(normaliseTargets(undefined)).toEqual(defaultTargets());
    expect(normaliseTargets(null)).toEqual(defaultTargets());
    expect(normaliseTargets("wat")).toEqual(defaultTargets());
    expect(defaultTargets().cgpa).toBeNull();
    expect(defaultTargets().sgpaDefault).toBeNull();
  });

  /**
   * Junk is not a target. It reads as cleared rather than as a zero - a stored
   * "" or NaN says nothing about what the student wants, and 0.0 is a claim.
   */
  it("drops what does not coerce instead of reading it as zero", () => {
    expect(normaliseTargets({ cgpa: "" }).cgpa).toBeNull();
    expect(normaliseTargets({ cgpa: "abc" }).cgpa).toBeNull();
    const out = normaliseTargets({ sgpaBySemester: { S1: 8, S2: "", S3: "nope" } });
    expect(out.sgpaBySemester).toEqual({ S1: 8 });
    expect(out.sgpaBySemester["S2"]).toBeUndefined();
  });

  /**
   * Out of scale is a typo, and clamping keeps it answerable: a CGPA target of
   * 10 gets an honest "even all-S tops out at ..." from `requiredSgpaForCgpa`,
   * where dropping it to null would just say no goal is set.
   */
  it("clamps a target off its own scale rather than dropping it", () => {
    expect(normaliseTargets({ cgpa: 47 }).cgpa).toBe(10);
    expect(normaliseTargets({ cgpa: -3 }).cgpa).toBe(0);
    expect(normaliseTargets({ attendance: 150 }).attendance).toBe(100);
    expect(normaliseTargets({ attendance: -5 }).attendance).toBe(0);
  });
});

describe("a target under a KTU threshold is allowed, and is named", () => {
  it("pays every mark at the full-marks band", () => {
    const check = checkAttendanceTarget(85);
    expect(check?.band).toBe("full");
    expect(check?.belowRegulation).toBe(false);
    expect(check?.marksAtTarget).toBe(5);
    expect(check?.marksForfeited).toBe(0);
  });

  it("calls 75 eligible and still short of 2 marks", () => {
    const check = checkAttendanceTarget(ATTENDANCE_MIN);
    expect(check?.band).toBe("eligible");
    expect(check?.belowRegulation).toBe(false);
    expect(check?.marksAtTarget).toBe(3);
    expect(check?.marksForfeited).toBe(2);
  });

  it("marks a target inside the R 6.2 condonation band as below the regulation", () => {
    const check = checkAttendanceTarget(70);
    expect(check?.band).toBe("condonation");
    expect(check?.belowRegulation).toBe(true);
    expect(check?.marksAtTarget).toBe(2);
    expect(check?.marksForfeited).toBe(3);
  });

  it("marks a target under the condonation floor as a debarment", () => {
    const check = checkAttendanceTarget(ATTENDANCE_CONDONE - 5);
    expect(check?.band).toBe("debarred");
    expect(check?.belowRegulation).toBe(true);
    expect(check?.marksAtTarget).toBe(0);
    expect(check?.marksForfeited).toBe(5);
  });

  it("says nothing at all when no target is set", () => {
    expect(checkAttendanceTarget(null)).toBeNull();
    expect(checkGpaTarget(null)).toBeNull();
  });

  it("names a GPA target that cannot be met with every course passed", () => {
    expect(checkGpaTarget(5)?.belowPassing).toBe(true);
    expect(checkGpaTarget(PASSING_GPA_MIN)?.belowPassing).toBe(false);
    expect(checkGpaTarget(8)?.belowPassing).toBe(false);
  });
});

describe("the SGPA target for a semester", () => {
  const targets = (patch: Partial<Targets>): Targets => ({ ...defaultTargets(), ...patch });

  it("prefers the semester's own, including one below the blanket target", () => {
    const t = targets({ sgpaBySemester: { S3: 6 }, sgpaDefault: 8.5 });
    expect(sgpaTargetFor(t, "S3")).toEqual({ value: 6, basis: "semester" });
  });

  it("falls back to the blanket target, and says that is where it came from", () => {
    const t = targets({ sgpaBySemester: { S3: 6 }, sgpaDefault: 8.5 });
    expect(sgpaTargetFor(t, "S4")).toEqual({ value: 8.5, basis: "default" });
  });

  it("reports no target as no target, never as a target of zero", () => {
    expect(sgpaTargetFor(defaultTargets(), "S1")).toEqual({ value: null, basis: "none" });
  });

  /**
   * The denominator invariant Task 11 established survives an SGPA target
   * arriving by a second route: the plan divides by every registered credit
   * bar the withdrawn and incomplete, whatever number it is chasing.
   */
  it("plans over the same credits `summarise` reports", () => {
    const courses = [
      { ...blankCourse("TH1", "Theory", 4, "TH 40/60"), s1: 30, s2: 30, other: 6, attendance: 90 },
      { ...blankCourse("LAB1", "Lab", 2, "LAB 50/50"), s1: 40, s2: 30, other: 8, attendance: 90 },
    ];
    const plan = planForSgpa(courses, 8);
    expect(plan.credits).toBe(summarise(courses).credits);
    expect(plan.credits).toBe(6);
  });
});

describe("distance to eligibility and distance to your own target are two answers", () => {
  /**
   * 80 of 100 held. Above the eligibility line and under the default target,
   * which is the ordinary mid-semester position and the one where quoting a
   * single number misleads: the student has room to skip six classes and stay
   * admitted to the exam, and simultaneously owes 34 consecutive classes to
   * stop losing CIE marks. Both figures are true of the same row.
   */
  const course = { ...blankCourse("TH1", "Theory", 4, "TH 40/60"), attended: 80, held: 100 };

  it("solves the same course against both floors", () => {
    const gap = attendanceTargetGap(course, DEFAULT_ATTENDANCE_TARGET);
    expect(gap.current).toBe(80);
    expect(gap.target).toBe(85);
    expect(gap.toEligible?.state).toBe("surplus");
    expect(gap.toEligible?.skip).toBe(6);
    expect(gap.toTarget?.state).toBe("deficit");
    expect(gap.toTarget?.attend).toBe(34);
    expect(gap.targetUnderEligibility).toBe(false);
  });

  it("flags a target that is not the stricter of the two", () => {
    const gap = attendanceTargetGap({ ...course, attended: 70 }, 70);
    expect(gap.targetUnderEligibility).toBe(true);
    // Read alone, the target half says there is nothing to do; the eligibility
    // half is the one that decides whether the student sits the exam.
    expect(gap.toTarget?.state).toBe("surplus");
    expect(gap.toEligible?.state).toBe("deficit");
    expect(gap.toEligible?.attend).toBe(20);
  });

  it("asks nothing of a student who set no target", () => {
    const gap = attendanceTargetGap(course, null);
    expect(gap.target).toBeNull();
    expect(gap.toTarget).toBeNull();
    expect(gap.toEligible?.skip).toBe(6);
  });

  it("has no answer at all without raw class counts", () => {
    const gap = attendanceTargetGap({ ...blankCourse("TH1"), attendance: 82 }, 85);
    expect(gap.toEligible).toBeNull();
    expect(gap.toTarget).toBeNull();
    expect(gap.current).toBe(82);
  });

  /**
   * The eligibility half is the SAME solve `evaluate` already runs, not a
   * second one beside it. Two derivations of one attendance figure drifting
   * apart is how a ledger row and a goal panel end up disagreeing about
   * whether a student is short.
   */
  it("is one solve with the ledger row, not a second opinion", () => {
    expect(attendanceTargetGap(course, 85).toEligible).toEqual(evaluate(course).plan);
  });
});

describe("a semester target and a CGPA goal that disagree", () => {
  it("reports the shortfall without overriding either", () => {
    const out = reconcileSgpaTarget(7.5, 8.294);
    expect(out.sufficient).toBe(false);
    expect(out.shortfall).toBe(0.794);
    expect(out.personal).toBe(7.5);
    expect(out.requiredForCgpa).toBe(8.294);
  });

  it("reports no shortfall when the semester target already covers the goal", () => {
    const out = reconcileSgpaTarget(8.5, 8.294);
    expect(out.sufficient).toBe(true);
    expect(out.shortfall).toBe(0);
  });

  it("stays unknown rather than false when either side is unset", () => {
    expect(reconcileSgpaTarget(null, 8.294)).toEqual({
      personal: null, requiredForCgpa: 8.294, shortfall: null, sufficient: null,
    });
    expect(reconcileSgpaTarget(7.5, null)).toEqual({
      personal: 7.5, requiredForCgpa: null, shortfall: null, sufficient: null,
    });
  });
});
