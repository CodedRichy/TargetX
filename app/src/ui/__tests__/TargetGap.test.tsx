// @vitest-environment jsdom
/**
 * The second attendance answer on an expanded ledger row.
 *
 * The row already tells a student what eligibility costs. This adds what THEIR
 * OWN target costs, which is a different number, and it must stay silent in
 * exactly two cases: where the target is at or under the eligibility line (the
 * sentence above is then the stricter one) and where the attendance-band
 * sentence has already quoted the same run of classes.
 *
 * Figures measured in this sitting against `attendanceTargetGap` and
 * `evaluate`: 48 of 60 held is 80%, a run of 20 to reach 85 and room to miss 4
 * and stay eligible; 44 of 62 is 70.97%, 58 to reach 85 and 10 to reach 75.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { attendanceTargetGap, evaluate } from "../../engine";
import type { Course } from "../../engine";
import { TargetGap } from "../Ledger";

afterEach(cleanup);

/** 80%: eligible with room to spare, and two marks down under R 7.5.ii. */
const EIGHTY: Course = {
  code: "CST303", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 48, held: 60, dl: 0, target: "A+",
};

/** 70.97%: short of both lines, by different runs. */
const SEVENTY: Course = {
  code: "CST301", credits: 4, type: "TH 40/60",
  s1: 32, s2: 28, other: 8, attended: 44, held: 62, dl: 0, target: "A",
};

const at = (course: Course, target: number | null) => {
  const ev = evaluate(course);
  const gap = attendanceTargetGap(course, target, ev.plan);
  const { container } = render(() => <TargetGap gap={gap} ev={ev} />);
  return { text: container.textContent ?? "", gap, ev };
};

describe("TargetGap", () => {
  it("gives the personal target's run where the band sentence quotes a different one", () => {
    // Target 90 is inside the same band as 85, so the band sentence quotes the
    // run to 85 and this one quotes the longer run to 90 - two numbers, and
    // the row would otherwise show only the first.
    const { text, gap, ev } = at(EIGHTY, 90);
    expect(gap.toTarget!.attend).toBe(60);
    expect(ev.attBand!.attend).toBe(20);
    expect(text).toContain("Your own 90% target is a different number: 60 in a row.");
  });

  it("stays silent when the band sentence has already quoted that same run", () => {
    // The default target of 85 IS a band boundary, so both sentences would say
    // "20 in a row" and the second is noise.
    const { text, gap, ev } = at(EIGHTY, 85);
    expect(gap.toTarget!.attend).toBe(20);
    expect(ev.attBand!.attend).toBe(20);
    expect(text).toBe("");
  });

  it("reports room to miss where the course is already past the personal target", () => {
    // 80% against a personal target of 78: a surplus, and a SMALLER one than
    // the eligibility budget of 4 the row already prints. Two budgets, not one.
    const { text, gap } = at(EIGHTY, 78);
    expect(gap.targetUnderEligibility).toBe(false);
    expect(gap.toTarget!.state).toBe("surplus");
    expect(gap.toTarget!.skip).toBe(1);
    expect(gap.toEligible!.skip).toBe(4);
    expect(text).toContain(
      "Already at or above your own 78% target, with room to miss 1 more.");
  });

  it("stays silent where the target is at or under the eligibility line", () => {
    // At 75 the two solves are identical, and below it the eligibility
    // sentence above is the stricter of the two.
    expect(at(SEVENTY, 75).text).toBe("");
    expect(at(SEVENTY, 70).text).toBe("");
  });

  it("stays silent when no personal target is set", () => {
    const { text, gap } = at(SEVENTY, null);
    expect(gap.toTarget).toBeNull();
    expect(text).toBe("");
  });

  it("says the target is gone rather than quoting a run that does not exist", () => {
    // A 100% target with a class already missed: no run of future classes
    // recovers it, and `attendancePlan` returns `attend: null` rather than a
    // number. Printing "attend null in a row" is what this branch prevents.
    const { text, gap } = at(EIGHTY, 100);
    expect(gap.toTarget!.attend).toBeNull();
    expect(text).toContain("Your own 100% target is out of reach this semester.");
  });
});
