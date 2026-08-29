/**
 * What a pasted marks page is allowed to be read as.
 *
 * The parser used to take the first three numbers on the row and call them S1,
 * S2 and the assignment. An etlab marks page prints each mark beside its
 * maximum, so a real row reads `42 50 40 50 9 10` — and that mapping put the
 * S2 MAXIMUM into S2 and the S2 mark into a column whose scale is 10. The
 * result is a confident CIE that is wrong, over a semester the student had
 * already synced correctly, with nothing on screen to suggest anything
 * happened.
 *
 * The rule these pin: a row is read only when its columns can be identified.
 * Otherwise it is refused BY NAME, because "3 rows skipped" is not something a
 * student can act on and a course code is.
 */
import { describe, expect, it } from "vitest";
import { COURSE_TYPES, parseEtlab } from "..";

const marks = (line: string) => parseEtlab(`${line}\n`, "marks");

describe("a marks paste", () => {
  it("reads three plain numbers as the three components", () => {
    const { rows, skipped } = marks("PCCST304 Digital Logic 45 38 9");
    expect([rows[0]!.s1, rows[0]!.s2, rows[0]!.other]).toEqual([45, 38, 9]);
    expect(skipped).toEqual([]);
  });

  it("refuses a row where the maximums are printed beside the marks", () => {
    // The defect, exactly: 42/50, 40/50, 9/10 flattened into bare columns.
    const { rows, skipped } = marks("PCCST501 Computer Networks 42 50 40 50 9 10");
    expect(rows).toEqual([]);
    expect(skipped[0]?.code).toBe("PCCST501");
  });

  it("reads that same row when the maximums are written as fractions", () => {
    const { rows, skipped } = marks("PCCST501 Computer Networks 42/50 40/50 9/10");
    expect([rows[0]!.s1, rows[0]!.s2, rows[0]!.other]).toEqual([42, 40, 9]);
    expect(skipped).toEqual([]);
  });

  it("refuses a value that cannot fit the column it would land in", () => {
    // `other` is out of 10 on every course type, so 40 is proof the columns
    // are not what the parser thinks they are - whatever the column count is.
    const raw = Math.max(...Object.values(COURSE_TYPES)
      .map((spec) => spec.components[2]?.rawMax ?? 0));
    expect(raw).toBe(10);
    const { rows, skipped } = marks(`PCCST502 Algorithms 42 40 ${raw + 30}`);
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("reads a single fraction as one mark, not as a mark and a maximum", () => {
    // Mid-semester a row often carries only S1. Falling through to the bare
    // number path would read `42/50` as S1 42, S2 50 - the maximum written in
    // as a mark, which is the defect this whole function exists to prevent.
    const { rows, skipped } = marks("PCCST501 Computer Networks 42/50");
    expect(rows[0]!.s1).toBe(42);
    expect(rows[0]!.s2).toBeUndefined();
    expect(skipped).toEqual([]);
  });

  it("refuses a fraction whose numerator exceeds its denominator", () => {
    // Then they were never mark/max pairs: a date, a ratio, a page number.
    const { rows, skipped } = marks("PCCST501 Computer Networks 12/08 40/50");
    expect(rows).toEqual([]);
    expect(skipped).toHaveLength(1);
  });

  it("still takes a partial row, which is the common case mid-semester", () => {
    // Only S1 has been held. Two numbers is not ambiguous, it is incomplete.
    const { rows, skipped } = marks("PCCST503 Machine Learning 44");
    expect(rows[0]!.s1).toBe(44);
    expect(rows[0]!.s2).toBeUndefined();
    expect(skipped).toEqual([]);
  });

  it("names the subject it refused, not just a count", () => {
    const { skipped } = marks("PCCST501 Computer Networks 42 50 40 50 9 10");
    expect(skipped[0]!.code).toBe("PCCST501");
    expect(skipped[0]!.reason).toMatch(/maximum/i);
  });

  it("leaves lines without a course code alone", () => {
    const { rows, skipped } = marks("Total marks obtained 132 150");
    expect(rows).toEqual([]);
    // Not a refusal either: it was never a course row.
    expect(skipped).toEqual([]);
  });
});
