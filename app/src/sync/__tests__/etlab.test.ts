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

const course = (code: string): PortalCourse => ({
  code, name: "", attended: null, held: null, attendance: null,
  internal: null, grade: null, result: null, gpa: null, series: [],
});

/** Codes in the bundled curriculum: 3 + 4 + 3 + 1 + 4 = 15 credits. */
const LISTED = ["GAMAT101", "GAPHT121", "GMEST103", "GXESL106", "UCEST105"];

const academics = (codes: string[]): Academics => ({
  current: null,
  semesters: { 1: { courses: codes.map(course), sgpa: 7.5, earnedCredits: 12 } },
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
