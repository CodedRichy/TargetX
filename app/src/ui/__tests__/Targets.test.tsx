// @vitest-environment jsdom
/**
 * What the targets surface says on screen.
 *
 * Every component under test is pure over its props and is handed a REAL
 * engine check object, so a sentence claiming a consequence the engine does
 * not report fails here. The literal figures asserted below were measured
 * against `ATTENDANCE_MARK_BANDS` and `attendanceTargetGap` in this sitting -
 * 85 pays 5, 80 pays 4, 78 and 75 pay 3, 70 pays 2, 55 pays 0 - and a wrong
 * one fails the suite rather than misleading a reader.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import {
  attendanceTargetGap, checkAttendanceTarget, checkGpaTarget, reconcileSgpaTarget,
} from "../../engine";
import {
  AttendanceTargetReadout, AttendanceTargetWhy, GpaTargetWarning,
  PersonalAttendanceList, RegulationFloors, SgpaTargetReadout,
} from "../Targets";

afterEach(cleanup);

const textOf = (node: () => unknown) => {
  const { container } = render(node as never);
  return container.textContent ?? "";
};

describe("the attendance target, and why it defaults to 85", () => {
  it("teaches the 75-is-not-the-goal point once, in one sentence", () => {
    const out = textOf(() => <AttendanceTargetWhy />);
    expect(out).toContain(
      "75% only admits you to the exam — R 7.5.ii pays all 5 CIE marks from 85%,"
      + " so every point between the two is marks lost in every subject before you"
      + " write a word.");
  });

  it("says nothing is being given away at the full-marks band", () => {
    const out = textOf(() => (
      <AttendanceTargetReadout check={checkAttendanceTarget(85)} />));
    expect(out).toContain("At 85% you keep all 5 attendance marks.");
    expect(out).not.toContain("below the 75% rule");
  });

  it("names the marks forfeited between eligibility and full marks", () => {
    // 78% pays 3 of 5 under R 7.5.ii: two marks gone while still eligible.
    const out = textOf(() => (
      <AttendanceTargetReadout check={checkAttendanceTarget(78)} />));
    expect(out).toContain("At 78% you are eligible to sit the exam");
    expect(out).toContain("R 7.5.ii pays 3 of 5");
    expect(out).toContain("2 marks given up in every subject before you write a word");
    expect(out).not.toContain("below the 75% rule");
  });

  it("uses the singular where exactly one mark is forfeited", () => {
    // 80% pays 4 of 5.
    const out = textOf(() => (
      <AttendanceTargetReadout check={checkAttendanceTarget(80)} />));
    expect(out).toContain("R 7.5.ii pays 4 of 5");
    expect(out).toContain("1 mark given up");
    expect(out).not.toContain("1 marks given up");
  });

  it("marks a target below the regulation, and never accepts it silently", () => {
    const out = textOf(() => (
      <AttendanceTargetReadout check={checkAttendanceTarget(70)} />));
    expect(out).toContain("below the 75% rule");
    expect(out).toContain("At 70% you are not eligible on your own.");
    expect(out).toContain(
      "R 6.2 lets the Principal condone down to 60%, for at most two semesters and"
      + " against a fee");
    expect(out).toContain("a target here is a target of needing a favour");
    expect(out).toContain("R 7.5.ii pays 2 of 5");
  });

  it("says there is no appeal below the condonation floor", () => {
    const out = textOf(() => (
      <AttendanceTargetReadout check={checkAttendanceTarget(55)} />));
    expect(out).toContain("below the 75% rule");
    expect(out).toContain("At 55% you are below 60% and R 6.2 gives no appeal.");
    expect(out).toContain("This is a target of not sitting the exam.");
  });

  it("treats a cleared target as no target, not as a target of zero", () => {
    const out = textOf(() => <AttendanceTargetReadout check={checkAttendanceTarget(null)} />);
    expect(out).toContain("No attendance target.");
    expect(out).toContain("the 75% eligibility rule still applies whatever you aim for");
    expect(out).not.toContain("0%");
  });
});

describe("a GPA target below the lowest passing grade point", () => {
  it("says the target needs a failure, and names which target", () => {
    const out = textOf(() => (
      <GpaTargetWarning check={checkGpaTarget(5)} what="CGPA target" />));
    expect(out).toContain("A CGPA target of 5.00 is below every passing grade point.");
    expect(out).toContain("this target can only be met by failing something");
  });

  it("stays silent on a target that does not need one", () => {
    expect(textOf(() => (
      <GpaTargetWarning check={checkGpaTarget(8)} what="CGPA target" />))).toBe("");
    expect(textOf(() => (
      <GpaTargetWarning check={checkGpaTarget(null)} what="CGPA target" />))).toBe("");
  });
});

describe("which SGPA target answered, and whether it covers the CGPA goal", () => {
  it("names a semester's own target", () => {
    const out = textOf(() => (
      <SgpaTargetReadout semester="S5"
                         resolved={{ value: 8.2, basis: "semester" }}
                         vsGoal={reconcileSgpaTarget(8.2, 9.46)} />));
    expect(out).toContain("S5 is using its own target of 8.20.");
  });

  it("says when a semester is falling back to the default", () => {
    const out = textOf(() => (
      <SgpaTargetReadout semester="S6"
                         resolved={{ value: 8, basis: "default" }}
                         vsGoal={reconcileSgpaTarget(8, null)} />));
    expect(out).toContain("S6 has no target of its own, so it falls back to your default of 8.00.");
  });

  it("says when there is no target at all, rather than showing a zero", () => {
    const out = textOf(() => (
      <SgpaTargetReadout semester="S7"
                         resolved={{ value: null, basis: "none" }}
                         vsGoal={reconcileSgpaTarget(null, 9.46)} />));
    expect(out).toContain("No SGPA target for S7, and no default to fall back to.");
    expect(out).not.toContain("0.00");
  });

  it("reports the shortfall against the CGPA goal without overriding either", () => {
    // 9.46 - 8.20 = 1.26 by the engine's own reconciliation.
    const vs = reconcileSgpaTarget(8.2, 9.46);
    expect(vs.shortfall).toBe(1.26);
    const out = textOf(() => (
      <SgpaTargetReadout semester="S5" resolved={{ value: 8.2, basis: "semester" }}
                         vsGoal={vs} />));
    expect(out).toContain("Your 8.20 is 1.26 short of the 9.46 your CGPA goal needs.");
    expect(out).toContain(
      "Both are yours and neither overrides the other. The two routes below chase the"
      + " two different numbers.");
  });

  it("says so when the semester target covers the goal", () => {
    const out = textOf(() => (
      <SgpaTargetReadout semester="S5" resolved={{ value: 9.5, basis: "semester" }}
                         vsGoal={reconcileSgpaTarget(9.5, 9.46)} />));
    expect(out).toContain("Your 9.50 covers the 9.46 your CGPA goal needs.");
  });

  it("compares nothing when either side is unset", () => {
    const out = textOf(() => (
      <SgpaTargetReadout semester="S5" resolved={{ value: 8.2, basis: "semester" }}
                         vsGoal={reconcileSgpaTarget(8.2, null)} />));
    expect(out).not.toContain("short of");
    expect(out).not.toContain("covers the");
  });
});

describe("the regulations, printed as reference and never as a field", () => {
  it("prints every floor the app works to, read off the constants", () => {
    const { container } = render(() => <RegulationFloors />);
    const out = container.textContent ?? "";
    expect(out).toContain("Set by the regulations, not by you.");
    expect(out).toContain("Exam eligibility");
    expect(out).toContain("75% attendance (R 6.2).");
    expect(out).toContain("Condonation floor");
    expect(out).toContain("60%.");
    expect(out).toContain("Below it there is no appeal (R 6.2).");
    expect(out).toContain("Full attendance marks");
    expect(out).toContain("85% earns all 5 CIE marks, stepping down to 1 at 60% (R 7.5.ii).");
    expect(out).toContain("50 of 100 on the total.");
    expect(out).toContain("40% of the ESE paper on its own, whatever the internal is.");
  });

  it("carries no input of any kind - a regulation is not editable", () => {
    const { container } = render(() => <RegulationFloors />);
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("the personal attendance list, kept apart from the regulation one", () => {
  /** 48 of 60 held: 80% - eligible with room to spare, and short of 85. */
  const eighty = { code: "CST303", gap: attendanceTargetGap({ attended: 48, held: 60 }, 85) };
  /** 44 of 62 held: 70.97% - short on both counts, by different amounts. */
  const seventyOne = { code: "CST301", gap: attendanceTargetGap({ attended: 44, held: 62 }, 85) };

  it("says it is a different list from the 75% one", () => {
    const out = textOf(() => (
      <PersonalAttendanceList entries={[eighty]} target={85} targetBelowRegulation={false} />));
    expect(out).toContain("Your target, not the regulation.");
    expect(out).toContain(
      "The 75% shortage count in the bar above is a separate list and a course can be"
      + " on one and not the other.");
  });

  it("gives BOTH answers for a course at 80%, which are not the same answer", () => {
    // Measured: to 85 is a run of 20 consecutive classes; to eligible there is
    // room to miss 4. Rendering only the second is the old behaviour.
    expect(eighty.gap.toTarget!.attend).toBe(20);
    expect(eighty.gap.toEligible!.skip).toBe(4);
    const out = textOf(() => (
      <PersonalAttendanceList entries={[eighty]} target={85} targetBelowRegulation={false} />));
    expect(out).toContain("To 85%");
    expect(out).toContain("attend 20 in a row");
    expect(out).toContain("To eligible");
    expect(out).toContain("room to miss 4");
  });

  it("keeps the two answers apart where both are deficits", () => {
    // Measured: 58 consecutive classes to reach 85, 10 to reach 75.
    expect(seventyOne.gap.toTarget!.attend).toBe(58);
    expect(seventyOne.gap.toEligible!.attend).toBe(10);
    const out = textOf(() => (
      <PersonalAttendanceList entries={[seventyOne]} target={85}
                              targetBelowRegulation={false} />));
    expect(out).toContain("attend 58 in a row");
    expect(out).toContain("attend 10 in a row");
  });

  it("warns that the target answer is the looser one when the target breaks the rule", () => {
    const out = textOf(() => (
      <PersonalAttendanceList entries={[seventyOne]} target={70} targetBelowRegulation={true} />));
    expect(out).toContain(
      "Your target is below the 75% eligibility rule, so the \"to target\" answer is the"
      + " looser of the two. The eligibility column is the binding one.");
  });

  it("does not carry that warning when the target is at or above the rule", () => {
    const out = textOf(() => (
      <PersonalAttendanceList entries={[eighty]} target={85} targetBelowRegulation={false} />));
    expect(out).not.toContain("looser of the two");
  });

  it("says the list is empty rather than showing nothing", () => {
    const out = textOf(() => (
      <PersonalAttendanceList entries={[]} target={85} targetBelowRegulation={false} />));
    expect(out).toContain("Every subject is at or above 85%. Nothing to claw back.");
  });

  it("asks for a target rather than reporting against one that is not set", () => {
    const out = textOf(() => (
      <PersonalAttendanceList entries={[]} target={null} targetBelowRegulation={false} />));
    expect(out).toContain("Set an attendance target above and this list fills in.");
    expect(out).not.toContain("Nothing to claw back");
  });
});
