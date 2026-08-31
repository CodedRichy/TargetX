import { describe, it, expect } from "vitest";
import { parseDaywiseAttendance, parseTimetable } from "../etlab-schedule";

/**
 * Fixtures are cut verbatim from the captured etlab pages: the exact whitespace,
 * the nested tool-tip `<span>`, the `colspan` holiday row, the `[ Theory ]`
 * marker line. The point of the parsers is to survive this shape, so the tests
 * feed them this shape rather than a tidied version of it.
 */

const ATTENDANCE_HTML = `
<table id="itsthetable">
  <thead>
    <tr><th>Date</th><th>Period 1</th><th>Period 2</th><th>Period 3</th></tr>
  </thead>
  <tbody>
    <tr>
      <th >1<sup>st</sup></th>
      <td class="span1 absent">
        <a class="tool-tip">PCCST502 - DESIGN AND ANALYSIS OF ALGORITHMS
          <span class="classic">Bin Packing Problem</span></a>
      </td>
      <td class="span1 present">
        <a class="tool-tip">PECST522 - ARTIFICIAL INTELLIGENCE
          <span class="classic"></span></a>
      </td>
      <td class="span1 n-a">
        <a class="tool-tip"></a>
      </td>
    </tr>
    <tr>
      <th class="sun-day">2<sup>nd</sup></th>
      <td class="holiday" colspan="8"></td>
    </tr>
    <tr>
      <th >6<sup>th</sup></th>
      <td class="span1 dutyleave">
        <a class="tool-tip">D_H - DEPARTMENT HOUR<span class="classic"></span></a>
      </td>
      <td class="span1 onduty">
        <a class="tool-tip">PCCST501 - COMPUTER NETWORKS<span class="classic"></span></a>
      </td>
      <td class="span1 leave">
        <a class="tool-tip">PCCST503 - MACHINE LEARNING<span class="classic"></span></a>
      </td>
    </tr>
  </tbody>
</table>
`;

const TIMETABLE_HTML = `
<div id="timetable">
  <table class="items table table-striped table-bordered ">
    <thead>
      <tr><th class="span2">Day</th><th>Period 1</th><th>Period 2</th><th>Period 3</th></tr>
    </thead>
    <tbody>
      <tr>
        <td class="span2">Monday<br><small style="color:#666">31 Aug 2026</small></td>
        <td class="TR">
          PCCST502 - DESIGN AND ANALYSIS OF ALGORITHMS<br/>[ Theory ]<br/>Dr. GIRISH BALAKRISHNAN
        </td>
        <td class="PE">
          ARTIFICIAL INTELLIGENCE
        </td>
        <td class="FP">
          Free Period
        </td>
      </tr>
    </tbody>
  </table>
</div>
<div id="timetable-changes-grid" class="grid-view">
  <table class="items table">
    <thead>
      <tr><th>substitution.date</th><th>Teacher</th><th>In Place Of</th><th>Period</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>2026-09-02</td>
        <td>Dr. GIRISH BALAKRISHNAN</td>
        <td>Mrs. ROMANA SALIM</td>
        <td>3</td>
      </tr>
    </tbody>
  </table>
</div>
`;

const TIMETABLE_NO_CHANGES = `
<table class="items table table-striped table-bordered ">
  <thead><tr><th>Day</th><th>Period 1</th></tr></thead>
  <tbody>
    <tr><td class="span2">Tuesday<br><small>01 Sep 2026</small></td><td class="TR">PBCST504 - MICROCONTROLLERS<br/>[ Theory ]<br/>Mrs. PARVATHY SANTHOSH</td></tr>
  </tbody>
</table>
<div id="timetable-changes-grid" class="grid-view">
  <table class="items table">
    <thead><tr><th>substitution.date</th><th>Teacher</th><th>In Place Of</th><th>Period</th></tr></thead>
    <tbody><tr><td colspan="4" class="empty"><span class="empty">No changes</span></td></tr></tbody>
  </table>
</div>
`;

describe("parseDaywiseAttendance", () => {
  const days = parseDaywiseAttendance(ATTENDANCE_HTML);

  it("reads one entry per day with its label", () => {
    expect(days).toHaveLength(3);
    expect(days.map((d) => d.label)).toEqual(["1st", "2nd", "6th"]);
  });

  it("maps td classes to statuses and n-a to none", () => {
    expect(days[0]!.periods.map((p) => p.status)).toEqual([
      "absent", "present", "none",
    ]);
  });

  it("takes the subject text before the tooltip span", () => {
    expect(days[0]!.periods[0]!.subject).toBe(
      "PCCST502 - DESIGN AND ANALYSIS OF ALGORITHMS");
    expect(days[0]!.periods[1]!.subject).toBe("PECST522 - ARTIFICIAL INTELLIGENCE");
  });

  it("leaves an empty n-a period with no subject", () => {
    expect(days[0]!.periods[2]!.subject).toBeNull();
  });

  it("expands a colspanned holiday into eight holiday periods", () => {
    expect(days[1]!.periods).toHaveLength(8);
    expect(days[1]!.periods.every((p) => p.status === "holiday")).toBe(true);
    expect(days[1]!.periods.every((p) => p.subject === null)).toBe(true);
  });

  it("recognises the credited and leave statuses", () => {
    expect(days[2]!.periods.map((p) => p.status)).toEqual([
      "dutyleave", "od", "leave",
    ]);
  });

  it("returns an empty array when there is no grid", () => {
    expect(parseDaywiseAttendance("<html><body>nothing</body></html>")).toEqual([]);
  });
});

describe("parseTimetable", () => {
  const { grid, substitutions } = parseTimetable(TIMETABLE_HTML);

  it("reads a day row with its periods", () => {
    expect(grid).toHaveLength(1);
    expect(grid[0]!.day).toBe("Monday");
    expect(grid[0]!.periods).toHaveLength(3);
  });

  it("splits subject from teacher and drops the [ Theory ] marker", () => {
    expect(grid[0]!.periods[0]).toEqual({
      subject: "PCCST502 - DESIGN AND ANALYSIS OF ALGORITHMS",
      teacher: "Dr. GIRISH BALAKRISHNAN",
    });
  });

  it("leaves an elective with a subject and no teacher", () => {
    expect(grid[0]!.periods[1]).toEqual({
      subject: "ARTIFICIAL INTELLIGENCE",
      teacher: null,
    });
  });

  it("keeps a free period as its own subject", () => {
    expect(grid[0]!.periods[2]!.subject).toBe("Free Period");
    expect(grid[0]!.periods[2]!.teacher).toBeNull();
  });

  it("parses a substitution row in column order", () => {
    expect(substitutions).toHaveLength(1);
    expect(substitutions[0]).toEqual({
      date: "2026-09-02",
      teacher: "Dr. GIRISH BALAKRISHNAN",
      inPlaceOf: "Mrs. ROMANA SALIM",
      period: "3",
    });
  });

  it("cleans a run-together, trailing-comma teacher cell from the live portal", () => {
    // Verbatim shape of the cell that rendered "MENT - MENTORING HOURMs. JISHA
    // JAMES,, Ms. SREEDEVI R PRASAD" on screen: a category tag, then a subject
    // glued to an honorific, then a teacher line with a trailing comma, then a
    // second teacher.
    const html = `
      <table class="items table table-bordered">
        <thead><tr><th>Day</th><th>Period 1</th></tr></thead>
        <tbody><tr>
          <td class="span2">Wednesday<br><small>03 Sep 2026</small></td>
          <td class="TA">TA<br/>MENT - MENTORING HOURMs. JISHA JAMES,<br/>Ms. SREEDEVI R PRASAD</td>
        </tr></tbody>
      </table>`;
    const period = parseTimetable(html).grid[0]!.periods[0]!;
    expect(period.subject).toBe("TA");
    // No double comma, and the glued honorific is re-spaced.
    expect(period.teacher).toBe(
      "MENT - MENTORING HOUR Ms. JISHA JAMES, Ms. SREEDEVI R PRASAD");
    expect(period.teacher).not.toContain(",,");
    expect(period.teacher).not.toContain("HOURMs");
  });

  it("returns no substitutions for a 'No changes' grid", () => {
    const parsed = parseTimetable(TIMETABLE_NO_CHANGES);
    expect(parsed.grid).toHaveLength(1);
    expect(parsed.grid[0]!.day).toBe("Tuesday");
    expect(parsed.substitutions).toEqual([]);
  });
});
