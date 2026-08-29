import type { MarkInput } from "./types";

export const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

/** Coerce to a number, falling back when the field is blank or junk. */
export function toFloat(text: MarkInput, fallback = 0): number {
  if (typeof text === "number") return Number.isFinite(text) ? text : fallback;
  if (text === null || text === undefined) return fallback;
  const trimmed = String(text).trim();
  if (trimmed === "") return fallback;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Blank stays blank - an unwritten ESE is not a zero.
 *
 * This is the distinction the whole engine rests on. `toFloat` is for fields
 * where a default is genuinely meaningful; everywhere a missing value should
 * suppress a projection instead of feeding it, use this.
 */
export function toOptionalFloat(text: MarkInput): number | null {
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Round to `places`, nudging away from binary float error first.
 *
 * 0.1 + 0.2 lands just under 0.3, and without the nudge a mark that should
 * read 87.78 renders as 87.77. The epsilon is scaled relative to the value so
 * it stays meaningful for both 5.5 and 550.
 */
export function round(value: number, places = 2): number {
  const factor = 10 ** places;
  const scaled = value * factor;
  const nudged = scaled + Math.sign(scaled) * Math.abs(scaled) * Number.EPSILON * 4;
  return Math.round(nudged) / factor;
}

/** Ceiling with the same float-error guard, so 24.000000001 does not become 25. */
export const ceil = (value: number): number => Math.ceil(value - 1e-9);
export const floor = (value: number): number => Math.floor(value + 1e-9);

/**
 * How far a recomputed SGPA may sit from the published one before it is a
 * disagreement worth telling the student about.
 *
 * A hundredth: KTU publishes two decimal places, so anything smaller is not
 * something the two figures could actually differ by.
 */
export const DRIFT_TOLERANCE = 0.01;

/**
 * Does a recomputed figure disagree with the published one?
 *
 * One function because there were two, and they disagreed with each other.
 * History rounded to three places before comparing and the launch check did
 * not, so a real difference anywhere in [0.0095, 0.01) was flagged on one
 * screen and called clean on the other - and a student who followed the
 * warning to History found nothing wrong there.
 *
 * The comparison is on the raw values. Rounding is a display concern and has
 * no business deciding whether the numbers match.
 */
export const driftsFrom = (recomputed: number, published: number): boolean =>
  Math.abs(recomputed - published) >= DRIFT_TOLERANCE;
