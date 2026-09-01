// @vitest-environment jsdom
/**
 * The working for the loudest number in the app.
 *
 * The Attendance screen led with a percentage and a miss budget and never
 * showed the two counts they are computed from - those existed only as
 * editable inputs inside one expanded Ledger row, so a student who wanted to
 * check their own figure had to open seven rows one at a time. An app whose
 * position is that it never states a number it cannot show its working for was
 * not showing the working for its most prominent one.
 */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";
import { Attendance } from "../Attendance";

const CN: Partial<Course> = {
  code: "CST303", name: "Computer Networks", credits: 4, type: "TH 40/60",
  attended: 39, held: 50, dl: 0,
};

function open(...courses: Partial<Course>[]) {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.daywiseAttendance = undefined;
    d.timetable = undefined;
  });
  courses.forEach((c, i) => { addCourse(); updateCourse(i, c); });
  return render(() => <Attendance />);
}

afterEach(cleanup);

describe("the counts behind the percentage are on the card", () => {
  it("states attended of held", () => {
    open(CN);
    expect(screen.getByText(/39 of 50 attended/)).toBeTruthy();
  });

  it("says how much duty leave was credited, since it moves the percentage", () => {
    open({ ...CN, dl: 3 });
    // Credited DL is why the shown percentage differs from attended/held, so
    // omitting it would leave the working not actually adding up.
    expect(screen.getByText(/duty leave credited/)).toBeTruthy();
  });

  it("does not mention duty leave when there is none", () => {
    open(CN);
    expect(screen.queryByText(/duty leave credited/)).toBeNull();
  });

  it("says nothing rather than zeroes when attendance was never recorded", () => {
    open({ ...CN, attended: null, held: null });
    expect(screen.queryByText(/of .* attended/)).toBeNull();
  });
});

describe("the day-by-day log is a second opinion, not decoration", () => {
  const seedLog = (statuses: Array<[string, string]>) => edit((d) => {
    d.daywiseAttendance = [{
      label: "1st",
      periods: statuses.map(([status, subject]) => ({
        status: status as never, subject,
      })),
    }];
  });

  it("says the two figures match when they do", () => {
    open({ ...CN, attended: 1, held: 1 });
    seedLog([["present", "CST303 Computer Networks"]]);
    expect(screen.getByText("matches")).toBeTruthy();
  });

  it("states the disagreement rather than preferring the stored number", () => {
    open({ ...CN, attended: 39, held: 50 });
    seedLog([
      ["present", "CST303 Computer Networks"],
      ["absent", "CST303 Computer Networks"],
    ]);
    // The log says 1/2 and the portal says 39/50. One of them is wrong, and
    // the student is the only person who can say which.
    expect(screen.getByText(/log says fewer classes/)).toBeTruthy();
  });

  it("shows nothing at all when there is no day-by-day record", () => {
    open(CN);
    expect(screen.queryByText(/Counted from the day-by-day record/)).toBeNull();
  });

  it("leaves out a logged subject the student does not have", () => {
    open(CN);
    seedLog([["present", "MAT101 Some Elective"]]);
    // With nothing matched, the roll-up has nothing to say and does not
    // render - a comparison table with no rows is a heading promising a
    // cross-check it cannot perform.
    expect(screen.queryByText("Counted from the day-by-day record")).toBeNull();
    // The calendar below it still shows the period, because that is the RAW
    // log and it is not the roll-up's job to censor it. A screen-wide query
    // for "Some Elective" would match there and assert the opposite of this.
    expect(screen.getAllByText(/Some Elective/).length).toBeGreaterThan(0);
  });
});

describe("calendar status is not carried by colour alone", () => {
  it("states each period's status in text for a screen reader", () => {
    open(CN);
    edit((d) => {
      d.daywiseAttendance = [{
        label: "1st",
        periods: [{ status: "absent", subject: "CST303 Computer Networks" }],
      }];
    });
    // The block was an empty div whose only carrier was a `title` - hover-only,
    // unreachable by keyboard, invisible on touch.
    expect(screen.getAllByText(/Absent — CST303 Computer Networks/).length)
      .toBeGreaterThan(0);
  });
});
