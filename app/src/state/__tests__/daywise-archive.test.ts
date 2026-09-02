/**
 * Issue #13, at the point the loss actually happened: a sync.
 *
 * `fileMonth` is unit-tested in the engine. What only the store can get wrong
 * is the wiring: that a sync files what it pulled into the archive as well as
 * keeping it as the latest grid, and that October's sync leaves September
 * where it is. Before this the field was assigned outright, so the second sync
 * of a new month was the moment the previous one disappeared.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { blankCourse } from "../../engine";
import type { Course, DaywiseAttendance } from "../../engine";
import { applySync } from "../actions";
import { edit, state } from "../store";

const day = (date: string, label: string): DaywiseAttendance[number] => ({
  date, label,
  periods: [{ status: "present", subject: "PCCST501 Computer Networks" }],
});

const SEPTEMBER: DaywiseAttendance = [day("2026-09-01", "1st"), day("2026-09-02", "2nd")];
const OCTOBER: DaywiseAttendance = [day("2026-10-01", "1st")];
const UNDATED: DaywiseAttendance = [{ label: "1st", periods: [] }];

const pull = (daywiseAttendance: DaywiseAttendance | null): Parameters<typeof applySync>[0] => ({
  semesters: {
    S5: {
      courses: [blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60") as Course],
      creditCheck: undefined as never,
    },
  },
  history: {},
  current: "S5",
  inferredTypes: [],
  daywiseAttendance,
});

beforeEach(() => {
  edit((s) => {
    s.activeSemester = "S5";
    s.semesters = { S5: { courses: [] } };
    s.history = {};
    delete s.daywiseMonths;
    s.daywiseAttendance = null;
    delete s.lastSync;
  });
});

describe("syncing the day-by-day grid", () => {
  it("files the month it pulled", () => {
    applySync(pull(SEPTEMBER));
    expect(Object.keys(state.daywiseMonths ?? {})).toEqual(["2026-09"]);
    expect(state.daywiseAttendance).toHaveLength(2);
  });

  it("keeps last month when this month arrives", () => {
    // The issue, exactly. Two syncs a month apart used to leave one month.
    applySync(pull(SEPTEMBER));
    applySync(pull(OCTOBER));
    expect(Object.keys(state.daywiseMonths ?? {}).sort())
      .toEqual(["2026-09", "2026-10"]);
    expect(state.daywiseMonths!["2026-09"]).toHaveLength(2);
    // The latest pull is still the latest pull.
    expect(state.daywiseAttendance).toHaveLength(1);
  });

  it("corrects a month in place when the portal restates it", () => {
    // Same month twice: the second pull is the authority on its own month, so
    // a day the portal has stopped listing stops being listed here.
    applySync(pull(SEPTEMBER));
    applySync(pull([day("2026-09-01", "1st")]));
    expect(state.daywiseMonths!["2026-09"]).toHaveLength(1);
  });

  it("leaves the archive alone when the page could not be read", () => {
    // A null is a 404 or an unparseable page, not an empty month. Writing it
    // through would throw away a good record over a portal hiccup.
    applySync(pull(SEPTEMBER));
    applySync(pull(null));
    expect(Object.keys(state.daywiseMonths ?? {})).toEqual(["2026-09"]);
    expect(state.daywiseAttendance).toHaveLength(2);
  });

  it("does not file an undated grid under a month it might not be", () => {
    // A portal whose page carries no dates still syncs, and its grid is still
    // shown - it just cannot be filed, because filing it would mean writing it
    // over whichever month happened to be guessed.
    applySync(pull(SEPTEMBER));
    applySync(pull(UNDATED));
    expect(Object.keys(state.daywiseMonths ?? {})).toEqual(["2026-09"]);
    expect(state.daywiseMonths!["2026-09"]).toHaveLength(2);
  });
});
