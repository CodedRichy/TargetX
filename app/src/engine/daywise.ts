/**
 * The day-by-day attendance grid, kept month by month.
 *
 * The portal shows one month at a time and TargetX stored exactly that: a
 * single grid, overwritten by every sync. So on the first of October a
 * student's September disappeared - which is the month they would want, since
 * a wrongly marked absence is only ever found by looking back at a day you
 * remember being in class (issue #13).
 *
 * The record is therefore an archive keyed by month rather than one grid. A
 * sync files what it pulled under the month it belongs to and leaves every
 * other month alone. That accumulates forward: it cannot invent a September
 * the app was never running for, and it never loses one it saw.
 *
 * The key is `YYYY-MM`, which sorts correctly as a string - so the months come
 * out in order without parsing anything.
 */
import type { DaywiseAttendance, DaywiseDay } from "./types";

export type DaywiseArchive = Record<string, DaywiseAttendance>;

/** `2026-09` for a day dated in September 2026. */
export function monthKeyOfDay(day: DaywiseDay): string | null {
  const date = day.date;
  if (typeof date !== "string") return null;
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  return match ? `${match[1]}-${match[2]}` : null;
}

/**
 * The month a pulled grid belongs to.
 *
 * Taken from the first day that carries a date rather than from the majority:
 * the grid is one month's page, so every dated row in it agrees, and a row
 * whose label was not a day of the month has no date to disagree with.
 */
export function monthKeyOf(days: DaywiseAttendance): string | null {
  for (const day of days) {
    const key = monthKeyOfDay(day);
    if (key) return key;
  }
  return null;
}

/**
 * File a freshly pulled grid into the archive.
 *
 * Replaces that month outright rather than merging day by day. Within a month
 * the portal is the authority on every row, and a day that has vanished from
 * its page - a holiday retracted, a duplicate removed - should vanish here
 * too. What must never be touched is a DIFFERENT month, which is the whole
 * point.
 *
 * An undated grid is dropped rather than guessed at. Filing it under "the
 * current month" would write this month's page over a September the app
 * still holds, which is the exact loss this archive exists to prevent.
 */
export function fileMonth(archive: DaywiseArchive, days: DaywiseAttendance | null | undefined): DaywiseArchive {
  if (!days || days.length === 0) return archive;
  const key = monthKeyOf(days);
  if (!key) return archive;
  return { ...archive, [key]: days };
}

/** Months held, newest first - the order a student looks back in. */
export function monthsHeld(archive: DaywiseArchive | undefined): string[] {
  return Object.keys(archive ?? {}).sort().reverse();
}

/**
 * `September 2026` for `2026-09`.
 *
 * Built from the parts rather than from a Date, because `new Date("2026-09")`
 * is parsed as UTC midnight and prints as August in every timezone west of
 * Greenwich - the kind of off-by-one-month that only shows up for some users.
 */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return key;
  const name = MONTH_NAMES[Number(match[2]) - 1];
  return name ? `${name} ${match[1]}` : key;
}

/**
 * Bring a record written before the archive existed into it.
 *
 * The old single grid is filed under its own month when it is dated, and
 * dropped when it is not - an undated grid has no month to be looked up by,
 * and keeping it would put a nameless entry in a switcher.
 */
export function adoptLegacy(
  archive: DaywiseArchive | undefined,
  legacy: DaywiseAttendance | null | undefined,
): DaywiseArchive {
  return fileMonth(archive ?? {}, legacy);
}
