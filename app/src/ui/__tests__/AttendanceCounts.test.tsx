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

describe("a printed percentage never claims a line it has not reached", () => {
  /*
   * The failure this guards was total: at 74.5% the card's headline, its
   * verdict, the meter's ends and the meter's aria-label all printed "75%",
   * because every one of them went through `toFixed(0)` while `plan.state`
   * stayed on the true value. The sentence that came out was "At 75% - below
   * the 75% line", and the only thing on the card still saying which side of
   * eligibility the student was on was the red fill - colour as the sole
   * carrier of the fact the screen exists to deliver.
   */
  const verdict = () =>
    document.querySelector(".tile-verdict")?.textContent ?? "";
  const headline = () =>
    document.querySelector(".tile-head .tile-note")?.textContent ?? "";

  it("does not round 74.5% up onto the eligibility line", () => {
    open({ ...CN, attended: 149, held: 200 });
    expect(headline()).toBe("74.5%");
    expect(verdict()).toContain("At 74.5%");
    expect(verdict()).not.toContain("At 75%");
  });

  it("does not round 84.5% up onto the full-marks line", () => {
    // 84.5% earns 4 of the 5 R 7.5.ii marks. Printed as "85%" it sat beside
    // its own mark count contradicting it.
    open({ ...CN, attended: 169, held: 200 });
    expect(screen.getAllByText(/84\.5%/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^85%$/)).toBeNull();
  });

  it("still writes a whole percentage as a whole number", () => {
    // The tenth is carrying a fact or it is noise. At 75% it is noise.
    open({ ...CN, attended: 150, held: 200 });
    expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
  });

  it("keeps the printed figure and the verdict on the same side of the line", () => {
    // The invariant, stated once: truncation is monotone and fixes whole
    // numbers, and every line is a whole-number `>=` floor, so the headline
    // and the verdict can no longer disagree at any denominator.
    for (const [attended, held] of [[149, 200], [150, 200], [119, 200],
                                    [3, 4], [59, 80], [0, 40], [40, 40]]) {
      cleanup();
      open({ ...CN, attended, held });
      const printed = Number(headline().replace("%", ""));
      expect(verdict().includes("below the")).toBe(printed < 75);
    }
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
    // the student is the only person who can say which. Here it is the class
    // COUNT that differs - 2 against 50 - so that is what is named.
    expect(screen.getByText(/log has 48 fewer classes/)).toBeTruthy();
  });

  it("names an attendance disagreement as one, when the counts agree", () => {
    // The case this whole panel exists for: the same two classes, and the
    // portal has marked one of them absent that the log says was attended.
    // Reported as "fewer classes" until the wording branched on the sign of
    // the HELD gap alone, which is zero here - so the one finding worth
    // acting on was announced as the app's own known blind spot, the
    // shorter-log gap the paragraph above the table tells students to ignore.
    open({ ...CN, attended: 1, held: 2 });
    seedLog([
      ["present", "CST303 Computer Networks"],
      ["present", "CST303 Computer Networks"],
    ]);
    expect(screen.getByText(/same classes, log marks 1 more attended/)).toBeTruthy();
  });

  it("does not hand a subject the tally of one whose name contains it", () => {
    // "Computer Networks" is inside "Computer Networks Lab", and the portal
    // prints whichever ran first. Under a single substring pass the theory
    // subject took the lab's two periods, its own period went uncounted, and
    // the panel reported a disagreement that only the matching had created.
    open({ ...CN, attended: 1, held: 1 });
    seedLog([
      ["present", "Computer Networks Lab"],
      ["present", "Computer Networks Lab"],
      ["present", "Computer Networks"],
    ]);
    expect(screen.getByText("matches")).toBeTruthy();
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
