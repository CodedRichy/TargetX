// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseCardTable, toCanonicalText } from "../ktu";
import { parseGradeCard } from "../gradecard";

/**
 * KTU live grade-card client.
 *
 * The network and login halves need a live portal and are covered by manual
 * recon; what is unit-testable and worth locking down is the seam that is
 * unique to the live path: the results table has a DIFFERENT column order from
 * the paste format (Name | Code | Grade | Credits | Month), and it is read by
 * position and re-emitted as the canonical `CODE Name Credits Grade` text the
 * audited `parseGradeCard` expects. If that reordering or the audit-course drop
 * regresses, a wrong history is imported silently - the exact failure the whole
 * source-precedence work exists to prevent.
 *
 * The fixture mirrors a real KTU card row for row, including the two rows that
 * make the semantics non-trivial: an audit course graded `PASS` (which is NOT a
 * grade token and must be dropped, because KTU leaves it out of the SGPA) and a
 * real barely-passed course graded `P` (a 5.5 that must be kept and scored).
 */
const CARD_HTML = `
<html><body>
<table>
  <tr><th>Course Name</th><th>Code</th><th>Grade</th><th>Credits Earned</th><th>Month &amp; Year of Examination</th></tr>
  <tr><td>ALGORITHMIC THINKING WITH PYTHON</td><td>UCEST105</td><td>A</td><td>4.0</td><td>December 2024</td></tr>
  <tr><td>DATA STRUCTURES AND ALGORITHMS</td><td>PCCST303</td><td>P</td><td>4.0</td><td>November 2025</td></tr>
  <tr><td>LIFE SKILLS AND PROFESSIONAL COMMUNICATION</td><td>UCHUT128</td><td>PASS</td><td>1.0</td><td>December 2024</td></tr>
  <tr><td>MATHEMATICS FOR INFORMATION SCIENCE - 2</td><td>GAMAT201</td><td>B</td><td>3.0</td><td>May 2025</td></tr>
  <tr><td>Total Earned Credits</td><td>11</td></tr>
  <tr><td>Total Credits in the Semester</td><td>11</td></tr>
  <tr><td>SGPA</td><td>7.14</td></tr>
  <tr><td>CGPA</td><td>7.14</td></tr>
</table>
</body></html>`;

/** A published semester has no grade-card table - only an anti-ragging prompt. */
const NO_CARD_HTML = `
<html><body>
<table><tr><td>Anti Ragging Feedback Form</td><td>Fill Now</td></tr></table>
</body></html>`;

describe("parseCardTable", () => {
  it("reads course rows by position and skips the footer rows", () => {
    const card = parseCardTable(CARD_HTML);
    expect(card).not.toBeNull();
    expect(card!.rows).toHaveLength(4);
    // Name and code are in different columns; getting them by position is the
    // whole point.
    expect(card!.rows[0]).toEqual({
      code: "UCEST105", name: "ALGORITHMIC THINKING WITH PYTHON",
      credits: "4.0", grade: "A",
    });
    // The audit row is still a row here - it is the PARSER that drops it later.
    expect(card!.rows.find((r) => r.code === "UCHUT128")?.grade).toBe("PASS");
  });

  it("captures the printed SGPA and not the CGPA or totals", () => {
    expect(parseCardTable(CARD_HTML)!.sgpa).toBe("7.14");
  });

  it("returns null when the page carries no grade-card table", () => {
    expect(parseCardTable(NO_CARD_HTML)).toBeNull();
  });
});

describe("toCanonicalText -> parseGradeCard (the reuse seam)", () => {
  const card = parseCardTable(CARD_HTML)!;
  const text = toCanonicalText("3", card);

  it("emits a semester heading, CODE-first course lines, and the SGPA", () => {
    expect(text.split("\n")[0]).toBe("SEMESTER 3");
    expect(text).toContain("UCEST105 ALGORITHMIC THINKING WITH PYTHON 4.0 A");
    expect(text).toContain("SGPA: 7.14");
  });

  it("parses into the right semester with the audit course dropped and P kept", () => {
    const parsed = parseGradeCard(text);
    const sem = parsed.semesters["S3"];
    expect(sem).toBeDefined();
    // Three graded courses survive; the PASS audit course is gone, exactly as
    // KTU leaves it out of the SGPA denominator.
    const codes = sem!.courses.map((c) => c.code).sort();
    expect(codes).toEqual(["GAMAT201", "PCCST303", "UCEST105"]);
    // The real `P` was kept and scored, not confused with the audit PASS.
    expect(sem!.courses.find((c) => c.code === "PCCST303")?.grade).toBe("P");
    // A name that contains its own small number ("- 2") did not get read as the
    // credits column: the credits-with-a-grade-after rule picks the real 3.0.
    expect(sem!.courses.find((c) => c.code === "GAMAT201")?.credits).toBe(3);
  });

  it("keeps the printed SGPA and does not flag a mismatch on a consistent card", () => {
    const sem = parseGradeCard(text).semesters["S3"]!;
    expect(sem.sgpaPrinted).toBe(7.14);
    expect(sem.mismatch).toBe(false);
  });
});
