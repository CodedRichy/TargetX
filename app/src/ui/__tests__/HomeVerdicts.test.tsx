/**
 * Three sentences Home used to get wrong, all in the same way: a number or a
 * state the app did not have, reported as a fact the student could act on.
 *
 *   - A CGPA of 0.00 for a student with no completed semester. The largest
 *     figure on the screen telling a first year they had failed everything, on
 *     the day they installed it.
 *   - "Target is out of reach", in red, when the real answer was that no
 *     subjects had been entered yet.
 *   - "N classes in a row to be eligible" to a student below the condonation
 *     floor, where R 6.2 leaves no route back at all. Not encouragement — a
 *     wrong instruction they would follow.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { ATTENDANCE_CONDONE, ATTENDANCE_MIN, blankCourse, defaultTargets } from "../../engine";
import { edit, setGoal } from "../../state/store";
import { Home } from "../Home";

const reset = () => {
  edit((s) => {
    s.activeSemester = "S5";
    s.semesters = { S5: { courses: [] } };
    s.history = {};
    s.goal = defaultTargets();
  });
};

beforeEach(reset);
afterEach(cleanup);

const withAttendance = (pct: number) => {
  edit((s) => {
    s.semesters["S5"] = {
      courses: [{
        ...blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60"),
        attendance: pct, s1: 30, s2: 28, other: 8,
      }],
    };
  });
};

describe("the standing figure", () => {
  it("is a dash, not 0.00, before any semester is complete", () => {
    withAttendance(90);
    const { container } = render(() => <Home />);
    // Scoped to the hero figure: 0.00 is a legitimate reading elsewhere on
    // this screen, and the defect was specifically the largest number on it.
    expect(container.querySelector(".hero-number .huge")!.textContent).not.toBe("0.00");
    expect(screen.getByText(/no completed semester yet/)).toBeTruthy();
  });

  it("is the real CGPA once a semester is on record", () => {
    withAttendance(90);
    edit((s) => {
      s.history["S3"] = { sgpa: 7.83, creditsRegistered: 22, creditsEarned: 22, source: "gradecard", conflict: null };
    });
    render(() => <Home />);
    expect(screen.getByText("7.83")).toBeTruthy();
  });
});

describe("a target with nothing to solve against", () => {
  it("asks for the subjects instead of calling the target unreachable", () => {
    // A returning student: past semesters on record, this one not entered yet.
    // Zero registered credits now, so there is nothing to solve the target
    // against - which is missing data, not an unreachable goal.
    edit((s) => {
      s.history["S3"] = { sgpa: 7.83, creditsRegistered: 22, creditsEarned: 22, source: "gradecard", conflict: null };
    });
    setGoal(8);
    render(() => <Home />);
    expect(screen.queryByText(/out of reach/i)).toBeNull();
    expect(screen.getByText(/Add this semester's subjects/)).toBeTruthy();
  });
});

describe("a subject below the condonation floor", () => {
  it("is not told to attend its way back", () => {
    withAttendance(ATTENDANCE_CONDONE - 10);
    render(() => <Home />);
    expect(screen.queryByText(/classes in a row to be eligible/)).toBeNull();
    expect(screen.getByText(new RegExp(`${ATTENDANCE_CONDONE}% condonation floor`))).toBeTruthy();
  });

  it("still gets the route back when one exists", () => {
    // Between the floor and the line, condonation applies and attending helps.
    withAttendance(ATTENDANCE_MIN - 5);
    render(() => <Home />);
    expect(screen.getByText(new RegExp(`below ${ATTENDANCE_MIN}%`))).toBeTruthy();
  });
});

describe("the attendance tile", () => {
  it("does not say there is nothing to reclaim under a count of marks lost", () => {
    // A student who typed a bare percentage has given the app no classes to
    // count, so no band can be priced - and the tile used to answer that with
    // "every subject is already in its top attendance band", directly below
    // the marks it had just said were gone.
    withAttendance(71);
    render(() => <Home />);
    expect(screen.queryByText(/Nothing to reclaim/)).toBeNull();
    expect(screen.getByText(/Enter attended and held/)).toBeTruthy();
  });

  it("still says so when every subject really is in its top band", () => {
    edit((s) => {
      s.semesters["S5"] = {
        courses: [{
          ...blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60"),
          attended: 48, held: 48, s1: 40,
        }],
      };
    });
    render(() => <Home />);
    expect(screen.getByText(/Nothing to reclaim/)).toBeTruthy();
  });
});

/**
 * The same defect as the CGPA one, one tile down, and it survived the fix.
 *
 * `sgpa()` returns 0 for an empty register, so a semester with nothing graded
 * printed "0.00" under the word Confirmed - a score, on a screen whose whole
 * claim is that it never states a figure it cannot show the working for.
 *
 * And the sentence under it made the number worse. `pending` and `unsettled`
 * between them were meant to catch every reason Confirmed could be empty, but
 * they miss the ordinary middle of a semester: every internal is in, no exam
 * has been sat. Nothing pending, nothing unsettled, nothing confirmed - and
 * the tile answered that with "Every subject has been assessed", which is true
 * and reads as an all-clear over a zero. Assessed is not graded.
 */
describe("the semester tile before anything is graded", () => {
  /** Every component marked, attendance known, no result published. */
  const midSemester = () => edit((s) => {
    s.semesters["S5"] = {
      courses: [{
        ...blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60"),
        attended: 44, held: 50, s1: 30, s2: 28, other: 8,
      }],
    };
  });

  it("shows a dash rather than a confirmed score of zero", () => {
    midSemester();
    const { container } = render(() => <Home />);
    const stats = [...container.querySelectorAll(".now .stat")].map((e) => e.textContent);
    // Projected is a real figure and stays. Confirmed has no population to
    // average over, and an average over nothing is absent, not zero.
    expect(stats).not.toContain("0.00");
    expect(stats).toContain("—");
  });

  it("says nothing is graded, instead of calling it all clear", () => {
    midSemester();
    render(() => <Home />);
    expect(screen.getByText(/none is graded yet/)).toBeTruthy();
  });

  it("does not leave the all-clear standing on its own", () => {
    midSemester();
    const { container } = render(() => <Home />);
    const verdict = container.querySelector(".now .tile-verdict")!.textContent!;
    // The words may still appear - they are accurate - but never as the whole
    // sentence, which is what made them read as reassurance.
    expect(verdict.trim()).not.toBe("Every subject has been assessed.");
  });

  it("still gives the plain all-clear once something is actually confirmed", () => {
    edit((s) => {
      s.semesters["S5"] = {
        courses: [{
          ...blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60"),
          attended: 44, held: 50, s1: 30, s2: 28, other: 8, ese: 50,
        }],
      };
    });
    const { container } = render(() => <Home />);
    const stats = [...container.querySelectorAll(".now .stat")].map((e) => e.textContent);
    // A real grade exists, so Confirmed has a population and prints a figure.
    expect(stats).not.toContain("—");
    expect(container.querySelector(".now .tile-verdict")!.textContent)
      .toContain("Every subject has been assessed.");
  });
});
