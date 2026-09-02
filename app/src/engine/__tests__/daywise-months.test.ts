/**
 * Issue #13: keeping every month of the day-by-day grid, not just the last.
 *
 * The portal serves one month and the app stored one month, so on the first of
 * October a student's September was gone - and September is exactly what they
 * would be looking at, because a wrongly marked absence is only found by
 * checking back on a day you remember being in class.
 *
 * What is tested here is the arithmetic of the archive: that a sync files the
 * month it pulled and touches no other, that an undated grid is refused rather
 * than written over a month it might not be, and that a record from before the
 * archive existed is adopted rather than dropped by the upgrade.
 */
import { describe, expect, it } from "vitest";
import {
  adoptLegacy, fileMonth, monthKeyOf, monthLabel, monthsHeld,
} from "../daywise";
import type { DaywiseAttendance } from "../types";

const day = (date: string | undefined, label: string): DaywiseAttendance[number] => ({
  ...(date ? { date } : {}),
  label,
  periods: [{ status: "present", subject: "PCCST501 Computer Networks" }],
});

const SEPTEMBER: DaywiseAttendance = [day("2026-09-01", "1st"), day("2026-09-02", "2nd")];
const OCTOBER: DaywiseAttendance = [day("2026-10-01", "1st")];
const UNDATED: DaywiseAttendance = [day(undefined, "1st")];

describe("which month a grid belongs to", () => {
  it("reads it from the first dated row", () => {
    expect(monthKeyOf(SEPTEMBER)).toBe("2026-09");
  });

  it("is nothing at all when no row carries a date", () => {
    // Not "this month". A guess here is what would overwrite a real September.
    expect(monthKeyOf(UNDATED)).toBeNull();
    expect(monthKeyOf([])).toBeNull();
  });

  it("skips undated rows to find one that is dated", () => {
    expect(monthKeyOf([day(undefined, "Sun"), ...SEPTEMBER])).toBe("2026-09");
  });
});

describe("filing a synced month", () => {
  it("keeps the month it is not about", () => {
    // The whole issue in one assertion.
    const archive = fileMonth(fileMonth({}, SEPTEMBER), OCTOBER);
    expect(Object.keys(archive).sort()).toEqual(["2026-09", "2026-10"]);
    expect(archive["2026-09"]).toHaveLength(2);
  });

  it("replaces its own month outright", () => {
    // Within a month the portal is the authority: a day it has stopped listing
    // must stop being listed here, so this is a replace and not a merge.
    const corrected: DaywiseAttendance = [day("2026-09-01", "1st")];
    const archive = fileMonth(fileMonth({}, SEPTEMBER), corrected);
    expect(archive["2026-09"]).toHaveLength(1);
  });

  it("refuses an undated grid rather than guessing its month", () => {
    const before = fileMonth({}, SEPTEMBER);
    expect(fileMonth(before, UNDATED)).toBe(before);
  });

  it("refuses an empty or absent grid", () => {
    const before = fileMonth({}, SEPTEMBER);
    expect(fileMonth(before, [])).toBe(before);
    expect(fileMonth(before, null)).toBe(before);
    expect(fileMonth(before, undefined)).toBe(before);
  });

  it("does not mutate the archive it was given", () => {
    const before = fileMonth({}, SEPTEMBER);
    fileMonth(before, OCTOBER);
    expect(Object.keys(before)).toEqual(["2026-09"]);
  });
});

describe("the months held", () => {
  it("comes back newest first, which is the direction you look back in", () => {
    const archive = fileMonth(fileMonth(fileMonth({}, OCTOBER), SEPTEMBER),
      [day("2026-08-31", "31st")]);
    expect(monthsHeld(archive)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });

  it("crosses a year boundary in the right order", () => {
    // String sort on `YYYY-MM` is the reason this works; a `MM-YYYY` key would
    // put January 2027 before December 2026.
    const archive = fileMonth(fileMonth({}, [day("2026-12-01", "1st")]),
      [day("2027-01-05", "5th")]);
    expect(monthsHeld(archive)).toEqual(["2027-01", "2026-12"]);
  });

  it("is empty rather than undefined for a record with no archive", () => {
    expect(monthsHeld(undefined)).toEqual([]);
  });
});

describe("naming a month", () => {
  it("prints the month and year", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthLabel("2027-01")).toBe("January 2027");
    expect(monthLabel("2026-12")).toBe("December 2026");
  });

  it("does not go through Date, which would shift the month west of Greenwich", () => {
    // `new Date("2026-09")` is UTC midnight and prints as August in IST-negative
    // zones. Built from the parts instead, so every reader sees the same month.
    for (let m = 1; m <= 12; m += 1) {
      const key = `2026-${String(m).padStart(2, "0")}`;
      expect(monthLabel(key).endsWith("2026")).toBe(true);
    }
    expect(monthLabel("2026-01").startsWith("January")).toBe(true);
  });

  it("gives back what it was handed when that is not a month", () => {
    expect(monthLabel("nonsense")).toBe("nonsense");
  });
});

describe("a record written before the archive existed", () => {
  it("has its one grid adopted into the archive", () => {
    expect(adoptLegacy(undefined, SEPTEMBER)).toEqual({ "2026-09": SEPTEMBER });
  });

  it("leaves an archive that already has that month alone", () => {
    const archive = { "2026-10": OCTOBER };
    expect(adoptLegacy(archive, SEPTEMBER)).toEqual({
      "2026-10": OCTOBER, "2026-09": SEPTEMBER,
    });
  });

  it("drops an undated legacy grid rather than putting a nameless month in the switcher", () => {
    expect(adoptLegacy(undefined, UNDATED)).toEqual({});
    expect(adoptLegacy(undefined, null)).toEqual({});
  });
});
