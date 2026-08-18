import { GRADE_BANDS, GRADE_MIN, GRADE_POINTS } from "./constants";
import { eseCutoff } from "./cie";
import type { Grade, Letter, RequiredEse } from "./types";
import { ceil } from "./util";

/**
 * Accept the many ways a portal writes a grade, or reject it cleanly.
 *
 * Result columns say PASSED/FAILED while grade columns say B+ or P, and the
 * two get mixed up in scraped rows - so only real grade letters survive.
 */
export function normaliseGrade(value: string | null | undefined): Grade | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (text === "" || text === "-" || text === "--") return null;
  // Pass/fail courses (life skills, NSS, professional writing) DO count.
  // Checked against the portal itself: it publishes GPA 5.5 for these rows,
  // and solving S2's published SGPA only works when they are included. An
  // earlier version excluded them and was wrong.
  if (["PASS", "PASSED", "P/F", "PF", "COMPLETED"].includes(text)) return "P";
  if (["FAIL", "FAILED", "F", "FE", "AB", "I", "W"].includes(text)) return "F";
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
