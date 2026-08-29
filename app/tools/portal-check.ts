/**
 * Run the portal parser against a saved page, with no portal and no password.
 *
 * Sync has been validated against exactly one college, and the thing blocking
 * a second is not code - it is that testing a college has meant having an
 * account at it. That is a bad trade to ask of a stranger and an impossible
 * one to ask at scale.
 *
 * It does not have to be. Everything the parser needs is in the HTML the
 * student's browser already has: File > Save Page As on the academics page,
 * then
 *
 *     npx vite-node tools/portal-check.ts <saved-page.html>
 *
 * It prints what parsed, and - whether or not it worked - the same redacted
 * description the app shows on a failed sync. THE REPORT IS SAFE TO SEND AND
 * THE SAVED PAGE IS NOT: the page is the student's whole academic record, the
 * report is table shapes and headings with every digit blanked. The tool never
 * writes the page anywhere and never sends anything; it prints to a terminal
 * on the student's own machine and stops there.
 */
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const file = process.argv[2];
if (!file) {
  console.error("usage: npx vite-node tools/portal-check.ts <saved-page.html>");
  process.exit(2);
}

// The parser is written for a browser and reaches for a global DOMParser. The
// suite gives it one through jsdom's test environment; a plain node script has
// to install it, and it must be in place BEFORE the module is imported.
const dom = new JSDOM("");
(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser;

const { describeAcademics, parseAcademics } = await import("../src/sync/etlab");

const html = readFileSync(file, "utf-8");
const parsed = parseAcademics(html);
const semesters = Object.entries(parsed.semesters);
const courses = semesters.reduce((sum, [, s]) => sum + s.courses.length, 0);

console.log(`\n=== what parsed =============================================`);
console.log(`${semesters.length} semester(s), ${courses} course(s)`);
for (const [number, semester] of semesters) {
  const marks = [
    semester.sgpa != null ? `SGPA ${semester.sgpa}` : null,
    semester.earnedCredits != null ? `${semester.earnedCredits} earned` : null,
    semester.attendance != null ? `${semester.attendance}% attendance` : null,
  ].filter(Boolean);
  console.log(`  S${number}: ${semester.courses.length} courses` +
    (marks.length ? ` (${marks.join(", ")})` : " (no summary strip)"));
  // Codes only. A course name is public; a mark is not, and this is printed on
  // a screen someone may well be photographing to send on.
  const codes = semester.courses.map((c) => c.code).join(" ");
  if (codes) console.log(`    ${codes}`);
}

if (courses === 0) {
  console.log(`\nNothing this parser can read. That is the finding, not a crash:`);
  console.log(`the page below is laid out differently from the one deployment`);
  console.log(`TargetX has been built against.`);
}

console.log(`\n=== safe to send ============================================`);
console.log(`Headings and shapes only. Every digit is replaced with #, and no`);
console.log(`subject row is quoted - read it before you send it.\n`);
console.log(describeAcademics(html));
console.log(`\nOpen an issue with the block above at`);
console.log(`https://github.com/CodedRichy/TargetX/issues - not the saved page,`);
console.log(`which is your whole academic record.\n`);

process.exit(courses > 0 ? 0 : 1);
