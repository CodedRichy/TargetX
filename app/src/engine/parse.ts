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
export function parseEtlab(text: string, mode: "attendance" | "marks"): PastedRow[] {
  const rows: PastedRow[] = [];

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
      const marks = numbers.slice(0, 3);
      if (marks.length === 0) continue;
      const keys = ["s1", "s2", "other"] as const;
      marks.forEach((value, i) => { entry[keys[i]!] = value; });
    }

    rows.push(entry);
  }
  return rows;
}
