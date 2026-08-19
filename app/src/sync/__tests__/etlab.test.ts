/**
 * What a portal sync is allowed to call a registered credit total.
 *
 * etlab publishes an EARNED total per semester and nothing else, so the
 * registered total - the CGPA denominator - can only be added up from the
 * courses. That sum is a fact only when the published curriculum priced every
 * one of them; `inferCredits` never fails, so an inferred total would be
 * indistinguishable from a known one once it is stored as a number.
 */
import { describe, expect, it } from "vitest";
import { academicsToState } from "../etlab";
import type { Academics, PortalCourse } from "../etlab";

const course = (code: string, grade: string | null = null): PortalCourse => ({
  code, name: "", attended: null, held: null, attendance: null,
  internal: null, grade, result: null, gpa: null, series: [],
});

/** Codes in the bundled curriculum: 3 + 4 + 3 + 1 + 4 = 15 credits. */
const LISTED = ["GAMAT101", "GAPHT121", "GMEST103", "GXESL106", "UCEST105"];

const academics = (codes: string[]): Academics => ({
  current: null,
  semesters: { 1: { courses: codes.map((c) => course(c)), sgpa: 7.5, earnedCredits: 12 } },
});

/** The same semester, with one named course carrying a published grade. */
const graded = (code: string, grade: string): Academics => ({
  current: null,
  semesters: {
    1: {
      courses: LISTED.map((c) => course(c, c === code ? grade : "B")),
      sgpa: 7.5, earnedCredits: 12,
    },
  },
});

describe("history from a portal sync", () => {
  it("adds up a registered total when the curriculum priced every course", () => {
    expect(academicsToState(academics(LISTED)).history["S1"]).toEqual(
      { sgpa: 7.5, creditsRegistered: 15, creditsEarned: 12 });
  });

  it("leaves the total unknown when any course was priced by inference", () => {
    // PCCST999 is not in the catalogue; inferCredits falls through to 4 for it
    // rather than admitting it does not know, so the semester total would be a
    // guess wearing the same clothes as a fact.
    const out = academicsToState(academics([...LISTED, "PCCST999"]));
    expect(out.history["S1"]!.creditsRegistered).toBeNull();
    // The earned total the portal DID publish is not thrown away with it.
    expect(out.history["S1"]!.creditsEarned).toBe(12);
  });

  it("treats a missing published total as unknown, not as zero", () => {
    const a = academics(LISTED);
    delete a.semesters[1]!.earnedCredits;
    expect(academicsToState(a).history["S1"]!.creditsEarned).toBeNull();
  });
});

/**
 * `entry.sgpa` is the portal's own figure, and KTU computed it without the
 * courses marked I or W. Summing those courses' credits into the registered
 * total anyway weighs the semester by a set of courses its SGPA never covered,
 * which pays the student their own average for the course they withdrew from.
 */
describe("a withdrawn course in a portal sync", () => {
  // GAPHT121 is the 4-credit entry in LISTED; without it the total is 11.
  it("leaves the registered total", () => {
    expect(academicsToState(graded("GAPHT121", "W")).history["S1"]!.creditsRegistered)
      .toBe(11);
  });

  it("does the same for an incomplete", () => {
    expect(academicsToState(graded("GAPHT121", "I")).history["S1"]!.creditsRegistered)
      .toBe(11);
  });

  // A pin, not a change: AB and F are results, and KTU keeps their credits in
  // the denominator it used. Only I and W move.
  it("does not take an absent or failed course with it", () => {
    expect(academicsToState(graded("GAPHT121", "AB")).history["S1"]!.creditsRegistered)
      .toBe(15);
    expect(academicsToState(graded("GAPHT121", "F")).history["S1"]!.creditsRegistered)
      .toBe(15);
  });

  // The portal publishes this one and it is not recomputed here, so a
  // withdrawal cannot move it in either direction.
  it("does not disturb the published earned total", () => {
    expect(academicsToState(graded("GAPHT121", "W")).history["S1"]!.creditsEarned)
      .toBe(12);
  });
});
