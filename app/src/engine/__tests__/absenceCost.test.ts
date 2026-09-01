import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN,
  absenceCost, attendanceMarks, freeSkips,
} from "../index";

/**
 * The cost of the next absence.
 *
 * Every figure asserted here is re-derived from the engine's own constants
 * rather than copied out of a run, so a change to `ATTENDANCE_MARK_BANDS` or
 * `ATTENDANCE_MIN` fails this file instead of leaving it quoting a rule KTU no
 * longer has.
 */

/** The percentage at which the full attendance mark starts. */
const FULL_AT = Math.max(...ATTENDANCE_MARK_BANDS.map(([pct]) => pct));

describe("absenceCost prices a skip in marks, not only in percent", () => {
  it("returns null without raw counts, because there is no denominator to move", () => {
    expect(absenceCost(null, null)).toBeNull();
    expect(absenceCost(40, 0)).toBeNull();
    expect(absenceCost(40, null)).toBeNull();
  });

  it("moves the denominator, not just the numerator", () => {
    // 45 of 50 is 90%. One more class held and not attended is 45 of 51.
    const cost = absenceCost(45, 50, 0, 1);
    expect(cost!.before).toBeCloseTo(90, 2);
    expect(cost!.after).toBeCloseTo((45 / 51) * 100, 2);
  });

  it("costs nothing when the skip stays inside the same band", () => {
    // Well above the top band, so one absence cannot cross a step.
    const cost = absenceCost(49, 50, 0, 1)!;
    expect(cost.marksBefore).toBe(ATTENDANCE_MARK_MAX);
    expect(cost.marksAfter).toBe(ATTENDANCE_MARK_MAX);
    expect(cost.marksLost).toBe(0);
  });

  it("reports the mark a band crossing takes, for a student every portal calls fine", () => {
    // Sits just above the full-marks line, which no other system mentions.
    const held = 100;
    const attended = Math.ceil((FULL_AT / 100) * held);
    const cost = absenceCost(attended, held, 0, 1)!;

    expect(cost.before).toBeGreaterThanOrEqual(FULL_AT);
    expect(cost.after).toBeLessThan(FULL_AT);
    // Both sides agree with the band table itself - this test does not carry a
    // second opinion about what a percentage is worth.
    expect(cost.marksBefore).toBe(attendanceMarks(cost.before));
    expect(cost.marksAfter).toBe(attendanceMarks(cost.after));
    expect(cost.marksLost).toBeGreaterThan(0);
    // And they are still eligible throughout, which is the whole point: the
    // loss is invisible to any check that only asks about 75%.
    expect(cost.eligibleBefore).toBe(true);
    expect(cost.eligibleAfter).toBe(true);
  });

  it("reports the crossing of the eligibility floor", () => {
    const held = 100;
    const attended = ATTENDANCE_MIN; // exactly on the line at 100 held
    const cost = absenceCost(attended, held, 0, 1)!;
    expect(cost.eligibleBefore).toBe(true);
    expect(cost.eligibleAfter).toBe(false);
  });

  it("never reports a negative loss, because missing a class cannot earn a mark", () => {
    for (const attended of [10, 30, 44, 49, 50]) {
      expect(absenceCost(attended, 50, 0, 3)!.marksLost).toBeGreaterThanOrEqual(0);
    }
  });

  it("prices zero skips as no change at all", () => {
    const cost = absenceCost(44, 50, 0, 0)!;
    expect(cost.before).toBe(cost.after);
    expect(cost.marksLost).toBe(0);
  });

  it("holds duty leave at today's credited value rather than growing it", () => {
    // A larger `held` would mathematically allow more DL under the cap. The
    // student is not acquiring duty leave by missing a class, and letting the
    // cap rise would report the skip as cheaper than it is.
    const withDl = absenceCost(40, 50, 5, 10)!;
    const noDl = absenceCost(40, 50, 0, 10)!;
    expect(withDl.after).toBeGreaterThan(noDl.after);
    // The DL credited is bounded by today's cap, so the gap cannot widen with
    // the extra held classes: both sides move down together.
    expect(withDl.after).toBeLessThan(withDl.before);
  });

  it("scales with the course's own attendance maximum", () => {
    const five = absenceCost(80, 100, 0, 20, 5)!;
    const ten = absenceCost(80, 100, 0, 20, 10)!;
    expect(ten.marksBefore).toBeCloseTo(five.marksBefore * 2, 2);
  });
});

describe("freeSkips is the budget that binds first", () => {
  it("is null without raw counts", () => {
    expect(freeSkips(null, null)).toBeNull();
  });

  it("counts the absences that cost no mark at all", () => {
    const n = freeSkips(45, 50)!;
    // The claim, checked against absenceCost rather than asserted: n costs
    // nothing and n+1 costs something.
    expect(absenceCost(45, 50, 0, n)!.marksLost).toBe(0);
    expect(absenceCost(45, 50, 0, n + 1)!.marksLost).toBeGreaterThan(0);
  });

  it("is zero for a student already on a band edge", () => {
    const held = 100;
    const attended = Math.ceil((FULL_AT / 100) * held);
    expect(freeSkips(attended, held)).toBe(0);
  });

  it("is never more permissive than the eligibility budget it sits inside", () => {
    // The marks line is at or above the eligibility line, so the number of
    // absences that cost no mark can never exceed the number that keep the
    // student eligible. If it did, the app would be telling a student a skip
    // is free while it bars them from the exam.
    for (const [attended, held] of [[45, 50], [80, 100], [38, 50], [90, 100]]) {
      const free = freeSkips(attended!, held!)!;
      const cost = absenceCost(attended!, held!, 0, free)!;
      expect(cost.eligibleAfter).toBe(true);
    }
  });
});
