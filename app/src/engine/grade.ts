import { GRADE_BANDS, GRADE_MIN, GRADE_POINTS } from "./constants";
import { eseCutoff } from "./cie";
import type { Grade, Incomplete, Letter, RequiredEse } from "./types";
import { ceil } from "./util";

/** A published non-completion, told apart from a grade that scores. */
export function isIncomplete(grade: Grade | Incomplete | null): grade is Incomplete {
  return grade === "I" || grade === "W";
}

/** A published or derived grade, i.e. one that carries a grade point. */
export function isGraded(grade: Grade | Incomplete | null): grade is Grade {
  return grade !== null && !isIncomplete(grade);
}

/**
 * Accept the many ways a portal writes a grade, or reject it cleanly.
 *
 * Result columns say PASSED/FAILED while grade columns say B+ or P, and the
 * two get mixed up in scraped rows - so only real grade letters survive.
 *
 * Three outcomes, not two. I and W are published and must not be discarded as
 * "nothing published" - a published verdict outranks anything derived, and
 * deriving a grade for a course the student withdrew from would be exactly
 * that mistake - but they are not grades either, so they come back as
 * themselves. See `Incomplete`.
 */
export function normaliseGrade(
  value: string | null | undefined,
): Grade | Incomplete | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (text === "" || text === "-" || text === "--") return null;
  // Pass/fail courses (life skills, NSS, professional writing) DO count.
  // Checked against the portal itself: it publishes GPA 5.5 for these rows,
  // and solving S2's published SGPA only works when they are included. An
  // earlier version excluded them and was wrong.
  if (["PASS", "PASSED", "P/F", "PF", "COMPLETED"].includes(text)) return "P";
  // Not in the fail list below: I and W were there once, and scored a
  // withdrawn course zero against its full credits.
  if (text === "I" || text === "W") return text;
  // AB stays: the student was admitted to the exam and did not appear.
  if (["FAIL", "FAILED", "F", "FE", "AB"].includes(text)) return "F";
  return text in GRADE_POINTS ? (text as Grade) : null;
}

export function gradeForTotal(total: number): Grade {
  for (const [letter, lo] of GRADE_BANDS) {
    if (total >= lo) return letter;
  }
  return "F";
}

/**
 * Reverse-solve the ESE mark needed for `targetLetter`.
 *
 * Two constraints bind at once and both must hold:
 *   1. CIE + ESE >= the band minimum for the grade
 *   2. ESE >= 40% of the ESE maximum (a separate minimum; a huge CIE cannot
 *      buy a pass, which is exactly where legacy 2019-era calculators lie)
 *
 * `binding` says which of the two is the real constraint, so the UI can mark
 * the number and explain that studying harder for the internals will not move
 * it.
 */
export function requiredEse(
  cie: number, targetLetter: Letter, eseMax: number,
): RequiredEse {
  const bandMin = GRADE_MIN[targetLetter];
  const cutoff = eseCutoff(eseMax);

  if (eseMax === 0) {
    const ok = cie >= bandMin;
    return { value: 0, possible: ok, text: ok ? "n/a" : "Impossible", binding: "cie-only" };
  }

  const fromTotal = bandMin - cie;
  const need = Math.max(0, ceil(Math.max(fromTotal, cutoff)));
  const binding = cutoff >= fromTotal ? "cutoff" : "aggregate";
  const possible = need <= eseMax;
  return { value: need, possible, text: possible ? `${need}/${eseMax}` : "Impossible", binding };
}

/**
 * Which of a row's two required-ESE figures to print, and whether it is a bound.
 *
 * Every row carries two answers to "what does this cost in the exam":
 * `Evaluation.needPass` priced off `cie`, and `needPassBest` priced off
 * `cieCeiling`. They can part company wherever the CIE can still move, and
 * where they do the figure to quote is the best-case one, marked as a bound -
 * because that is the one the rest of the app is already solved against
 * (`statusFor`, `summarise` and the plan all price off `cieCeiling`).
 * Quoting the floor-priced figure unmarked is how a cell came to read
 * "Impossible" beside a status pill reading TIGHT.
 *
 * `bound` is deliberately keyed on the two figures differing, not on the CIE
 * being able to move: where the 40% ESE minimum binds, a rising CIE does not
 * lower the requirement by a single mark, and marking that number as a bound
 * would promise a fall that cannot happen. It is also false when the best case
 * is impossible, where both figures say "Impossible" and there is no number to
 * bound, and on a course graded on its internal alone, where the two answers
 * differ in whether the grade is reachable but not by any number of marks.
 */
export function requiredEseCell(
  need: RequiredEse, best: RequiredEse,
): { shown: RequiredEse; bound: boolean } {
  const shown = best.possible ? best : need;
  return { shown, bound: shown.value !== need.value };
}
