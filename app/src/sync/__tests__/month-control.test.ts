/**
 * Issue #13, the part that is still open: can a past month be asked for?
 *
 * The archive keeps every month TargetX syncs but cannot reach back for one it
 * never saw. Whether it could depends on whether the portal serves a past
 * month on request, and the honest way to find that out is to read the page's
 * own navigation rather than guess parameter names at a college's server: if
 * the page can show another month, the control that does it is in the HTML.
 *
 * What is tested here is that the describer finds each shape a Yii app is
 * likely to use, that it says so plainly when there is nothing, and - the part
 * that matters most - that what it reports carries no attendance in it. The
 * output exists to be pasted to someone helping, and a report that quietly
 * carries a student's record is worse than no report.
 */
import { describe, expect, it } from "vitest";
import { describeMonthControls } from "../etlab-schedule";

const GRID = `
  <h3>Attendance for September 2026</h3>
  <table id="tbl">
    <tr><th>Day</th><th>1</th><th>2</th></tr>
    <tr><td>1st</td><td><span title="Computer Networks">P</span></td><td>A</td></tr>
    <tr><td>2nd</td><td>A</td><td>P</td></tr>
  </table>`;

describe("finding the page's own month control", () => {
  it("finds a select named for the month", () => {
    const found = describeMonthControls(`
      ${GRID}
      <select name="month" id="month">
        <option value="8">August</option><option value="9">September</option>
      </select>`);
    expect(found[0]!.kind).toBe("select");
    expect(found[0]!.detail).toContain('name="month"');
    expect(found[0]!.detail).toContain("2 options");
  });

  it("finds a select whose options are month names even when its name is not", () => {
    // Yii names a field after its model attribute, which can be anything.
    const found = describeMonthControls(`
      ${GRID}
      <select name="AttendanceSearch[m]">
        <option>January</option><option>February</option>
      </select>`);
    expect(found.some((f) => f.kind === "select")).toBe(true);
  });

  it("finds a link that carries a month", () => {
    const found = describeMonthControls(`
      ${GRID}
      <a href="/student/attendance?month=8&year=2026">Previous</a>`);
    const link = found.find((f) => f.kind === "link");
    expect(link?.detail).toBe("/student/attendance?month=8&year=2026");
  });

  it("finds a form field that would post one", () => {
    const found = describeMonthControls(`
      ${GRID}
      <form><input type="hidden" name="Attendance[month]" value="9"></form>`);
    const field = found.find((f) => f.kind === "form-field");
    expect(field?.detail).toContain('name="Attendance[month]"');
  });

  it("says plainly when the page has nothing at all", () => {
    // The answer that closes the question the other way: forward-accumulation
    // is the ceiling, and the issue should say so rather than imply more.
    const found = describeMonthControls(GRID);
    expect(found).toHaveLength(1);
    expect(found[0]!.kind).toBe("none");
  });

  it("does not report a link that merely happens to be on the page", () => {
    const found = describeMonthControls(`${GRID}<a href="/student/profile">Profile</a>`);
    expect(found.every((f) => f.kind !== "link")).toBe(true);
  });

  it("carries no attendance, no subject and no day out of the page", () => {
    // The whole point of the report being safe to paste. The page it reads is
    // the student's record; what comes out is element and attribute names.
    const found = describeMonthControls(`
      ${GRID}
      <select name="month"><option value="9">September</option></select>
      <a href="/student/attendance?month=8">Prev</a>`);
    const all = found.map((f) => f.detail).join(" ");
    expect(all).not.toContain("Computer Networks");
    expect(all).not.toContain("1st");
    expect(all).not.toMatch(/\bP\b|\bA\b/);
  });

  it("caps how many links it reports, so a paginated page is not dumped", () => {
    const links = Array.from({ length: 20 },
      (_, i) => `<a href="/student/attendance?month=${i + 1}">m</a>`).join("");
    const found = describeMonthControls(GRID + links);
    expect(found.filter((f) => f.kind === "link").length).toBeLessThanOrEqual(6);
  });
});
