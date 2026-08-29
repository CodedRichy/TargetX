// @vitest-environment jsdom
/**
 * When the mark split is a guess, say which subjects it was a guess for.
 *
 * Three things can supply a course's CIA/ESE split: the published curriculum,
 * the portal's own Theory/Practical page, and - when neither does - the
 * letters in the course code. The third is a guess, and it decides the CIE
 * maximum, which decides every projected grade on that course.
 *
 * This is the n=1 failure that will not announce itself. At the college this
 * was built against, nearly every code is in the catalogue. At the next one,
 * most will not be, and `/student/subject` may not exist at all - so the split
 * falls to the code letters for most of the semester, silently. `fitType`
 * only catches it when the published internal exceeds the guessed ceiling: a
 * 50/50 course whose internal is 30 fits inside a 40/60 ceiling and stays
 * wrong.
 */
import { describe, expect, it } from "vitest";
import { academicsToState } from "../etlab";
import type { Academics } from "../etlab";

const record = (...codes: string[]): Academics => ({
  current: 5,
  semesters: {
    5: {
      label: "S5",
      sgpa: null,
      courses: codes.map((code) => ({
        code, name: code, attended: 40, held: 48, attendance: 83.3,
        internal: 30, grade: null, result: null, gpa: null, series: [],
      })),
    },
  },
});

describe("the subjects whose mark split was inferred", () => {
  it("does not include one the published curriculum prices", () => {
    // PCCST501 is in the bundled catalogue, so nothing was guessed about it.
    const result = academicsToState(record("PCCST501"));
    expect(result.inferredTypes).toEqual([]);
  });

  it("does not include one the portal's own subject page typed", () => {
    const result = academicsToState(record("ZZZZT999"), { ZZZZT999: "LAB 50/50" });
    expect(result.inferredTypes).toEqual([]);
  });

  it("includes one that nothing but the code letters could type", () => {
    const result = academicsToState(record("ZZZZT999"));
    expect(result.inferredTypes).toEqual(["ZZZZT999"]);
  });

  it("names every one of them, because a count sends you through the lot", () => {
    const result = academicsToState(record("PCCST501", "ZZZZT999", "YYYYL888"));
    expect(result.inferredTypes).toEqual(["ZZZZT999", "YYYYL888"]);
  });
});
