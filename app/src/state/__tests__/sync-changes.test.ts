/**
 * "What changed since last sync", wired end to end.
 *
 * `diffSync` is unit-tested next door; this covers the two things only the
 * store can get wrong: that the FIRST sync writes no batch (there is no prior
 * record to diff, and dumping a whole fresh pull as "changes" is noise), and
 * that a SECOND sync diffs against what the first one actually stored.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { blankCourse } from "../../engine";
import type { Course } from "../../engine";
import { applySync } from "../actions";
import { dismissChanges, edit, state } from "../store";

const pull = (s1: Course["s1"], attendance: Course["attendance"]): Parameters<typeof applySync>[0] => ({
  semesters: {
    S5: {
      courses: [{ ...blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60"), s1, attendance } as Course],
      creditCheck: undefined as never,
    },
  },
  history: {},
  current: "S5",
  inferredTypes: [],
});

beforeEach(() => {
  edit((s) => {
    s.activeSemester = "S5";
    s.semesters = { S5: { courses: [] } };
    s.history = {};
    s.lastSync = undefined;
    s.changes = undefined;
  });
});

describe("the changes batch", () => {
  it("is not written by the first sync", () => {
    applySync(pull(15, 80));
    expect(state.changes).toBeUndefined();
  });

  it("is written by the second sync, diffed against the first", () => {
    applySync(pull(15, 80));
    applySync(pull(18, 85));
    expect(state.changes).toBeDefined();
    const kinds = state.changes!.items.map((c) => c.kind).sort();
    expect(kinds).toEqual(["attendance", "series"]);
    expect(state.changes!.at).toBe(state.lastSync);
  });

  it("records an empty batch when a re-sync moved nothing", () => {
    applySync(pull(15, 80));
    applySync(pull(15, 80));
    expect(state.changes).toBeDefined();
    expect(state.changes!.items).toEqual([]);
  });

  it("is cleared on dismiss", () => {
    applySync(pull(15, 80));
    applySync(pull(18, 85));
    dismissChanges();
    expect(state.changes).toBeUndefined();
  });
});
