// @vitest-environment jsdom
/**
 * The box answers, instead of pointing at a screen that answers.
 *
 * "If I take a leave tomorrow, how badly does it affect my attendance" used to
 * open the Attendance screen, which shows a static budget - how many classes
 * are left before 75% - and never what the NEXT absence costs. Those are
 * different facts, and the second one is the question.
 *
 * Every figure asserted here is re-derived from the engine in the test, never
 * copied from a run: if `absenceCost` or the band table changes, this file
 * fails rather than going on quoting a number the app no longer computes.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ATTENDANCE_MARK_BANDS, absenceCost, freeSkips } from "../../engine";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";

vi.mock("../../state/ask", () => ({
  askConfigured: () => false,
  askRemote: vi.fn(),
}));
vi.mock("../../state/auth", () => ({ signedIn: () => false }));

const { Palette } = await import("../Palette");

const FULL_AT = Math.max(...ATTENDANCE_MARK_BANDS.map(([p]) => p));

/** Sits exactly on the full-marks line, so one absence crosses a band. */
const EDGE: Partial<Course> = {
  code: "CST303", name: "Computer Networks", credits: 4, type: "TH 40/60",
  s1: 30, s2: 28, other: 8, dl: 0,
  held: 100, attended: Math.ceil((FULL_AT / 100) * 100),
};

/** Comfortably clear, so an absence costs nothing. */
const CLEAR: Partial<Course> = {
  code: "CST305", name: "Machine Learning", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, dl: 0, held: 100, attended: 99,
};

function open(...courses: Partial<Course>[]) {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
    d.timetable = undefined;
  });
  courses.forEach((c, i) => { addCourse(); updateCourse(i, c); });
  return render(() => <Palette open={true} onClose={() => {}} />);
}

const type = (value: string) => {
  const input = screen.getByLabelText("Search subjects and views") as HTMLInputElement;
  fireEvent.input(input, { target: { value } });
  return input;
};

afterEach(cleanup);
beforeEach(() => { edit((d) => { d.timetable = undefined; }); });

describe("the cost of the next absence is stated, not routed to", () => {
  it("names both sides of the change, so the student can check it", () => {
    open(EDGE);
    type("what happens if i miss one more class in computer networks");

    const cost = absenceCost(EDGE.attended!, EDGE.held!, 0, 1)!;
    // Derived, not copied: the sentence must carry the engine's own figures.
    expect(cost.marksLost).toBeGreaterThan(0);
    const said = screen.getByText(new RegExp(
      `${cost.before.toFixed(0)}%.*${cost.after.toFixed(0)}%`));
    expect(said).toBeTruthy();
    expect(said.textContent).toMatch(new RegExp(`costs ${cost.marksLost} mark`));
  });

  it("says free when it is free, and how much room is left", () => {
    open(CLEAR);
    type("what happens if i miss one more class in machine learning");

    const free = freeSkips(CLEAR.attended!, CLEAR.held!, 0)!;
    expect(absenceCost(CLEAR.attended!, CLEAR.held!, 0, 1)!.marksLost).toBe(0);
    expect(screen.getByText(new RegExp(`free \\(${free} to spare`))).toBeTruthy();
  });

  it("answers about every subject when none is named", () => {
    open(EDGE, CLEAR);
    type("what happens if i miss one more class");
    expect(screen.getByText(/What one more absence costs, per subject/)).toBeTruthy();
    expect(screen.getByText(/Computer Networks/)).toBeTruthy();
    expect(screen.getByText(/Machine Learning/)).toBeTruthy();
  });

  it("still offers the working, because the sentence is not a substitute for it", () => {
    open(EDGE);
    type("what happens if i miss one more class");
    expect(screen.getByText("See the full breakdown")).toBeTruthy();
  });

  it("says nothing at all when attendance was never recorded", () => {
    open({ ...EDGE, attended: null, held: null, attendance: null });
    type("what happens if i miss one more class");
    // A sentence built from nothing is worse than no sentence.
    expect(screen.queryByText(/costs/)).toBeNull();
  });
});

describe("tomorrow joins the timetable to the budget", () => {
  const withTimetable = () => edit((d) => {
    // Every weekday carries the same two subjects, so the test does not depend
    // on which day it is run.
    d.timetable = {
      grid: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        .map((day) => ({
          day,
          periods: [
            { subject: "CST303 Computer Networks", teacher: null },
            { subject: "CST305 Machine Learning", teacher: null },
          ],
        })),
      substitutions: [],
    };
  });

  it("prices each subject that actually runs tomorrow", () => {
    open(EDGE, CLEAR);
    withTimetable();
    type("can i skip tomorrow");

    expect(screen.getByText(/Tomorrow costs you something/)).toBeTruthy();
    // The one that crosses a band is priced; the one that does not is free.
    const cost = absenceCost(EDGE.attended!, EDGE.held!, 0, 1)!;
    expect(screen.getByText(new RegExp(`costs ${cost.marksLost} mark`))).toBeTruthy();
    expect(screen.getByText(/Machine Learning.*free/)).toBeTruthy();
  });

  it("says tomorrow is free when nothing on it costs a mark", () => {
    open(CLEAR);
    edit((d) => {
      d.timetable = {
        grid: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
          .map((day) => ({
            day, periods: [{ subject: "CST305 Machine Learning", teacher: null }],
          })),
        substitutions: [],
      };
    });
    type("can i skip tomorrow");
    expect(screen.getByText(/Tomorrow is free/)).toBeTruthy();
  });

  it("declines rather than guessing when there is no timetable", () => {
    open(EDGE, CLEAR);
    type("can i skip tomorrow");
    // No timetable means the app does not know what runs tomorrow. Listing
    // every subject would be answering a question it was not asked.
    expect(screen.queryByText(/Tomorrow/)).toBeNull();
  });

  it("drops a timetable subject the student does not have, rather than naming it", () => {
    open(CLEAR);
    edit((d) => {
      d.timetable = {
        grid: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
          .map((day) => ({
            day,
            periods: [
              { subject: "CST305 Machine Learning", teacher: null },
              { subject: "MAT101 Some Elective Nobody Registered", teacher: null },
            ],
          })),
        substitutions: [],
      };
    });
    type("can i skip tomorrow");
    expect(screen.queryByText(/Some Elective/)).toBeNull();
    expect(screen.getByText(/Machine Learning/)).toBeTruthy();
  });
});

describe("the plain attendance question is answered, not routed", () => {
  it("states the percentage with the counts behind it", () => {
    open(EDGE);
    type("whats my attendance in computer networks");
    // Percentage AND counts, both derived from the fixture rather than typed
    // in: a percentage on its own is a figure the student cannot check against
    // their own portal, and a literal here would stop tracking the band table.
    const cost = absenceCost(EDGE.attended!, EDGE.held!, 0, 0)!;
    expect(screen.getByText(new RegExp(
      `${cost.before.toFixed(0)}%.*\(${EDGE.attended} of ${EDGE.held}\)`))).toBeTruthy();
  });

  it("says what the attendance is currently earning in CIE marks", () => {
    open(EDGE);
    type("whats my attendance in computer networks");
    expect(screen.getByText(/of the attendance CIE/)).toBeTruthy();
  });
});

describe("what a subject needs in the final", () => {
  it("states the mark required to pass, out of the paper's own maximum", () => {
    open(EDGE);
    type("what do i need to pass computer networks");
    expect(screen.getByText(/needs \d+ of \d+ in the final to pass/)).toBeTruthy();
  });

  it("answers for every subject when none is named", () => {
    open(EDGE, CLEAR);
    type("what do i need to pass");
    expect(screen.getByText(/What each subject needs in the final/)).toBeTruthy();
  });
});

describe("standing is a fact about the record, not about one subject", () => {
  it("says nothing when no semester has been published", () => {
    open(EDGE);
    edit((d) => { d.history = {}; });
    type("whats my cgpa");
    // A CGPA computed from nothing is the 0.00 this app refuses to print.
    expect(screen.queryByText(/CGPA \d/)).toBeNull();
  });

  it("states the CGPA once published, with the credits it is weighted by", () => {
    open(EDGE);
    edit((d) => {
      d.history = {
        S3: { sgpa: 8.2, creditsRegistered: 20, creditsEarned: 20,
              source: "gradecard", conflict: null },
      };
    });
    type("whats my cgpa");
    expect(screen.getByText("CGPA 8.20")).toBeTruthy();
    expect(screen.getByText(/20 registered credits counted/)).toBeTruthy();
  });
});

describe("eligibility is answered from the record", () => {
  it("does not claim every subject is fine when one is not", () => {
    open(EDGE, { ...CLEAR, attended: 60, held: 100 });
    type("am i eligible");
    expect(screen.getByText(/1 of 2 below 75%/)).toBeTruthy();
  });

  it("says so plainly when all of them are", () => {
    open(EDGE, CLEAR);
    type("am i eligible");
    expect(screen.getByText(/Eligible in all 2/)).toBeTruthy();
  });
});
