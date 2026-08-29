/**
 * Reading the portal's academic record page.
 *
 * Two failures here, both silent, both of the same kind: the parser answered
 * with less than the page contained and nothing said so.
 *
 * A subject row with no attendance cell was dropped, and `applySync` then
 * REPLACED the semester with whatever had survived — so a course the portal
 * had not yet posted attendance for disappeared from the record, taking its
 * credits out of the SGPA denominator.
 *
 * And a page whose subject tables this parser cannot read still produced
 * semester headings, which counted as a successful sync: a green result, a
 * written timestamp, no data. That is the answer that stops a student looking
 * for the problem, and every college that is not the one college this has been
 * tested against is a candidate for it.
 */
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseAcademics } from "../etlab";

/** The summary strip that names a semester and carries its SGPA. */
const strip = (ordinal: string, sgpa: string) => `
  <table><tr><td>
    ${ordinal} Semester — 210/240 (87.50%)
    SGPA : ${sgpa} Earned Credit : 20 Cumulative Credit : 20 CGPA : ${sgpa}
  </td></tr></table>`;

const subjectTable = (rows: string) => `
  <table>
    <tr><th>Subject</th><th>Attendance</th><th>Internal</th><th>Grade</th></tr>
    ${rows}
  </table>`;

const row = (cells: string[]) =>
  `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;

describe("a subject row with no attendance cell", () => {
  const page = strip("Vth", "8.10") + subjectTable([
    row(["PCCST501 Computer Networks", "42/48 (87.50%)", "38", "A"]),
    // Attendance not posted yet. This row used to vanish.
    row(["PCCST502 Design and Analysis of Algorithms", "-", "35", "B+"]),
    row(["PCCST503 Machine Learning", "40/48 (83.33%)", "31", "B"]),
  ].join(""));

  it("is kept, so the semester is not rebuilt from a subset", () => {
    const courses = parseAcademics(page).semesters[5]!.courses;
    expect(courses.map((c) => c.code))
      .toEqual(["PCCST501", "PCCST502", "PCCST503"]);
  });

  it("carries an unknown attendance rather than an invented one", () => {
    // Unknown is a state the engine already handles: it shows a dash and
    // withholds the grade. A zero would read as a debarred student and a
    // hundred as a safe one, and both would be fabrications.
    const missing = parseAcademics(page).semesters[5]!.courses
      .find((c) => c.code === "PCCST502")!;
    expect(missing.attendance).toBeNull();
    expect(missing.attended).toBeNull();
    expect(missing.held).toBeNull();
  });

  it("still reads its name", () => {
    const missing = parseAcademics(page).semesters[5]!.courses
      .find((c) => c.code === "PCCST502")!;
    expect(missing.name).toContain("Design and Analysis");
  });
});

describe("a page whose subject tables cannot be read", () => {
  it("parses the semester and reports no courses in it", () => {
    // The headers are the give-away: a college that labels the column
    // "Course" rather than "Subject" reaches exactly this state. The parser
    // is honest about it here; `fetchAcademics` is what refuses to call it a
    // successful sync, because a summary strip with no subjects underneath it
    // is not a record.
    const page = strip("IIIrd", "7.40") + `
      <table>
        <tr><th>Course</th><th>Presence</th><th>Marks</th></tr>
        ${row(["PCCST301 Data Structures", "42/48", "38"])}
      </table>`;
    const parsed = parseAcademics(page);
    expect(Object.keys(parsed.semesters)).toEqual(["3"]);
    expect(parsed.semesters[3]!.courses).toEqual([]);
    // And with no courses anywhere, there is no current semester to select.
    expect(parsed.current).toBeNull();
  });
});
