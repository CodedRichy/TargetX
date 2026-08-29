import { COURSE_TYPES } from "./constants";
import type { MarkInput } from "./types";
import { clamp, round } from "./util";

export const CODE_RE = /\b([A-Z]{2,6}\d{3}[A-Z]?)\b/;
const NUM_G = /\d+(?:\.\d+)?/g;
const NUM_FULL = /^\d+(?:\.\d+)?$/;

export interface PastedRow {
  code: string;
  name: string;
  attendance?: number;
  s1?: number;
  s2?: number;
  other?: number;
}

/** A row that carried a course code and was still not safe to read. */
export interface SkippedRow {
  code: string;
  /** Said to the student verbatim, so it names the row and the reason. */
  reason: string;
}

export interface ParsedPaste {
  rows: PastedRow[];
  skipped: SkippedRow[];
}

/**
 * The largest raw value each mark column can hold, over every course type.
 *
 * Derived rather than written down: if a course type ever changes a component's
 * raw scale, this follows it instead of quietly disagreeing with it.
 *
 * This is what makes a mis-read column detectable. An etlab marks page prints
 * mark and maximum side by side, so a row reads `42 50 40 50 9 10` - and taking
 * the first three numbers put the S2 MAXIMUM into S2 and the S2 mark into a
 * column whose scale is 10. A value over its own raw maximum is proof the
 * mapping is wrong, and that is worth more than any heuristic about column
 * counts.
 */
const RAW_MAX = (["s1", "s2", "other"] as const).map((key, index) =>
  Math.max(...Object.values(COURSE_TYPES)
    .map((spec) => spec.components[index]?.rawMax ?? 0))) as [number, number, number];

/** `42/50` pairs, which is how most etlab themes print a mark. */
const PAIR_G = /(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g;

/**
 * Tolerant parser for text copied out of an etlab page.
 *
 * Live sync is the primary path, but etlab markup varies per college and a
 * deployment that sync cannot read still leaves the student with a rendered
 * table in front of them. Copy-paste is the fallback that works everywhere.
 *
 * mode "attendance": pulls a percentage, or derives one from present/total.
 * mode "marks":      maps the numbers on the line onto S1, S2, Asg in order.
 */
export function parseEtlab(text: string, mode: "attendance" | "marks"): ParsedPaste {
  const rows: PastedRow[] = [];
  const skipped: SkippedRow[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const codeMatch = CODE_RE.exec(line);
    if (!codeMatch) continue;

    const rest = line.slice(codeMatch.index + codeMatch[0].length);

    let name = "";
    for (const bit of rest.trim().split(/\s{2,}|\t|\|/)) {
      const candidate = bit.trim();
      if (candidate && !NUM_FULL.test(candidate.replace("%", ""))) {
        name = candidate;
        break;
      }
    }

    const numbers = (rest.match(NUM_G) ?? []).map(Number);
    const entry: PastedRow = { code: codeMatch[1]!, name };

    if (mode === "attendance") {
      let percent: number | null = null;
      const pct = /(\d+(?:\.\d+)?)\s*%/.exec(rest);
      if (pct) {
        percent = Number(pct[1]);
      } else if (numbers.length >= 2) {
        const [present, total] = numbers as [number, number];
        if (total > 0 && present <= total) percent = (present / total) * 100;
      } else if (numbers.length === 1 && numbers[0]! <= 100) {
        percent = numbers[0]!;
      }
      if (percent === null) continue;
      entry.attendance = round(clamp(percent, 0, 100), 2);
    } else {
      const marks = marksFrom(rest);
      if (marks === "empty") continue;
      if (marks === "ambiguous") {
        // Refused rather than guessed. A wrong mark here does not look wrong:
        // it produces a confident CIE that is too high or too low, and the
        // student has nothing to check it against. Saying "I could not read
        // this row" is the only honest answer.
        skipped.push({
          code: entry.code,
          reason: "the mark and maximum columns could not be told apart",
        });
        continue;
      }
      const keys = ["s1", "s2", "other"] as const;
      marks.forEach((value, i) => { entry[keys[i]!] = value; });
    }

    rows.push(entry);
  }
  return { rows, skipped };
}

/**
 * The three CIE marks on one row, or a refusal.
 *
 * Two shapes are read. `42/50 40/50 9/10` is unambiguous, so the numerators are
 * taken. Bare numbers are only trusted when there are at most three of them AND
 * each fits its own column - anything else is a row whose columns this parser
 * cannot identify, and it is refused.
 */
function marksFrom(rest: string): number[] | "empty" | "ambiguous" {
  PAIR_G.lastIndex = 0;
  const pairs = Array.from(rest.matchAll(PAIR_G))
    .map((m) => [Number(m[1]), Number(m[2])] as [number, number]);
  if (pairs.length >= 2) {
    const usable = pairs.filter(([mark, max]) => max > 0 && mark <= max).slice(0, 3);
    return usable.length >= 2 ? usable.map(([mark]) => mark) : "ambiguous";
  }

  const numbers = (rest.match(NUM_G) ?? []).map(Number);
  if (numbers.length === 0) return "empty";
  if (numbers.length > 3) return "ambiguous";
  return numbers.every((value, i) => value <= RAW_MAX[i]!) ? numbers : "ambiguous";
}
