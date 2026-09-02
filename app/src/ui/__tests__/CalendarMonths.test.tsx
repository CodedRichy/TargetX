// @vitest-environment jsdom
/**
 * Issue #13: past months of the day-by-day grid, and switching between them.
 *
 * "By day attendance of past months should also be visible with the current
 * one. This aids in finding missing / incorrectly marked attendance."
 *
 * The grid's own rows are labelled "1st", "6th" and name no month, so the
 * screen has to say which month it is showing in words as well as by which
 * pill is lit - otherwise the two months are indistinguishable on screen and
 * the switcher has made the ambiguity worse rather than better.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DaywiseAttendance } from "../../engine";
import { Attendance } from "../Attendance";
import { edit } from "../../state/store";

afterEach(cleanup);

const day = (date: string, label: string): DaywiseAttendance[number] => ({
  date, label,
  periods: [{ status: "present", subject: "PCCST501 Computer Networks" }],
});

const SEPTEMBER: DaywiseAttendance = [day("2026-09-01", "1st"), day("2026-09-02", "2nd")];
const OCTOBER: DaywiseAttendance = [day("2026-10-01", "1st")];

beforeEach(() => {
  edit((s) => {
    s.semesters = { S5: { courses: [] } };
    s.activeSemester = "S5";
    s.history = {};
    s.onboarded = true;
    delete s.daywiseMonths;
    s.daywiseAttendance = null;
  });
});

const months = (c: Element) => [...c.querySelectorAll("button.cal-month")]
  .map((b) => b.textContent);
const current = (c: Element) =>
  c.querySelector('button.cal-month[aria-current="true"]')?.textContent ?? null;
const rowLabels = (c: Element) => [...c.querySelectorAll(".cal-table tbody th")]
  .map((t) => t.textContent);

describe("the day-by-day grid with more than one month on record", () => {
  beforeEach(() => {
    edit((s) => {
      s.daywiseMonths = { "2026-09": SEPTEMBER, "2026-10": OCTOBER };
      s.daywiseAttendance = OCTOBER;
    });
  });

  it("offers every month it holds, newest first", () => {
    const { container } = render(() => <Attendance />);
    expect(months(container)).toEqual(["October 2026", "September 2026"]);
  });

  it("opens on the newest, which is the month still changing", () => {
    const { container } = render(() => <Attendance />);
    expect(current(container)).toBe("October 2026");
    expect(rowLabels(container)).toEqual(["1st"]);
  });

  it("shows the past month's own days when one is chosen", () => {
    // The point of the issue: September's rows, after September has ended.
    const { container } = render(() => <Attendance />);
    (container.querySelectorAll("button.cal-month")[1] as HTMLButtonElement).click();
    expect(current(container)).toBe("September 2026");
    expect(rowLabels(container)).toEqual(["1st", "2nd"]);
  });

  it("names the month in words, not only by which pill is lit", () => {
    const { container } = render(() => <Attendance />);
    expect(container.querySelector(".cal-month-note")!.textContent)
      .toContain("October 2026");
  });
});

describe("the grid with one month on record", () => {
  beforeEach(() => {
    edit((s) => {
      s.daywiseMonths = { "2026-09": SEPTEMBER };
      s.daywiseAttendance = SEPTEMBER;
    });
  });

  it("shows no switcher, because there is nothing to switch to", () => {
    const { container } = render(() => <Attendance />);
    expect(months(container)).toEqual([]);
  });

  it("still says which month it is, and why there is only one", () => {
    // Without this a student reads a single month and concludes the app has
    // lost the others, which is the state it was actually in before this fix.
    const note = render(() => <Attendance />).container
      .querySelector(".cal-month-note")!.textContent!;
    expect(note).toContain("September 2026");
    expect(note).toMatch(/one month at a time/);
  });
});

describe("a record synced by a build that had no archive", () => {
  it("still draws its one grid", () => {
    // `daywiseMonths` absent, `daywiseAttendance` present: the shape every
    // installed copy has until it syncs once on the new build.
    edit((s) => {
      delete s.daywiseMonths;
      s.daywiseAttendance = SEPTEMBER;
    });
    const { container } = render(() => <Attendance />);
    expect(rowLabels(container)).toEqual(["1st", "2nd"]);
    expect(months(container)).toEqual([]);
  });
});

describe("the log-versus-portal comparison", () => {
  // Two months of the same subject, so the sum across the archive is provably
  // different from the last pull alone.
  const withSubject = (date: string, label: string, status: "present" | "absent") => ({
    date, label,
    periods: [{ status, subject: "PCCST501 Computer Networks" }],
  });

  beforeEach(() => {
    edit((s) => {
      s.semesters = {
        S5: {
          courses: [{
            code: "PCCST501", name: "Computer Networks", credits: 4,
            type: "TH 40/60", attended: 3, held: 4,
          } as never],
        },
      };
      s.daywiseMonths = {
        "2026-09": [withSubject("2026-09-01", "1st", "present"),
                    withSubject("2026-09-02", "2nd", "absent")],
        "2026-10": [withSubject("2026-10-01", "1st", "present"),
                    withSubject("2026-10-02", "2nd", "present")],
      };
      s.daywiseAttendance = s.daywiseMonths["2026-10"]!;
    });
  });

  const logCell = (c: Element) =>
    c.querySelector("#bysub-heading")!.closest("section")!
      .querySelector("tbody td.num")!.textContent;

  it("adds up every month held, not just the last one synced", () => {
    // The last pull alone is 2/2. Both months together are 3/4, which is what
    // the portal published - so the row can agree instead of always reporting
    // that the log is short.
    const { container } = render(() => <Attendance />);
    expect(logCell(container)).toBe("3/4");
  });

  it("says how many months the log covers, so a gap can be read correctly", () => {
    // Without this the student reads "log says fewer classes" as a portal
    // error, when the real cause is that TargetX has not been running long
    // enough to have seen the rest of the semester.
    const { container } = render(() => <Attendance />);
    const sub = container.querySelector("#bysub-heading")!
      .closest("section")!.querySelector(".schedule-sub")!.textContent!;
    expect(sub).toMatch(/covers the\s+2\s+months/);
  });
});
