// @vitest-environment jsdom
/**
 * The attendance screen: the miss budget, per subject.
 *
 * The number a portal never shows - how many more classes a subject can lose
 * before it drops under 75% - drawn as a strip of one pip per class. This file
 * pins the three states the screen has to tell apart: room above the line, a
 * shortfall below it, and no attendance on record at all (which must read as
 * "not recorded", never as a real percentage).
 *
 * Every count asserted here is re-derived from `attendancePlan` in this sitting
 * rather than pasted, so a change to the attendance math fails this file
 * instead of leaving the screen quoting a number the engine no longer returns.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATTENDANCE_MIN, attendancePlan } from "../../engine";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";
import { Attendance } from "../Attendance";

afterEach(cleanup);

/** 90%: comfortably above the line, so a run of classes can still be skipped. */
const SURPLUS: Partial<Course> = {
  code: "CST303", name: "Compiler Design", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 45, held: 50, dl: 0,
};
/** 70%: below the 75% line, so the number is a run back rather than a budget. */
const DEFICIT: Partial<Course> = {
  code: "CST305", name: "Computer Networks", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 35, held: 50, dl: 0,
};
/** No attended/held: absence of data, and must never render as 0% or 100%. */
const UNRECORDED: Partial<Course> = {
  code: "CST307", name: "Data Mining", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9,
};

function seed(...courses: Partial<Course>[]) {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
  });
  courses.forEach((c, i) => { addCourse(); updateCourse(i, c); });
  return render(() => <Attendance />).container;
}

beforeEach(() => {
  edit((d) => { d.semesters = { S5: { courses: [] } }; d.activeSemester = "S5"; });
});

describe("the attendance screen", () => {
  it("renders its heading without throwing when nothing is recorded", () => {
    let container: HTMLElement | null = null;
    expect(() => { container = seed(); }).not.toThrow();
    expect(container!.querySelector("h2")).not.toBeNull();
  });

  it("shows a surplus subject the exact count of classes it can still miss", () => {
    const plan = attendancePlan(SURPLUS.attended!, SURPLUS.held!, 0)!;
    expect(plan.state).toBe("surplus");
    expect(plan.skip).toBeGreaterThan(0);

    const c = seed(SURPLUS);
    const text = c.textContent ?? "";
    expect(text).toContain("Compiler Design");
    expect(text).toContain("more class");
    expect(text).toContain(String(plan.skip));
    // One filled pip per missable class - the strip is the whole point.
    expect(c.querySelectorAll(".att-pip.miss")).toHaveLength(plan.skip);
    expect(c.querySelectorAll(".att-pip.recover")).toHaveLength(0);
  });

  it("shows a deficit subject the run of classes needed to recover", () => {
    const plan = attendancePlan(DEFICIT.attended!, DEFICIT.held!, 0)!;
    expect(plan.state).toBe("deficit");
    expect(plan.attend).not.toBeNull();

    const c = seed(DEFICIT);
    const text = c.textContent ?? "";
    expect(text).toContain("Computer Networks");
    expect(text).toContain("to recover");
    expect(text).toContain(String(plan.attend));
    expect(c.querySelectorAll(".att-pip.recover")).toHaveLength(plan.attend!);
    expect(c.querySelectorAll(".att-pip.miss")).toHaveLength(0);
  });

  it("shows an unrecorded subject as 'not recorded', never a percentage", () => {
    // The plan is null precisely because there are no counts to solve from.
    expect(attendancePlan(UNRECORDED.attended, UNRECORDED.held, 0)).toBeNull();

    const c = seed(UNRECORDED);
    const text = c.textContent ?? "";
    expect(text).toContain("Data Mining");
    expect(text).toContain("not recorded");
    // Never invented as a full or empty house, and no strip drawn.
    expect(text).not.toMatch(/\b0%|100%/);
    expect(c.querySelectorAll(".att-pip")).toHaveLength(0);
  });

  it("renders every state together without throwing", () => {
    let container: HTMLElement | null = null;
    expect(() => { container = seed(SURPLUS, DEFICIT, UNRECORDED); }).not.toThrow();
    // One card per subject, each stating the 75% line it is measured against.
    expect(container!.querySelectorAll(".att-card")).toHaveLength(3);
    expect(container!.textContent).toContain(`${ATTENDANCE_MIN}%`);
  });
});
