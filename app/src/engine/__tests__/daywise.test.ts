import { describe, expect, it } from "vitest";
import { daywiseBySubject } from "../index";
import type { AttendanceStatus, DaywiseAttendance } from "../types";

/**
 * The day-by-day log, counted per subject.
 *
 * This is the second opinion on a figure the app previously took on trust. The
 * portal publishes a percentage AND a period log; they should agree, and until
 * now nothing compared them.
 */

const day = (...periods: Array<[AttendanceStatus, string | null]>): DaywiseAttendance[number] => ({
  label: "1st",
  periods: periods.map(([status, subject]) => ({ status, subject })),
});

describe("daywiseBySubject counts the way the regulation counts", () => {
  it("is empty for an empty log", () => {
    expect(daywiseBySubject([]).size).toBe(0);
  });

  it("counts a present period as attended and as held", () => {
    const out = daywiseBySubject([day(["present", "CST303 Computer Networks"])]);
    expect(out.get("CST303 Computer Networks")).toEqual({ attended: 1, held: 1 });
  });

  it("counts an absence as held but not attended", () => {
    const out = daywiseBySubject([day(["absent", "CST303"])]);
    expect(out.get("CST303")).toEqual({ attended: 0, held: 1 });
  });

  it("excludes holidays and empty periods from held, because they never happened", () => {
    const out = daywiseBySubject([day(
      ["present", "CST303"], ["holiday", "CST303"], ["none", "CST303"],
    )]);
    // One class ran. A holiday is not a class anybody missed.
    expect(out.get("CST303")).toEqual({ attended: 1, held: 1 });
  });

  it("credits on-duty and duty leave as attended, the way the portal does", () => {
    for (const status of ["od", "dutyleave", "duty"] as AttendanceStatus[]) {
      const out = daywiseBySubject([day([status, "CST303"])]);
      // The class ran and the student was excused: held, and not against them.
      expect(out.get("CST303")).toEqual({ attended: 1, held: 1 });
    }
  });

  it("counts a plain leave as an absence", () => {
    // An approved leave arrives as one of the credited statuses. A bare
    // "leave" is the student not being there, and treating it as neutral would
    // report a rosier figure than the portal's own.
    const out = daywiseBySubject([day(["leave", "CST303"])]);
    expect(out.get("CST303")).toEqual({ attended: 0, held: 1 });
  });

  it("ignores periods with no subject named", () => {
    const out = daywiseBySubject([day(["present", null], ["absent", "   "])]);
    expect(out.size).toBe(0);
  });

  it("accumulates one subject across many days", () => {
    const log = [
      day(["present", "CST303"], ["absent", "CST305"]),
      day(["present", "CST303"], ["present", "CST305"]),
      day(["absent", "CST303"], ["holiday", "CST305"]),
    ];
    const out = daywiseBySubject(log);
    expect(out.get("CST303")).toEqual({ attended: 2, held: 3 });
    expect(out.get("CST305")).toEqual({ attended: 1, held: 2 });
  });

  it("trims the printed subject so one subject is not counted twice", () => {
    const out = daywiseBySubject([day(["present", " CST303 "], ["absent", "CST303"])]);
    expect(out.size).toBe(1);
    expect(out.get("CST303")).toEqual({ attended: 1, held: 2 });
  });

  it("never reports more attended than held", () => {
    const statuses: AttendanceStatus[] =
      ["present", "absent", "od", "dutyleave", "duty", "leave", "holiday", "none"];
    const out = daywiseBySubject([day(
      ...statuses.map((s): [AttendanceStatus, string] => [s, "CST303"]),
    )]);
    const tally = out.get("CST303")!;
    expect(tally.attended).toBeLessThanOrEqual(tally.held);
  });
});
