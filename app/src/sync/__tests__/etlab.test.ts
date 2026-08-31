/**
 * What a portal sync is allowed to call a registered credit total.
 *
 * etlab publishes an EARNED total per semester and nothing else, so the
 * registered total - the CGPA denominator - can only be added up from the
 * courses. That sum is a fact only when the published curriculum priced every
 * course the sum actually uses; `inferCredits` never fails, so an inferred
 * total would be indistinguishable from a known one once it is stored as a
 * number. A course graded I or W is not one the sum uses.
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

/**
 * The same five listed courses, with `code` carrying `grade` and the rest a
 * plain B.
 *
 * `earnedCredits` is 11 because `grade` is always one that does not pass, and
 * every call below names the 4-credit GAPHT121, leaving 3 + 3 + 1 + 4 for the
 * portal to publish as earned. That it also equals the registered total of 11
 * for a W or an I is a property of this fixture, not a rule: the portal
 * publishes its earned total itself, and it can legitimately exceed the
 * registered one when a backlog course cleared this semester is absent from
 * the course list.
 */
const graded = (code: string, grade: string): Academics => ({
  current: null,
  semesters: {
    1: {
      courses: LISTED.map((c) => course(c, c === code ? grade : "B")),
      sgpa: 7.5, earnedCredits: 11,
    },
  },
});

describe("history from a portal sync", () => {
  it("adds up a registered total when the curriculum priced every course", () => {
    expect(academicsToState(academics(LISTED)).history["S1"]).toEqual(
      { sgpa: 7.5, creditsRegistered: 15, creditsEarned: 12, source: "etlab", conflict: null });
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
      .toBe(11);
  });
});

/**
 * The credits of a course the sum does not use cannot make the sum wrong.
 *
 * `allCreditsListed` refuses the whole total when any course was priced by
 * inference, and it used to include I/W courses in "any" - whose credits the
 * sum stopped using. Refusing there is not the safe direction it looks like:
 * `creditsRegistered: null` sends `historyCredits` down its `??` chain to
 * `creditsEarned`, which counts a DIFFERENT set of courses again, so the CGPA
 * gets a wrong denominator wherever there is a backlog.
 */
describe("an unpriced course in a portal sync", () => {
  const withExtra = (extra: PortalCourse, earned: number): Academics => ({
    current: null,
    semesters: {
      1: { courses: [...LISTED.map((c) => course(c, "B")), extra],
           sgpa: 7.5, earnedCredits: earned },
    },
  });

  it("does not refuse the total over a withdrawn course it could not price", () => {
    // ZZZZ999 is not in the catalogue, so its credits would be a guess - but a
    // withdrawn course contributes none, so the guess is never read. All five
    // listed courses pass, so 15 is both the registered and the earned total.
    expect(academicsToState(withExtra(course("ZZZZ999", "W"), 15))
      .history["S1"]!.creditsRegistered).toBe(15);
  });

  // A pin, not a change: the narrowing is exactly I and W. An unpriced course
  // with a real grade would contribute its guessed credits to the sum, so the
  // sum would be a guess and is still refused outright.
  it("still refuses the total over a failed course it could not price", () => {
    expect(academicsToState(withExtra(course("ZZZZ999", "F"), 15))
      .history["S1"]!.creditsRegistered).toBeNull();
  });
});
