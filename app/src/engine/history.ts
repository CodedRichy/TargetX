import type { HistorySource, SemesterHistory } from "./types";

/**
 * How far each source is trusted, high wins. The order is the whole point of
 * issue #5: the KTU grade card is the university's own record and outranks a
 * college-portal scrape the student has watched be wrong.
 *
 *   gradecard  the university's published document. The authority.
 *   manual     a figure the student typed by hand - a deliberate act.
 *   unknown    restored from a pre-provenance save; origin unrecoverable, so
 *              trusted over a fresh scrape (it may be a card) but below one.
 *   etlab      a college-portal scrape. The lowest, because it is the source
 *              the reporter of #5 said was wrong.
 */
export const HISTORY_RANK: Record<HistorySource, number> = {
  gradecard: 3,
  manual: 2,
  unknown: 1,
  etlab: 0,
};

/**
 * Two SGPAs are "the same" within the precision either source prints.
 *
 * Exported because `setHistory` asks the same question when it decides whether
 * a hand edit changed the figure or only the credits beside it. A second copy
 * of this tolerance would be a second definition of "the student changed it",
 * and the two would drift.
 */
export const sameSgpa = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * Fold one incoming history figure onto whatever is already stored for that
 * semester, deciding which survives and whether the two disagree.
 *
 * The rule is precedence, not recency: the higher-ranked source wins, and an
 * equal rank (the same source re-syncing) takes the fresh figure. A lower
 * source never overwrites a higher one - that is what stops an etlab re-sync
 * from wiping a grade-card SGPA, the exact bug #5 names.
 *
 * A disagreement is kept, not dropped. When the winner and loser are different
 * sources naming a different SGPA, the loser is recorded in `conflict` so the
 * History screen can show "the portal says X, the card says Y" instead of the
 * app quietly agreeing with itself. When they agree, or the same source is just
 * refreshing, any stale conflict is cleared.
 */
export function mergeHistory(
  existing: SemesterHistory | undefined,
  incoming: SemesterHistory,
): SemesterHistory {
  if (!existing) return { ...incoming, conflict: incoming.conflict ?? null };

  const incomingWins = HISTORY_RANK[incoming.source] >= HISTORY_RANK[existing.source];
  const winner = incomingWins ? incoming : existing;
  const loser = incomingWins ? existing : incoming;

  // A real disagreement is two DIFFERENT sources with different SGPAs. The same
  // source refreshing itself is an update, never a conflict.
  const disagrees =
    winner.source !== loser.source && !sameSgpa(winner.sgpa, loser.sgpa);

  return {
    ...winner,
    conflict: disagrees ? { source: loser.source, sgpa: loser.sgpa } : null,
  };
}

/** Fold a whole incoming history map onto the stored one, key by key. */
export function mergeHistoryInto(
  base: Record<string, SemesterHistory>,
  incoming: Record<string, SemesterHistory>,
): Record<string, SemesterHistory> {
  const out: Record<string, SemesterHistory> = { ...base };
  for (const [name, entry] of Object.entries(incoming)) {
    out[name] = mergeHistory(out[name], entry);
  }
  return out;
}
