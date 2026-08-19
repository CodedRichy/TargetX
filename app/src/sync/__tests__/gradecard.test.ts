/**
 * What a parsed grade card is allowed to call a registered credit total.
 *
 * A grade card carries the university's own SGPA, and that figure is computed
 * without the courses marked I or W - KTU keeps a non-completion out of the
 * SGPA entirely, denominator included, until the course is finished. So the
 * credit total stored beside that SGPA has to cover the same set of courses.
 * It did not: it summed every parsed row, so the semester was weighed by
 * `printedSGPA x (real credits + withdrawn credits)` and the student was paid
 * their own average for the course they walked away from.
 *
 * The same slip scored the W a zero at full credits when recomputing the SGPA,
 * which then disagreed with the printed one and raised "the parse ate a row"
 * at every student holding a card with a withdrawal on it.
 */
import { describe, expect, it } from "vitest";
import { parseGradeCard } from "../gradecard";
import { cgpaFromSemesters } from "../../engine";

/**
 * S3 with a withdrawal. Three graded courses at 4 credits each:
 * A+ 9.0, B 7.5, C+ 7.0 -> (36 + 30 + 28) / 12 = 7.833, which is what the
 * university printed. The withdrawn CSL201 is worth 2 credits.
 */
const WITHDRAWN_CARD = [
  "SEMESTER 3",
  "MAT203  Discrete Mathematics  4  A+",
  "CST201  Data Structures  4  B",
  "CST203  Logic System Design  4  C+",
  "CSL201  Data Structures Lab  2  W",
  "SGPA: 7.833",
].join("\n");

/** The same card with the withdrawal marked absent instead: a real fail. */
const ABSENT_CARD = WITHDRAWN_CARD
  .replace("CSL201  Data Structures Lab  2  W", "CSL201  Data Structures Lab  2  AB")
  // (36 + 30 + 28 + 0) / 14 = 6.714 with the AB counted at full credits.
  .replace("SGPA: 7.833", "SGPA: 6.714");

describe("a withdrawn course on a grade card", () => {
  it("leaves the registered total, so it cannot weight the CGPA", () => {
    const sem = parseGradeCard(WITHDRAWN_CARD).semesters["S3"]!;
    // 4 + 4 + 4, not 4 + 4 + 4 + 2.
    expect(sem.credits).toBe(12);
    // W is a non-completion, so it was never earned either.
    expect(sem.creditsEarned).toBe(12);
  });

  it("is not counted as a zero, so the card no longer reads as mis-parsed", () => {
    const sem = parseGradeCard(WITHDRAWN_CARD).semesters["S3"]!;
    expect(sem.sgpaCalc).toBe(7.833);
    expect(sem.mismatch).toBe(false);
  });

  it("does not inflate the CGPA above the university's own figure", () => {
    const sem = parseGradeCard(WITHDRAWN_CARD).semesters["S3"]!;
    const cgpa = cgpaFromSemesters({
      S3: { sgpa: sem.sgpaPrinted!, creditsRegistered: sem.credits,
            creditsEarned: sem.creditsEarned },
    });
    expect(cgpa.cgpa).toBe(7.833);
    expect(cgpa.credits).toBe(12);
  });

  it("behaves the same when the card says I rather than W", () => {
    const sem = parseGradeCard(WITHDRAWN_CARD.replace("2  W", "2  I")).semesters["S3"]!;
    expect(sem.credits).toBe(12);
    expect(sem.mismatch).toBe(false);
  });
});

describe("an absent course on a grade card", () => {
  // A pin, not a change: the student was admitted to the exam and did not
  // appear, which is a real fail. Only I and W move. This assertion holds
  // identically before and after the fix, and is here so a later widening of
  // the incomplete set cannot take AB with it unnoticed.
  it("stays a fail at full credits", () => {
    const sem = parseGradeCard(ABSENT_CARD).semesters["S3"]!;
    expect(sem.credits).toBe(14);
    expect(sem.creditsEarned).toBe(12);
    expect(sem.sgpaCalc).toBe(6.714);
    expect(sem.mismatch).toBe(false);
  });
});
