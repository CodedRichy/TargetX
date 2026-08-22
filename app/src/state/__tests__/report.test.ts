/**
 * The pasteable text report.
 *
 * It exists to be pasted into a message to a tutor or a parent, so its columns
 * are the whole format: a row that overflows its field shifts every column to
 * the right of it on that row alone, and the table stops reading as a table.
 * The ">=" that marks an internal still missing its attendance component is
 * two characters wide, and it was added without widening the column it sits
 * in.
 */
import { describe, expect, it } from "vitest";
import { blankCourse, evaluate, statusFor, summarise } from "../../engine";
import type { Course } from "../../engine";
import { reportText } from "../actions";

const row = (course: Course) => ({
  course,
  ev: evaluate(course) as unknown as Record<string, unknown>,
  status: statusFor(evaluate(course)),
});

/**
 * The single space between each pair of fields, by offset: code 10, credits 2,
 * CIE 10, attendance 5, need-pass 10, need-target 12, grade 6. A field that
 * outgrows its width eats its own separator, so a non-space at any of these is
 * exactly the shift this checks for.
 */
const SEPARATORS = [10, 13, 24, 30, 41, 54, 61];

describe("the text report lines up", () => {
  const courses = (): Course[] => [
    // Settled: attendance recorded, exam written.
    {
      ...blankCourse("PCCST501", "CN", 4, "TH 40/60"),
      s1: 45, s2: 45, other: 9, attendance: 90, ese: 42,
    },
    // The floor case: internals marked, attendance blank. ">=" shows here.
    { ...blankCourse("PCCST502", "DAA", 4, "TH 40/60"), s1: 45, s2: 45, other: 9 },
    // The widest cell the format can produce: a 100-mark bucket.
    {
      ...blankCourse("PRJST501", "Project", 4, "PRJ 100/0"),
      s1: 50, s2: 50, other: 10, attendance: 90,
    },
    // Nothing marked at all: a dash rather than a figure.
    blankCourse("PCCST503", "OS", 4, "TH 40/60"),
  ];

  it("keeps every column at the same offset, marker or no marker", () => {
    const rows = courses().map(row);
    const text = reportText(rows as never, "S5", summarise(courses()) as never);
    const lines = text.split("\n");
    const body = lines.slice(4, 4 + rows.length); // one line per course

    expect(lines[3]).toContain("CODE");
    expect(body.length).toBe(4);
    expect(body.some((line) => line.includes(">="))).toBe(true);
    for (const line of body) {
      expect(SEPARATORS.map((i) => line[i])).toEqual(SEPARATORS.map(() => " "));
    }
    // And the header's own labels still sit over the fields they name.
    expect(lines[3]!.indexOf("ATT%") + 4).toBe(30);
    expect(lines[3]!.indexOf("CR") + 2).toBe(13);
  });

  it("says nothing in the required-mark columns for an unsettled internal", () => {
    const unsettled = courses()[1]!;
    const text = reportText([row(unsettled)] as never, "S5",
                            summarise([unsettled]) as never);
    const line = text.split("\n").find((l) => l.startsWith("PCCST502"))!;
    expect(line).toContain(">=31.5/40");
    // The floor prices no requirement, so neither column quotes one.
    expect(line).not.toContain("/60");
    expect(line).toContain("PENDING");
  });
});
