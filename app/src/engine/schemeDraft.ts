import type { Letter } from "./types";
import type { Scheme } from "./scheme";

/**
 * A scheme profile as the strings a form holds, and the rules that turn those
 * strings back into numbers the engine may read.
 *
 * This lived inside `ui/Schemes.tsx` while the editor was the only way to
 * author a profile. Importing one from a file is a second way in, and it is
 * the more dangerous of the two - a hand-edited or hand-written JSON file has
 * had no form standing between it and the store. Two validators would drift,
 * and the half that drifted would be the one guarding the untrusted input.
 * So there is one, here, and both routes go through it.
 *
 * No Solid, no store: the same reason `engine/scheme.ts` holds the active
 * profile in a plain variable. Validation is arithmetic about numbers, and it
 * is tested as such.
 */

export interface BandDraft { letter: Letter; minPct: string; points: string }
export interface AttBandDraft { minPct: string; marks: string }

export interface Draft {
  name: string;
  gradeBands: BandDraft[];
  totalPassMark: string;
  /** A percentage in the box; `Scheme.esePassFraction` is the fraction. */
  esePassPct: string;
  attendanceMin: string;
  attendanceCondone: string;
  dlCapPct: string;
  attendanceMarkBands: AttBandDraft[];
  attendanceMarkMax: string;
}

export function toDraft(s: Scheme): Draft {
  return {
    name: s.name,
    gradeBands: s.gradeBands.map((b) => ({
      letter: b.letter, minPct: String(b.minPct), points: String(b.points),
    })),
    totalPassMark: String(s.totalPassMark),
    esePassPct: String(s.esePassFraction * 100),
    attendanceMin: String(s.attendanceMin),
    attendanceCondone: String(s.attendanceCondone),
    dlCapPct: String(s.dlCapPct),
    attendanceMarkBands: s.attendanceMarkBands.map((b) => ({
      minPct: String(b.minPct), marks: String(b.marks),
    })),
    attendanceMarkMax: String(s.attendanceMarkMax),
  };
}

export const asNumber = (raw: string): number | null => {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
};

/**
 * Validate a draft and, only when it is coherent, build the patch that would
 * be written.
 *
 * Every rule here exists because the engine reads the field it guards without
 * re-checking it - `gradeForTotal` (engine/grade.ts) returns the FIRST band
 * whose `minPct` a total clears, so an out-of-order or overlapping list does
 * not fail loudly, it quietly hands out the wrong letter. That is the one
 * failure mode this form must make impossible rather than merely unlikely, so
 * a bad value is refused here rather than reaching `updateProfile`.
 */
export function resolveDraft(d: Draft): { errors: string[]; patch?: Partial<Omit<Scheme, "id" | "builtIn">> } {
  const errors: string[] = [];

  if (!d.name.trim()) errors.push("Give this profile a name.");

  // Grade bands must be strictly descending by minPct and cover [0, 100] with
  // no letter repeated - `gradeForTotal`'s first-match walk depends on it, and
  // `gradePoints()` depends on unique letters.
  const seenLetters = new Set<string>();
  const gradeBands = d.gradeBands.map((b, i) => {
    const minPct = asNumber(b.minPct);
    const points = asNumber(b.points);
    if (minPct === null || minPct < 0 || minPct > 100) {
      errors.push(`${b.letter}: minimum % must be a number from 0 to 100.`);
    }
    if (points === null || points < 0) {
      errors.push(`${b.letter}: grade points must be zero or more.`);
    }
    if (seenLetters.has(b.letter)) errors.push(`${b.letter} is listed twice.`);
    seenLetters.add(b.letter);
    if (i > 0) {
      const prev = asNumber(d.gradeBands[i - 1]!.minPct);
      if (minPct !== null && prev !== null && minPct >= prev) {
        errors.push(
          `${b.letter}'s minimum (${b.minPct}%) must be lower than `
          + `${d.gradeBands[i - 1]!.letter}'s (${d.gradeBands[i - 1]!.minPct}%) - `
          + `the bands are read top to bottom and the first match wins.`,
        );
      }
      if (points !== null && prev !== null) {
        const prevPoints = asNumber(d.gradeBands[i - 1]!.points);
        if (prevPoints !== null && points >= prevPoints) {
          errors.push(
            `${b.letter} should carry fewer grade points than `
            + `${d.gradeBands[i - 1]!.letter} - it is the lower grade.`,
          );
        }
      }
    }
    return { letter: b.letter, minPct: minPct ?? 0, points: points ?? 0 };
  });

  const totalPassMark = asNumber(d.totalPassMark);
  if (totalPassMark === null || totalPassMark < 0 || totalPassMark > 100) {
    errors.push("Pass mark must be a number from 0 to 100.");
  }
  const lowestBand = d.gradeBands.length
    ? d.gradeBands.reduce((a, b) => (asNumber(b.minPct)! < asNumber(a.minPct)! ? b : a))
    : null;
  if (lowestBand && totalPassMark !== null) {
    const lowestPct = asNumber(lowestBand.minPct);
    if (lowestPct !== null && Math.abs(lowestPct - totalPassMark) > 0.001) {
      errors.push(
        `The pass mark (${d.totalPassMark}) does not match your lowest passing `
        + `grade, ${lowestBand.letter} at ${lowestBand.minPct}% - a total between `
        + `the two would pass without earning any letter.`,
      );
    }
  }

  const esePassPct = asNumber(d.esePassPct);
  if (esePassPct === null || esePassPct < 0 || esePassPct > 100) {
    errors.push("Exam minimum must be a percentage from 0 to 100.");
  }

  const attendanceMin = asNumber(d.attendanceMin);
  if (attendanceMin === null || attendanceMin < 0 || attendanceMin > 100) {
    errors.push("Attendance eligibility must be a percentage from 0 to 100.");
  }
  const attendanceCondone = asNumber(d.attendanceCondone);
  if (attendanceCondone === null || attendanceCondone < 0 || attendanceCondone > 100) {
    errors.push("Condonation floor must be a percentage from 0 to 100.");
  }
  if (attendanceMin !== null && attendanceCondone !== null && attendanceCondone > attendanceMin) {
    errors.push("Condonation floor must be at or below the eligibility minimum, not above it.");
  }

  const dlCapPct = asNumber(d.dlCapPct);
  if (dlCapPct === null || dlCapPct < 0 || dlCapPct > 100) {
    errors.push("Duty-leave cap must be a percentage from 0 to 100.");
  }

  const attendanceMarkMax = asNumber(d.attendanceMarkMax);
  if (attendanceMarkMax === null || attendanceMarkMax < 0) {
    errors.push("Full attendance marks must be zero or more.");
  }

  const attendanceMarkBands = d.attendanceMarkBands.map((b, i) => {
    const minPct = asNumber(b.minPct);
    const marks = asNumber(b.marks);
    const row = i + 1;
    if (minPct === null || minPct < 0 || minPct > 100) {
      errors.push(`Attendance band ${row}: minimum % must be a number from 0 to 100.`);
    }
    if (marks === null || marks < 0) {
      errors.push(`Attendance band ${row}: marks must be zero or more.`);
    }
    if (attendanceMarkMax !== null && marks !== null && marks > attendanceMarkMax) {
      errors.push(`Attendance band ${row}: ${b.marks} marks exceeds the full ${d.attendanceMarkMax}.`);
    }
    if (i > 0) {
      const prevMin = asNumber(d.attendanceMarkBands[i - 1]!.minPct);
      const prevMarks = asNumber(d.attendanceMarkBands[i - 1]!.marks);
      if (minPct !== null && prevMin !== null && minPct >= prevMin) {
        errors.push(`Attendance band ${row}'s minimum must be lower than band ${row - 1}'s - they are read top to bottom.`);
      }
      if (marks !== null && prevMarks !== null && marks >= prevMarks) {
        errors.push(`Attendance band ${row} should pay fewer marks than band ${row - 1} - it is the lower band.`);
      }
    }
    return { minPct: minPct ?? 0, marks: marks ?? 0 };
  });

  if (errors.length > 0) return { errors };

  return {
    errors,
    patch: {
      name: d.name.trim(),
      gradeBands,
      totalPassMark: totalPassMark!,
      esePassFraction: esePassPct! / 100,
      attendanceMin: attendanceMin!,
      attendanceCondone: attendanceCondone!,
      dlCapPct: dlCapPct!,
      attendanceMarkBands,
      attendanceMarkMax: attendanceMarkMax!,
    },
  };
}

