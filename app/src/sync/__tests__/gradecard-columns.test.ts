/**
 * The grade card, read as columns.
 *
 * A KTU result row is
 *
 *     CODE   Course title   CREDITS   GRADE   RESULT
 *
 * and every defect pinned here came from not modelling that last column. The
 * parser used to keep the LAST grade-shaped token on the row, which is the
 * Result column on every real card: an A+ imported as a P, and a supplementary
 * row `4 P S3(S)` imported as an S — a 10.0 — against a course the student had
 * re-sat.
 *
 * These are written from row shapes that appear on a real KTU consolidated
 * grade card, because none of these defects were reachable from the synthetic
 * rows the existing suite used: those had no Result column at all.
 */
import { describe, expect, it } from "vitest";
import { parseGradeCard } from "../gradecard";

/** S3 as KTU prints it: credits, grade, then a Result column. */
const CARD = [
  "SEMESTER 3",
  "MAT203  Discrete Mathematical Structures  4  A+  P",
  "CST201  Data Structures  4  B  P",
  "CST203  Logic System Design  4  C+  P",
  "MCN201  Sustainable Engineering  0  P  P",
  "SGPA: 7.833",
].join("\n");

const courseOf = (text: string, sem: string, code: string) =>
  parseGradeCard(text).semesters[sem]!.courses.find((c) => c.code === code);

describe("the result column", () => {
  it("is not read as the grade", () => {
    // (36 + 30 + 28) / 12 = 7.833. Reading the Result column instead gives
    // every course a P, which is 4.0 flat.
    expect(courseOf(CARD, "S3", "MAT203")?.grade).toBe("A+");
    expect(courseOf(CARD, "S3", "CST201")?.grade).toBe("B");
    expect(parseGradeCard(CARD).semesters["S3"]!.sgpaCalc).toBe(7.833);
  });

  it("does not turn a supplementary marker into an S", () => {
    // A re-sat course carries its own semester in the result column. `S3(S)`
    // scored an S, which is a 10.0 for a course the student only just passed.
    const line = "CST202  Computer Organisation  4  P  S3(S)";
    const course = courseOf([...CARD.split("\n"), line].join("\n"), "S3", "CST202");
    expect(course?.grade).toBe("P");
  });

  it("does not let a supplementary marker relabel the rest of the card", () => {
    // The marker used to move the parser's semester context, so every row
    // after a re-sat course landed in that course's semester rather than its
    // own. Here an S5 card carries one re-sat S3 course in the middle.
    const card = [
      "SEMESTER 5",
      "CST301  System Software  4  A  P",
      "CST202  Computer Organisation  4  P  S3(S)",
      "CST303  Computer Networks  4  B+  P",
    ].join("\n");
    const parsed = parseGradeCard(card);
    expect(parsed.semesters["S5"]!.courses.map((c) => c.code))
      .toEqual(["CST301", "CST303"]);
    // The re-sat course belongs to the semester it was originally taken in.
    expect(parsed.semesters["S3"]!.courses.map((c) => c.code)).toEqual(["CST202"]);
  });
});

describe("the credits column", () => {
  it("keeps a zero-credit course at zero", () => {
    // MCN courses are mandatory and carry no credit. Treating 0 as "missing"
    // and substituting 3 weighed a non-credit course into the SGPA - and at a
    // P, which drags every real grade down.
    expect(courseOf(CARD, "S3", "MCN201")?.credits).toBe(0);
    expect(parseGradeCard(CARD).semesters["S3"]!.credits).toBe(12);
  });

  it("is not confused by a number inside the course title", () => {
    const card = "SEMESTER 2\nPHT100  Engineering Physics 2  4  A  P";
    expect(courseOf(card, "S2", "PHT100")?.credits).toBe(4);
    expect(courseOf(card, "S2", "PHT100")?.grade).toBe("A");
  });

  it("survives a mark column between the credits and the grade", () => {
    const card = "SEMESTER 3\nCST201  Data Structures  4  76  B  P";
    expect(courseOf(card, "S3", "CST201")?.credits).toBe(4);
    expect(courseOf(card, "S3", "CST201")?.grade).toBe("B");
  });
});

describe("rows that are not results", () => {
  it("does not invent a grade out of the course title", () => {
    // "Engineering Mathematics I" ends in a token that is also a grade. The
    // row has no credits-then-grade pair, so it is not a result row at all -
    // it used to import as a real course graded Incomplete.
    const card = "SEMESTER 1\nMAT101  Engineering Mathematics I  4";
    expect(parseGradeCard(card).semesters["S1"]).toBeUndefined();
  });

  it("still reads a title that merely contains a grade token", () => {
    const card = "SEMESTER 1\nMAT101  Engineering Mathematics I  4  B+  P";
    const course = courseOf(card, "S1", "MAT101");
    expect(course?.grade).toBe("B+");
    expect(course?.name).toBe("Engineering Mathematics I");
  });
});

describe("two courses on one line", () => {
  it("reads both", () => {
    // A PDF whose rows sit close together hands two courses over as one line.
    // Only the first was read, and the second vanished without a trace.
    const card = "SEMESTER 3\nCST201  Data Structures  4  B  P  CST203  Logic Design  4  C+  P";
    const codes = parseGradeCard(card).semesters["S3"]!.courses.map((c) => c.code);
    expect(codes).toEqual(["CST201", "CST203"]);
  });
});

describe("the printed SGPA", () => {
  it("is read even when it shares a line with a course", () => {
    // This is the detector: without the printed figure there is nothing to
    // compare the recomputed one against, so a mis-parsed card imports
    // silently. It used to be skipped on any line carrying a course code.
    const card = [
      "SEMESTER 3",
      "MAT203  Discrete Mathematical Structures  4  A+  P",
      "CST201  Data Structures  4  B  P  SGPA: 8.250",
    ].join("\n");
    const sem = parseGradeCard(card).semesters["S3"]!;
    expect(sem.sgpaPrinted).toBe(8.25);
    // (36 + 30) / 8 = 8.25, so this particular card agrees.
    expect(sem.mismatch).toBe(false);
  });

  it("raises a mismatch when the parse and the university disagree", () => {
    const card = CARD.replace("SGPA: 7.833", "SGPA: 9.100");
    expect(parseGradeCard(card).semesters["S3"]!.mismatch).toBe(true);
  });
});
