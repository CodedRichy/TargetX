/**
 * Folding a pasted page into a semester that already has data in it.
 *
 * Three ways this used to go wrong, all of them silent. Two rows under the
 * same course code collapsed onto one course; a refused row was counted rather
 * than named; and a published CIE total left in place made the new marks
 * change nothing on screen, so the student went on trusting a superseded
 * internal.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { blankCourse } from "../../engine";
import { importPaste } from "../actions";
import { edit, state } from "../store";

const courses = () => state.semesters[state.activeSemester]!.courses;

beforeEach(() => {
  edit((s) => {
    s.activeSemester = "S5";
    s.semesters = {
      S5: {
        courses: [
          { ...blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60"), s1: 30 },
          { ...blankCourse("PCCST502", "Algorithms", 4, "TH 40/60"), s1: 20 },
        ],
      },
    };
  });
});

describe("a re-registered backlog under the same code", () => {
  it("does not have its marks written onto its twin", () => {
    // A backlog course sits in the same semester as the current attempt, under
    // the same code. A code-to-index map keeps only the last of the two, so
    // both pasted rows landed on one course and the other silently kept its
    // old mark.
    edit((s) => {
      s.semesters["S5"]!.courses.push(
        { ...blankCourse("PCCST501", "Computer Networks (backlog)", 4, "TH 40/60") });
    });

    importPaste([
      "PCCST501  Computer Networks  41  38  9",
      "PCCST501  Computer Networks  22  19  4",
    ].join("\n"), "marks");

    const both = courses().filter((c) => c.code === "PCCST501");
    expect(both).toHaveLength(2);
    expect([both[0]!.s1, both[0]!.s2]).toEqual([41, 38]);
    expect([both[1]!.s1, both[1]!.s2]).toEqual([22, 19]);
  });
});

describe("a published CIE total", () => {
  it("is cleared by a marks paste that supersedes it", () => {
    // `cie_override` outranks the components everywhere it is set, so leaving
    // a stale one behind made the import look like it had done nothing.
    edit((s) => { s.semesters["S5"]!.courses[0]!.cie_override = 34; });

    importPaste("PCCST501  Computer Networks  41  38  9\n", "marks");

    expect(courses()[0]!.cie_override).toBe("");
    expect(courses()[0]!.s1).toBe(41);
  });

  it("survives an attendance paste, which supersedes nothing", () => {
    edit((s) => { s.semesters["S5"]!.courses[0]!.cie_override = 34; });

    importPaste("PCCST501  Computer Networks  41  48  85.4%\n", "attendance");

    expect(courses()[0]!.cie_override).toBe(34);
    expect(courses()[0]!.attendance).toBe(85.4);
  });
});

describe("a row whose columns cannot be identified", () => {
  it("is reported by course code and changes nothing", () => {
    const before = { ...courses()[1]! };

    const outcome = importPaste(
      "PCCST502  Algorithms  42 50 40 50 9 10\n", "marks");

    expect(outcome.skipped).toBe(1);
    expect(outcome.refused[0]).toContain("PCCST502");
    expect(courses()[1]!.s1).toBe(before.s1);
    expect(courses()[1]!.s2).toBe(before.s2);
  });

  it("does not stop the rows around it from importing", () => {
    const outcome = importPaste([
      "PCCST501  Computer Networks  41  38  9",
      "PCCST502  Algorithms  42 50 40 50 9 10",
    ].join("\n"), "marks");

    expect(outcome.matched).toBe(1);
    expect(outcome.skipped).toBe(1);
    expect(courses()[0]!.s1).toBe(41);
  });
});
