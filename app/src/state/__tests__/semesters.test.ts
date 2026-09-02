// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  addSemester, edit, nextSemester, removeSemester, selectSemester, semesterNames, state,
} from "../store";

/**
 * Adding and removing semesters (issue #10).
 *
 * A KTU B.Tech is S1 to S8. The strip counted what existed and added one, which
 * produced S9, S10 and upwards on demand - semesters the university does not
 * award and the engine's own horizon arithmetic cannot place - and offered no
 * way to remove any of them, so a stray press was permanent.
 *
 * Both halves are asserted here, along with the two ways removal could take
 * more than it was asked for: the last semester, and a published result.
 */

const reset = (names: string[], active = names[0]!) => {
  edit((s) => {
    s.semesters = {};
    for (const n of names) s.semesters[n] = { courses: [] };
    s.activeSemester = active;
  });
};

beforeEach(() => reset(["S1"]));

describe("the programme ends at S8", () => {
  it("adds the next one while there is one to add", () => {
    reset(["S1", "S2"]);
    addSemester();
    expect(semesterNames()).toEqual(["S1", "S2", "S3"]);
    expect(state.activeSemester).toBe("S3");
  });

  it("refuses to invent an S9", () => {
    reset(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
    expect(nextSemester()).toBeNull();
    addSemester();
    expect(semesterNames()).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"]);
    expect(semesterNames()).not.toContain("S9");
  });

  it("fills a gap rather than counting past it", () => {
    // The second half of the same defect: counting existing semesters made the
    // button select an existing one instead of adding the missing one.
    reset(["S1", "S3"]);
    expect(nextSemester()).toBe("S2");
    addSemester();
    expect(semesterNames()).toEqual(["S1", "S2", "S3"]);
  });
});

describe("a semester can be removed", () => {
  it("removes the one named and leaves the rest", () => {
    reset(["S1", "S2", "S3"], "S1");
    removeSemester("S2");
    expect(semesterNames()).toEqual(["S1", "S3"]);
  });

  it("moves off a semester it just deleted", () => {
    // Leaving `activeSemester` pointing at a deleted key renders a screen with
    // no rows and no way to tell why.
    reset(["S1", "S2", "S3"], "S3");
    removeSemester("S3");
    expect(state.activeSemester).toBe("S2");
    expect(state.semesters[state.activeSemester]).toBeTruthy();
  });

  it("refuses to remove the last one", () => {
    reset(["S4"]);
    removeSemester("S4");
    expect(semesterNames()).toEqual(["S4"]);
  });

  it("ignores a name that is not there", () => {
    reset(["S1", "S2"]);
    removeSemester("S7");
    expect(semesterNames()).toEqual(["S1", "S2"]);
  });

  it("does not touch a published result for the same semester", () => {
    // History is a separate record keyed by the same name and holds the
    // university's own figure. Clearing out a mistyped semester is not a
    // request to discard a grade card.
    reset(["S1", "S2"], "S2");
    edit((s) => {
      s.history["S2"] = { name: "S2", sgpa: 8.4, credits: 22, source: "gradecard" } as never;
    });
    removeSemester("S2");
    expect(semesterNames()).toEqual(["S1"]);
    expect(state.history["S2"]).toBeTruthy();
    expect(state.history["S2"]!.sgpa).toBe(8.4);
  });

  it("keeps the courses of the semesters it did not remove", () => {
    reset(["S1", "S2"], "S1");
    edit((s) => { s.semesters["S1"]!.courses.push({ code: "CST303" } as never); });
    removeSemester("S2");
    expect(state.semesters["S1"]!.courses).toHaveLength(1);
  });
});

describe("selecting is not adding", () => {
  it("still creates a semester the student navigates to directly", () => {
    // `selectSemester` is used by the tab strip and by sync, and it is allowed
    // to create - the cap belongs on the button that invents a NAME, not on
    // navigation to a name that already came from somewhere.
    reset(["S1"]);
    selectSemester("S2");
    expect(semesterNames()).toEqual(["S1", "S2"]);
  });
});
