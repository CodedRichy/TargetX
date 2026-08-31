import { describe, expect, it } from "vitest";
import { diffSync } from "../changes";
import type { ChangeSide } from "../changes";
import type { Course, SemesterHistory } from "../types";
import { blankCourse } from "../course";

/**
 * "What changed since last sync": a sync replaces the whole record, so on its
 * own it tells a student nothing about what is new. `diffSync` is what turns
 * two records into the short list of facts that actually moved - a series mark
 * posted, attendance shifted, a grade published, an SGPA finalised - and
 * nothing else.
 */

const course = (code: string, patch: Partial<Course> = {}): Course =>
  ({ ...blankCourse(code, code), ...patch });

const side = (
  courses: Course[], history: Record<string, SemesterHistory> = {},
): ChangeSide => ({ semesters: { S5: { courses } }, history });

const hist = (sgpa: number): SemesterHistory =>
  ({ sgpa, creditsRegistered: 20, creditsEarned: 20, source: "etlab", conflict: null });

describe("diffSync", () => {
  it("reports a series mark that appeared as a post, not a change from zero", () => {
    const before = side([course("MAT101", { s1: "" })]);
    const after = side([course("MAT101", { s1: 18 })]);
    const out = diffSync(before, after);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "series", field: "Series 1", before: null, after: "18" });
  });

  it("reports a mark that moved with both ends", () => {
    const before = side([course("MAT101", { s1: 12 })]);
    const after = side([course("MAT101", { s1: 18 })]);
    expect(diffSync(before, after)[0]).toMatchObject({ before: "12", after: "18" });
  });

  it("reports attendance shifts as percentages", () => {
    const before = side([course("MAT101", { attendance: 72 })]);
    const after = side([course("MAT101", { attendance: 81 })]);
    expect(diffSync(before, after)[0]).toMatchObject({
      kind: "attendance", before: "72%", after: "81%",
    });
  });

  it("reports a newly published grade", () => {
    const before = side([course("MAT101", { portal_grade: null })]);
    const after = side([course("MAT101", { portal_grade: "A+" })]);
    expect(diffSync(before, after)[0]).toMatchObject({
      kind: "grade", field: "Grade", before: null, after: "A+",
    });
  });

  it("reports a semester SGPA that finalised", () => {
    const before = side([], {});
    const after = side([], { S4: hist(7.83) });
    expect(diffSync(before, after)[0]).toMatchObject({
      kind: "sgpa", semester: "S4", before: null, after: "7.83",
    });
  });

  it("says nothing when nothing moved", () => {
    const same = side([course("MAT101", { s1: 18, attendance: 80, portal_grade: "A" })],
                      { S4: hist(7.5) });
    expect(diffSync(same, same)).toEqual([]);
  });

  it("ignores a sub-epsilon wobble", () => {
    const before = side([course("MAT101", { attendance: 80 })]);
    const after = side([course("MAT101", { attendance: 80.001 })]);
    expect(diffSync(before, after)).toEqual([]);
  });

  it("does not cry 'removed' when a course drops out of a scrape", () => {
    const before = side([course("MAT101", { s1: 18 }), course("PHY101", { s1: 15 })]);
    const after = side([course("MAT101", { s1: 18 })]);
    expect(diffSync(before, after)).toEqual([]);
  });

  it("uses the subject name, not its code, in the report", () => {
    const before = side([course("MAT101", { name: "Linear Algebra", s1: "" })]);
    const after = side([course("MAT101", { name: "Linear Algebra", s1: 18 })]);
    expect(diffSync(before, after)[0]!.course).toBe("Linear Algebra");
  });

  it("does not register a scrape SGPA that precedence rejected", () => {
    // The caller diffs against the MERGED history, so a lower-trust figure that
    // never landed is never handed to diffSync as the 'after' - modelled here
    // by an after whose stored SGPA equals the before.
    const before = side([], { S4: { ...hist(7.83), source: "gradecard" } });
    const after = side([], { S4: { ...hist(7.83), source: "gradecard" } });
    expect(diffSync(before, after)).toEqual([]);
  });

  it("gathers several facts across a semester in one pass", () => {
    const before = side([
      course("MAT101", { s1: 12, attendance: 70 }),
      course("PHY101", { portal_grade: null }),
    ]);
    const after = side([
      course("MAT101", { s1: 18, attendance: 85 }),
      course("PHY101", { portal_grade: "B+" }),
    ]);
    const out = diffSync(before, after);
    expect(out).toHaveLength(3);
    expect(out.map((c) => c.kind).sort()).toEqual(["attendance", "grade", "series"]);
  });
});
