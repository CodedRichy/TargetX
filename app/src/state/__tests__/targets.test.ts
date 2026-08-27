/**
 * The stored target set: one setter per target, and no setter that wipes the
 * others.
 *
 * `AppState.goal` used to hold a single CGPA and every writer replaced it
 * wholesale. Now that it holds four targets, a wholesale replace is a silent
 * data loss - set your CGPA goal and your attendance target disappears - and
 * it is the kind that leaves no trace on screen to notice. These pin that it
 * cannot happen through any of the writers, including the reset and the
 * backup import.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_ATTENDANCE_TARGET, normaliseTargets } from "../../engine";
import { importJson, resetEverything } from "../actions";
import {
  setAttendanceTarget, setDefaultSgpaTarget, setGoal, setSemesterSgpaTarget, state,
} from "../store";

/** What is actually stored, read the way the app reads it back. */
const targets = () => normaliseTargets(state.goal);

beforeEach(() => {
  resetEverything();
});

describe("setting one target leaves the rest alone", () => {
  it("keeps the attendance target when the CGPA goal is set", () => {
    setAttendanceTarget(90);
    setGoal(8.5);
    expect(targets().attendance).toBe(90);
    expect(targets().cgpa).toBe(8.5);
  });

  it("keeps the CGPA goal when a semester SGPA target is set", () => {
    setGoal(8.5);
    setSemesterSgpaTarget("S3", 8);
    setSemesterSgpaTarget("S4", 7);
    expect(targets().cgpa).toBe(8.5);
    expect(targets().sgpaBySemester).toEqual({ S3: 8, S4: 7 });
  });

  it("keeps the per-semester targets when the blanket one is set", () => {
    setSemesterSgpaTarget("S3", 8);
    setDefaultSgpaTarget(7.5);
    expect(targets().sgpaDefault).toBe(7.5);
    expect(targets().sgpaBySemester).toEqual({ S3: 8 });
  });
});

describe("clearing a target", () => {
  it("removes a semester entry rather than pinning it at zero", () => {
    setSemesterSgpaTarget("S3", 8);
    setSemesterSgpaTarget("S3", null);
    expect(targets().sgpaBySemester).toEqual({});
    expect(targets().sgpaBySemester["S3"]).toBeUndefined();
  });

  /**
   * A cleared attendance target has to survive a reload, or the default
   * overrules a decision the student made on purpose every time they open the
   * app. The stored null is what carries it; see `normaliseTargets`.
   */
  it("writes a null the loader will not overwrite with the default", () => {
    setAttendanceTarget(null);
    expect(state.goal?.attendance).toBeNull();
    expect(normaliseTargets(JSON.parse(JSON.stringify(state.goal))).attendance).toBeNull();
  });
});

describe("the whole-document writers", () => {
  it("resets to the default target set, attendance default included", () => {
    setGoal(9);
    setAttendanceTarget(60);
    resetEverything();
    expect(targets().cgpa).toBeNull();
    expect(targets().attendance).toBe(DEFAULT_ATTENDANCE_TARGET);
    expect(targets().sgpaBySemester).toEqual({});
  });

  /**
   * A backup written before the goal widened is the same old shape arriving
   * later, so importing one must recover the CGPA target it does hold and
   * supply the targets it cannot.
   */
  it("recovers the CGPA target out of a backup that predates the rest", () => {
    importJson(JSON.stringify({ semesters: { S1: { courses: [] } }, goal: { cgpa: 8 } }));
    expect(targets().cgpa).toBe(8);
    expect(targets().attendance).toBe(DEFAULT_ATTENDANCE_TARGET);
    expect(targets().sgpaDefault).toBeNull();
  });

  it("recovers a backup with no goal at all", () => {
    importJson(JSON.stringify({ semesters: { S1: { courses: [] } } }));
    expect(targets().cgpa).toBeNull();
    expect(targets().attendance).toBe(DEFAULT_ATTENDANCE_TARGET);
  });
});
