// @vitest-environment jsdom
/**
 * The second-college question, asked without an account.
 *
 * Sync is validated at exactly one college and the thing blocking a second has
 * never been code — it is that finding out has meant handing someone an
 * account. Everything the parser needs is in the HTML the student's browser
 * already has, so this card takes a saved page and answers the question on
 * their own machine.
 *
 * Two things are pinned here. That it actually reads a page — a working layout
 * reports its subjects and a foreign one says so rather than looking broken —
 * and that what it puts on screen to be forwarded carries no marks. The second
 * matters more: a student is being asked to send something off their own
 * academic record, and the whole design rests on that being safe.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Data } from "../Data";

afterEach(cleanup);

const KNOWN = `<html><head><title>Academics</title></head><body>
  <table><tr><td>Vth Semester</td><td>41/48 (85.4%)</td>
    <td>SGPA : 7.83 Earned Credit : 22 Cumulative Credit : 92 CGPA : 7.09</td></tr></table>
  <table>
    <tr><th>Subject</th><th>Attendance</th><th>Internal</th><th>Grade</th></tr>
    <tr><td>PCCST501 Computer Networks</td><td>41/48 (85.4%)</td><td>38</td><td>A</td></tr>
  </table></body></html>`;

/** A different college: same information, headings nothing here matches. */
const FOREIGN = `<html><head><title>Student Academics</title></head><body>
  <table><tr><th>Course Code</th><th>Course Title</th><th>Att %</th><th>Result</th></tr>
    <tr><td>PCCST501</td><td>Computer Networks</td><td>85.4</td><td>Pass</td></tr>
  </table></body></html>`;

const drop = async (html: string) => {
  const { container } = render(() => <Data />);
  const input = container.querySelector('input[accept=".html,.htm"]') as HTMLInputElement;
  expect(input).toBeTruthy();
  const file = new File([html], "saved.html", { type: "text/html" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
  return container;
};

describe("dropping in a saved portal page", () => {
  it("reports the subjects it found when the layout is one it knows", async () => {
    await drop(KNOWN);
    await waitFor(() => expect(screen.getByText(/Sync should work/)).toBeTruthy());
    expect(screen.getByText(/S5: 1 subject —/)).toBeTruthy();
    expect(screen.getByText(/PCCST501/)).toBeTruthy();
  });

  it("calls a layout it cannot read a finding, not a fault in the file", async () => {
    await drop(FOREIGN);
    await waitFor(() => expect(screen.getByText(/Nothing this parser can read/)).toBeTruthy());
    // And it still produces the block that makes it fixable, naming the
    // headings that did not match.
    const report = document.querySelector(".diagnostic pre")!.textContent!;
    expect(report).toContain("no match");
    expect(report).toContain("Course Code");
  });
});

describe("what it offers the student to send", () => {
  it("carries no mark, percentage or SGPA out of the page", async () => {
    await drop(KNOWN);
    await waitFor(() => expect(document.querySelector(".diagnostic pre")).toBeTruthy());
    const report = document.querySelector(".diagnostic pre")!.textContent!;
    for (const secret of ["7.83", "7.09", "85.4", "41/48", "38"]) {
      expect(report).not.toContain(secret);
    }
    // The heading row is quoted - that is what makes it useful - and the
    // subject row under it is not.
    expect(report).toContain("Subject");
    expect(report).not.toContain("Computer Networks");
  });

  it("says plainly that the page itself is not the thing to send", async () => {
    await drop(KNOWN);
    await waitFor(() => expect(screen.getByText(/Send this, not the saved page/)).toBeTruthy());
  });
});
