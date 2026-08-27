// @vitest-environment jsdom
/**
 * The 85-vs-75 sentence on Home.
 *
 * Home already showed what attendance costs. It never showed the line where
 * the cost stops, and that omission is the belief the product exists to
 * correct: a student at 78% is told by every other system that they are fine,
 * because 75% is the only threshold anyone quotes. The eligibility line and
 * the full-marks line are two different numbers and the tile now says both.
 *
 * Every figure asserted here was computed in this sitting from the engine, not
 * copied: the constants are re-derived below from `ATTENDANCE_MARK_BANDS` and
 * compared, so a change to the bands fails this file instead of leaving Home
 * quoting a rule KTU no longer has.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ATTENDANCE_FULL_MARKS_PCT, ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX,
  ATTENDANCE_MIN, attendanceMarks,
} from "../../engine";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";
import { Home } from "../Home";

afterEach(cleanup);

/** 78%: eligible, invisible to every other system, two marks down. */
const BLIND: Partial<Course> = {
  code: "CST303", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 39, held: 50, dl: 0,
};

/** 90%: eligible and already earning every attendance mark. */
const CLEAR: Partial<Course> = {
  code: "CST305", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 45, held: 50, dl: 0,
};

/** 70%: below the eligibility line, so NOT part of the blind-spot cohort. */
const SHORT: Partial<Course> = {
  code: "CST307", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 35, held: 50, dl: 0,
};

function seed(...courses: Partial<Course>[]) {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
  });
  courses.forEach((c, i) => { addCourse(); updateCourse(i, c); });
  return render(() => <Home />).container.textContent ?? "";
}

beforeEach(() => { edit((d) => { d.semesters = { S5: { courses: [] } }; d.activeSemester = "S5"; }); });

describe("the two attendance lines are different numbers", () => {
  it("derives the full-marks line from the bands rather than trusting 85", () => {
    const full = ATTENDANCE_MARK_BANDS
      .filter(([, m]) => m >= ATTENDANCE_MARK_MAX)
      .map(([pct]) => pct);
    expect(Math.min(...full)).toBe(ATTENDANCE_FULL_MARKS_PCT);
    // The whole argument: they are not the same line, and full marks is the
    // stricter one. If this ever inverts, the sentence on Home is backwards.
    expect(ATTENDANCE_FULL_MARKS_PCT).toBeGreaterThan(ATTENDANCE_MIN);
  });

  it("costs a student exactly 2 of 5 marks to sit on the eligibility line", () => {
    // Pinned as an assertion, not a comment: Home renders this number, and a
    // comment claiming it could go stale in silence. Measured 2026-08-27.
    expect(attendanceMarks(ATTENDANCE_MIN)).toBe(3);
    expect(ATTENDANCE_MARK_MAX - (attendanceMarks(ATTENDANCE_MIN) ?? 0)).toBe(2);
  });
});

describe("the blind-spot sentence on Home", () => {
  it("names the count, both lines, and the forfeit when a subject is caught in the gap", () => {
    const text = seed(BLIND);
    expect(text).toContain("of them are above 75% and losing marks anyway");
    expect(text).toContain("Full marks start at");
    expect(text).toContain("85%");
    expect(text).toContain("forfeits");
    expect(text).toContain("nothing else will tell you");
  });

  it("counts only subjects between the two lines", () => {
    // 78 is in the gap; 90 is past it; 70 is below eligibility and is the
    // ledger's problem, not this sentence's. So the count is 1, not 3.
    const text = seed(BLIND, CLEAR, SHORT);
    expect(text).toMatch(/1\s*of them are above 75% and losing marks anyway/);
  });

  it("stays silent when nothing sits in the gap", () => {
    const text = seed(CLEAR);
    expect(text).not.toContain("losing marks anyway");
  });

  it("teaches the same rule before any attendance exists", () => {
    const text = seed({ code: "CST303", credits: 4, type: "TH 40/60", s1: 38 });
    expect(text).toContain("No attendance recorded yet");
    expect(text).toContain("85%");
    expect(text).toContain("not the 75% you are told about");
  });
});
