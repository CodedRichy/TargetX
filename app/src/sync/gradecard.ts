/**
 * KTU grade card import.
 *
 * A port of ktu_import.py. The grade card is the university's own document, so
 * it outranks anything scraped or typed — and for a student whose college
 * portal TargetX cannot read, it is the way a whole academic history gets in.
 *
 * Deliberately tolerant: the same information arrives as a PDF, as an HTML
 * results page, and as a table pasted out of either. Rather than three parsers,
 * every line is scanned for a course code, a grade token after it, and a small
 * number that looks like credits.
 */
import {
  GRADE_POINTS, isGraded, isIncomplete, normaliseGrade, sgpa as computeSgpa,
} from "../engine";
import { CODE_RE } from "../engine/parse";

const GRADE_TOKENS = ["A+", "B+", "C+", "S", "A", "B", "C", "D", "P", "F",
                      "FE", "I", "W", "AB"] as const;

/**
 * Exactly what `GRADE_RE` can match, which is wider than `Grade`.
 *
 * Four of these tokens - FE, I, W, AB - carry no grade point, so a parsed
 * token is not a `Grade` and must not be typed as one. It was typed as one:
 * the `as Grade` this replaces let `GRADE_POINTS[c.grade]` compile and score a
 * withdrawal zero at full credits. Derived from the token list so the two
 * cannot drift apart.
 */
export type CardToken = (typeof GRADE_TOKENS)[number];
// The lookbehind stops "B" being found inside a word, and the longer tokens are
// listed first so "A+" is never read as "A" followed by a stray plus.
const GRADE_RE = new RegExp(
  `(?<![A-Za-z+])(${GRADE_TOKENS.join("|").replace(/\+/g, "\\+")})(?![A-Za-z])`, "g");

const SEM_RE = /\bS(?:EM(?:ESTER)?)?\s*[-: ]?\s*([1-8])\b/i;
const ORDINAL_SEM = /\b(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH)\s+SEMESTER\b/i;
const ORDINALS = ["FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH"];
const SGPA_RE = /\bSGPA\s*[:=]?\s*(\d+(?:\.\d+)?)/i;

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

export function parseGradeCard(text: string): GradeCard {
  const semesters: Record<string, { courses: CardCourse[]; sgpaPrinted?: number }> = {};
  let current = "S1";
  let seenSem = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const foundSem = semesterFromLine(line);
    const codeMatch = CODE_RE.exec(line);

    // A bare semester heading (no course code on it) switches context.
    if (foundSem && !codeMatch) {
      current = foundSem;
      seenSem = true;
      continue;
    }

    const sgpaMatch = SGPA_RE.exec(line);
    if (sgpaMatch && !codeMatch) {
      (semesters[current] ??= { courses: [] }).sgpaPrinted = Number(sgpaMatch[1]);
      continue;
    }
    if (!codeMatch) continue;

    const tail = line.slice(codeMatch.index + codeMatch[0].length);

    // Keep the LAST grade token: the grade sits at the end of the row, and an
    // earlier one is part of the course title ("Design and Analysis").
    let gradeMatch: RegExpExecArray | null = null;
    GRADE_RE.lastIndex = 0;
    for (let m = GRADE_RE.exec(tail); m !== null; m = GRADE_RE.exec(tail)) gradeMatch = m;
    if (!gradeMatch) continue;
    const grade = gradeMatch[1] as CardToken;

    // Credits are the last small number before the grade. Anything above 8 is
    // a mark or a roll number, not a credit.
    let credits = 0;
    for (const number of tail.slice(0, gradeMatch.index).match(/\b\d+(?:\.\d+)?\b/g) ?? []) {
      const value = Number(number);
      if (value > 0 && value <= 8) credits = value;
    }
    if (!credits) credits = 3;

    let name = "";
    for (const chunk of tail.trim().split(/\s{2,}|\t|\|/)) {
      const candidate = chunk.trim();
      if (candidate && !/^[\d.\s]+$/.test(candidate) && candidate !== grade) {
        name = candidate;
        break;
      }
    }

    // A code seen on the same line as a semester marker belongs to it.
    if (foundSem) {
      current = foundSem;
      seenSem = true;
    }

    (semesters[current] ??= { courses: [] }).courses.push({
      code: codeMatch[1]!, name, credits, grade,
      passed: !FAIL_TOKENS.has(grade),
    });
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
    // Rebuild lines from item positions: a grade card is a table, and joining
    // every item with a space would put a whole page on one line.
    const lines = new Map<number, string[]>();
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (!item.str || !item.transform) continue;
      const y = Math.round(item.transform[5]! / 3);
      (lines.get(y) ?? lines.set(y, []).get(y)!).push(item.str);
    }
    pages.push(Array.from(lines.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, parts]) => parts.join("  "))
      .join("\n"));
  }
  return pages.join("\n");
}
