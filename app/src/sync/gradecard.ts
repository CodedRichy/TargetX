/**
 * KTU grade card import.
 *
 * A port of ktu_import.py. The grade card is the university's own document, so
 * it outranks anything scraped or typed — and for a student whose college
 * portal TargetX cannot read, it is the way a whole academic history gets in.
 *
 * Deliberately tolerant: the same information arrives as a PDF, as an HTML
 * results page, and as a table pasted out of either. Rather than three parsers,
 * every line is scanned for course codes and the columns that follow them.
 *
 * The column model, which is the whole of the fix below: a KTU result row is
 *
 *     CODE   Course title   CREDITS   GRADE   RESULT
 *
 * and the RESULT column is the one that used to be read as the grade. Anchoring
 * on the credits column instead - the grade is the first grade token AFTER it -
 * is what stops `CST302 … 4 A+ P` importing as a P, and stops a supplementary
 * row `… 4 P S3(S)` importing as an S, which is a 10.0 against a course the
 * student re-sat.
 */
import {
  GRADE_POINTS, isGraded, isIncomplete, normaliseGrade, sgpa as computeSgpa,
} from "../engine";
import { CODE_RE } from "../engine/parse";

const GRADE_TOKENS = ["A+", "B+", "C+", "S", "A", "B", "C", "D", "P", "F",
                      "FE", "I", "W", "AB"] as const;

/**
 * Exactly what the token list can match, which is wider than `Grade`.
 *
 * Four of these tokens - FE, I, W, AB - carry no grade point, so a parsed
 * token is not a `Grade` and must not be typed as one. It was typed as one:
 * the `as Grade` this replaces let `GRADE_POINTS[c.grade]` compile and score a
 * withdrawal zero at full credits. Derived from the token list so the two
 * cannot drift apart.
 */
export type CardToken = (typeof GRADE_TOKENS)[number];

/**
 * A grade is now a WHOLE column, never a substring.
 *
 * The previous parser scanned the row with a regex, which is how `S3(S)` - a
 * supplementary marker in the result column - yielded the grade S. A column
 * either is a grade token or it is not.
 */
const GRADE_SET = new Set<string>(GRADE_TOKENS);

/**
 * The credits column.
 *
 * Zero is a real value: an MCN course carries no credit and still appears on
 * the card with a grade beside it. Treating 0 as "missing" and substituting 3
 * is how a non-credit course came to weigh three credits of the student's
 * SGPA. Above 8 is a mark or a roll number, not a credit.
 */
const CREDIT_RE = /^\d+(?:\.\d+)?$/;
const CREDIT_MAX = 8;

const SEM_RE = /\bS(?:EM(?:ESTER)?)?\s*[-: ]?\s*([1-8])\b/i;
const ORDINAL_SEM = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+SEMESTER\b/i;
const ORDINALS = ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH"];
const SGPA_RE = /\bSGPA\s*[:=]?\s*(\d+(?:\.\d+)?)/i;

/** A global twin of `CODE_RE`, so a line carrying two courses yields two. */
const CODE_RE_ALL = new RegExp(CODE_RE.source, "g");

const FAIL_TOKENS = new Set(["F", "FE", "I", "W", "AB"]);

export interface CardCourse {
  code: string; name: string; credits: number; grade: CardToken; passed: boolean;
}

export interface CardSemester {
  courses: CardCourse[];
  sgpaPrinted?: number;
  sgpaCalc: number;
  /**
   * The CGPA denominator: every course on the card except an I or a W.
   *
   * Failures stay - an F is a result, and KTU keeps its credits in the
   * denominator. I and W leave, because `sgpaPrinted` beside them is the
   * university's own figure and it was computed without them; storing the
   * printed SGPA against a total that still carries the withdrawn credits
   * would pay the student their own average for the course they walked away
   * from. The two numbers have to describe the same set of courses.
   */
  credits: number;
  /**
   * Only the courses that passed. Shown, never weighted.
   *
   * An I or a W is in `FAIL_TOKENS`, so it is already out of this total - the
   * same set of courses `credits` now covers, minus the ones that did not
   * pass.
   */
  creditsEarned: number;
  /**
   * True when the recomputed SGPA disagrees with the printed one, which means
   * the parse ate a row or misread a credit. Surfaced rather than swallowed:
   * a silently wrong import is worse than a refused one.
   */
  mismatch: boolean;
}

export interface GradeCard {
  semesters: Record<string, CardSemester>;
  semesterDetected: boolean;
}

function semesterFromLine(line: string): string | null {
  const ordinal = ORDINAL_SEM.exec(line);
  if (ordinal) return `S${ORDINALS.indexOf(ordinal[1]!.toUpperCase()) + 1}`;
  const plain = SEM_RE.exec(line);
  return plain ? `S${plain[1]}` : null;
}

const isCredit = (token: string) =>
  CREDIT_RE.test(token) && Number(token) <= CREDIT_MAX;

/**
 * One course row, read as columns rather than scanned for tokens.
 *
 * Returns null when the row has no credits-then-grade pair, which is the
 * honest answer for a line that merely mentions a course code - a prerequisite
 * list, a registration confirmation, a heading. The old parser answered those
 * with a fabricated grade taken out of the course title, so
 * "MAT101 Engineering Mathematics I" imported as a real course graded I.
 */
function parseRow(code: string, tail: string): CardCourse | null {
  // Cell separators become spaces first: a pasted HTML table arrives pipe- or
  // tab-delimited, a PDF arrives space-delimited, and the column model has to
  // hold for both.
  const tokens = tail.replace(/[|\t]+/g, " ").split(/\s+/).filter(Boolean);

  // The credits column is the LAST credit-shaped number that still has a grade
  // somewhere after it. Last, because a course title can contain a small
  // number ("Physics 2"); still-has-a-grade-after, because that is what makes
  // it the credits column rather than part of the name.
  let creditIdx = -1;
  for (let i = 0; i < tokens.length; i += 1) {
    if (!isCredit(tokens[i]!)) continue;
    for (let j = i + 1; j < tokens.length; j += 1) {
      if (GRADE_SET.has(tokens[j]!.toUpperCase())) { creditIdx = i; break; }
    }
  }
  if (creditIdx < 0) return null;

  // The grade is the FIRST grade column after the credits. Everything further
  // right - the result column, a supplementary marker, an exam month - is not
  // the grade, which is the single assumption the previous parser had backwards.
  let grade: CardToken | null = null;
  for (let i = creditIdx + 1; i < tokens.length; i += 1) {
    const token = tokens[i]!.toUpperCase();
    if (GRADE_SET.has(token)) { grade = token as CardToken; break; }
  }
  if (grade === null) return null;

  return {
    code,
    name: tokens.slice(0, creditIdx).join(" ").trim(),
    credits: Number(tokens[creditIdx]),
    grade,
    passed: !FAIL_TOKENS.has(grade),
  };
}

export function parseGradeCard(text: string): GradeCard {
  const semesters: Record<string, { courses: CardCourse[]; sgpaPrinted?: number }> = {};
  let current = "S1";
  let seenSem = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const foundSem = semesterFromLine(line);

    // Every code on the line, not just the first. A PDF whose rows sit close
    // together can hand two courses over as one line, and reading only the
    // first silently dropped the second.
    CODE_RE_ALL.lastIndex = 0;
    const codes = Array.from(line.matchAll(CODE_RE_ALL));

    // A bare semester heading (no course code on it) switches context for the
    // rows that follow.
    if (foundSem && codes.length === 0) {
      current = foundSem;
      seenSem = true;
      continue;
    }

    // A semester marker sharing a line with a course belongs to THAT row and
    // does not move the context. It is usually the supplementary marker in the
    // result column - `S3(S)` on a re-sat course sitting in the middle of an
    // S5 card - and letting it move the context relabelled every row after it.
    const rowSem = foundSem ?? current;
    if (foundSem) seenSem = true;

    // SGPA is read from any line, including a course row. Requiring the line
    // to carry no course code meant a card that prints the semester total
    // beside its last course had no printed SGPA at all - so no history was
    // written, and the printed-vs-recomputed check that catches every other
    // defect in this file could never fire.
    const sgpaMatch = SGPA_RE.exec(line);
    if (sgpaMatch) {
      (semesters[rowSem] ??= { courses: [] }).sgpaPrinted = Number(sgpaMatch[1]);
    }
    if (codes.length === 0) continue;

    for (const [index, match] of codes.entries()) {
      const start = match.index + match[0].length;
      const end = index + 1 < codes.length ? codes[index + 1]!.index : line.length;
      const course = parseRow(match[1]!, line.slice(start, end));
      if (course) (semesters[rowSem] ??= { courses: [] }).courses.push(course);
    }
  }

  const out: Record<string, CardSemester> = {};
  for (const [name, entry] of Object.entries(semesters)) {
    // I and W score nothing and weigh nothing; FE and AB are real fails and
    // weigh their full credits at a grade point of 0. `normaliseGrade` already
    // draws that line - drawing it a second time here is how the two would
    // come to disagree.
    const counted = entry.courses.filter((c) => !isIncomplete(normaliseGrade(c.grade)));
    const sgpaCalc = computeSgpa(counted.map((c) => {
      const grade = normaliseGrade(c.grade);
      return [c.credits, isGraded(grade) ? GRADE_POINTS[grade] : 0] as [number, number];
    }));
    out[name] = {
      courses: entry.courses,
      sgpaPrinted: entry.sgpaPrinted,
      sgpaCalc,
      credits: counted.reduce((sum, c) => sum + c.credits, 0),
      creditsEarned: entry.courses.filter((c) => c.passed)
        .reduce((sum, c) => sum + c.credits, 0),
      mismatch: entry.sgpaPrinted !== undefined
        && Math.abs(entry.sgpaPrinted - sgpaCalc) > 0.05,
    };
  }
  return { semesters: out, semesterDetected: seenSem };
}

/**
 * How far apart two text items can sit and still be the same row.
 *
 * PDF text positions are not exact: the items making up one row differ by a
 * fraction of a point, and a superscript or a differently sized cell by more.
 * The previous banding rounded y/3, which merges anything within three points
 * - narrower than a line of 9pt text, so two rows of a tightly set table could
 * land in the same bucket and one course would vanish. Clustering with an
 * explicit tolerance says what the number means and keeps it well under a line
 * height.
 */
const ROW_TOLERANCE = 2;

/**
 * Text out of a grade-card PDF.
 *
 * pdfjs is imported dynamically so its ~350KB never lands in the main bundle -
 * most students paste a table and never open a PDF at all.
 */
export async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Everything runs on the main thread: no worker file to ship, and a grade
  // card is a handful of pages.
  pdfjs.GlobalWorkerOptions.workerSrc = "";
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const content = await (await doc.getPage(n)).getTextContent();
    const items: Array<{ x: number; y: number; str: string }> = [];
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str || !item.transform) continue;
      items.push({ x: item.transform[4]!, y: item.transform[5]!, str: item.str });
    }

    // Rebuild rows from item positions: a grade card is a table, and joining
    // every item with a space would put a whole page on one line. Top to
    // bottom, then left to right within a row - the reading order of the
    // table, which the item order in the file does not promise.
    items.sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const rows: string[][] = [];
    let rowY: number | null = null;
    for (const item of items) {
      if (rowY === null || Math.abs(item.y - rowY) > ROW_TOLERANCE) {
        rows.push([]);
        rowY = item.y;
      }
      rows[rows.length - 1]!.push(item.str);
    }
    pages.push(rows.map((parts) => parts.join("  ")).join("\n"));
  }
  return pages.join("\n");
}
