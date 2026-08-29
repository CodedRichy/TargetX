// @vitest-environment jsdom
/**
 * The thing that makes a second college fixable.
 *
 * Portal sync has been validated against exactly one deployment. The realistic
 * failure at the next one is not a crash - it is `parseAcademics` reading a
 * page whose headings are worded differently and finding nothing, which leaves
 * the student with "sync doesn't work" and nobody with a copy of the page.
 * `describeAcademics` is what turns that into a bug report someone can write a
 * selector from.
 *
 * It is only useful if it is safe to send, so that is pinned harder than the
 * content is: no marks, no grades, no digits at all.
 */
import { describe, expect, it } from "vitest";
import { describeAcademics } from "../etlab";

const page = (body: string) => `<html><head><title>Academics</title></head>
<body>${body}</body></html>`;

const RECOGNISED = page(`
  <table><tr><td>Vth Semester</td><td>41/48 (85.4%)</td>
    <td>SGPA : 7.83 Earned Credit : 22 Cumulative Credit : 92 CGPA : 7.09</td></tr></table>
  <table>
    <tr><th>Subject</th><th>Attendance</th><th>Internal</th><th>Grade</th></tr>
    <tr><td>PCCST501 Computer Networks</td><td>41/48 (85.4%)</td><td>38</td><td>A</td></tr>
  </table>`);

describe("the description of a page that would not parse", () => {
  it("says which recognitions each table passed", () => {
    const report = describeAcademics(RECOGNISED);
    expect(report).toMatch(/sem-heading/);
    expect(report).toMatch(/sgpa/);
    expect(report).toMatch(/subject/);
    expect(report).toMatch(/grade/);
  });

  it("says so plainly when a table matched nothing", () => {
    // The whole point: a college whose subject table says "Course" and "Result"
    // must produce a report that shows those words next to "no match".
    const report = describeAcademics(page(`
      <table><tr><th>Course</th><th>Result</th></tr>
        <tr><td>PCCST501</td><td>Pass</td></tr></table>`));
    expect(report).toMatch(/no match/);
    expect(report).toMatch(/Course/);
    expect(report).toMatch(/Result/);
  });

  it("counts the tables and their shape, which is what a selector is written from", () => {
    const report = describeAcademics(RECOGNISED);
    expect(report).toMatch(/^2 table\(s\)/);
    expect(report).toMatch(/rows=2 cols=4/);
  });

  it("notices a login page, which is a different fault entirely", () => {
    const report = describeAcademics(
      `<html><head><title>Login</title></head><body><table><tr><td>x</td></tr></table></body></html>`);
    expect(report).toMatch(/calls itself a login page/);
  });
});

describe("what it must never contain", () => {
  it("carries no digit out of the page, so no mark or percentage survives", () => {
    // Stated over the QUOTED text rather than the whole report, because the
    // report's own row and column counts are digits and are the point of it.
    // Everything after the "|" on a line is page text and must have none.
    const quoted = describeAcademics(RECOGNISED)
      .split("\n").slice(1)
      .map((line) => line.slice(line.indexOf("|") + 1));
    expect(quoted.length).toBeGreaterThan(0);
    for (const line of quoted) expect(line).not.toMatch(/\d/);
  });

  it("does not carry a specific figure off the record", () => {
    // The same rule from the other side: these strings are in the fixture, and
    // an SGPA, a CGPA and an attendance percentage are exactly what must not
    // leave the machine because a parser failed.
    const report = describeAcademics(RECOGNISED);
    for (const secret of ["7.83", "7.09", "85.4", "41/48", "22", "92"]) {
      expect(report).not.toContain(secret);
    }
  });

  it("quotes only the first row of a table, so no subject row is included", () => {
    const report = describeAcademics(RECOGNISED);
    // The heading is quoted; the row under it - a real course, its attendance
    // and its grade - is not.
    expect(report).toMatch(/Subject/);
    expect(report).not.toMatch(/PCCST/);
    expect(report).not.toMatch(/Computer Networks/);
  });

  it("truncates a long cell rather than carrying a paragraph off the page", () => {
    const long = "X".repeat(400);
    const report = describeAcademics(page(`<table><tr><td>${long}</td></tr></table>`));
    expect(report).not.toMatch(/X{40}/);
  });
});
