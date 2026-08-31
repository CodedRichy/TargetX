import { describe, expect, it } from "vitest";
import { HISTORY_RANK, mergeHistory, mergeHistoryInto } from "../history";
import type { HistorySource, SemesterHistory } from "../types";

/**
 * Issue #5: a KTU grade card figure and a college-portal scrape used to be
 * indistinguishable once stored, so a re-sync of the wrong source silently
 * overwrote the right one. The fix is a source tag with a fixed precedence -
 * the card is the university's own record and wins - and a kept record of any
 * disagreement so it can be shown rather than dropped.
 */

const entry = (source: HistorySource, sgpa: number): SemesterHistory => ({
  sgpa, creditsRegistered: 20, creditsEarned: 20, source, conflict: null,
});

describe("history source precedence", () => {
  it("ranks the KTU grade card above every other source", () => {
    expect(HISTORY_RANK.gradecard).toBeGreaterThan(HISTORY_RANK.manual);
    expect(HISTORY_RANK.gradecard).toBeGreaterThan(HISTORY_RANK.unknown);
    expect(HISTORY_RANK.gradecard).toBeGreaterThan(HISTORY_RANK.etlab);
    expect(HISTORY_RANK.etlab).toBeLessThan(HISTORY_RANK.unknown);
  });

  it("takes the first figure when nothing is stored yet", () => {
    const out = mergeHistory(undefined, entry("etlab", 7.5));
    expect(out.sgpa).toBe(7.5);
    expect(out.source).toBe("etlab");
    expect(out.conflict).toBeNull();
  });

  it("lets the grade card overwrite a portal scrape", () => {
    const out = mergeHistory(entry("etlab", 7.2), entry("gradecard", 7.8));
    expect(out.sgpa).toBe(7.8);
    expect(out.source).toBe("gradecard");
  });

  it("refuses to let a portal scrape overwrite a grade card", () => {
    const out = mergeHistory(entry("gradecard", 7.8), entry("etlab", 7.2));
    expect(out.sgpa).toBe(7.8);
    expect(out.source).toBe("gradecard");
  });

  it("keeps the disagreement, whichever way the sources arrive", () => {
    const cardThenPortal = mergeHistory(entry("gradecard", 7.8), entry("etlab", 7.2));
    expect(cardThenPortal.conflict).toEqual({ source: "etlab", sgpa: 7.2 });

    const portalThenCard = mergeHistory(entry("etlab", 7.2), entry("gradecard", 7.8));
    expect(portalThenCard.sgpa).toBe(7.8);
    expect(portalThenCard.conflict).toEqual({ source: "etlab", sgpa: 7.2 });
  });

  it("records no conflict when the two sources agree", () => {
    const out = mergeHistory(entry("gradecard", 7.8), entry("etlab", 7.8));
    expect(out.conflict).toBeNull();
  });

  it("treats a tiny rounding gap as agreement, not a conflict", () => {
    const out = mergeHistory(entry("gradecard", 7.8), entry("etlab", 7.803));
    expect(out.conflict).toBeNull();
  });

  it("refreshes an equal-ranked source without inventing a conflict", () => {
    const stale = { ...entry("etlab", 7.2), conflict: { source: "gradecard" as HistorySource, sgpa: 7.8 } };
    const out = mergeHistory(stale, entry("etlab", 7.5));
    expect(out.sgpa).toBe(7.5);
    expect(out.conflict).toBeNull();
  });

  it("keeps a pre-provenance figure over a fresh scrape but yields to a card", () => {
    const overScrape = mergeHistory(entry("unknown", 8.0), entry("etlab", 7.0));
    expect(overScrape.sgpa).toBe(8.0);
    expect(overScrape.source).toBe("unknown");
    expect(overScrape.conflict).toEqual({ source: "etlab", sgpa: 7.0 });

    const underCard = mergeHistory(entry("unknown", 8.0), entry("gradecard", 7.6));
    expect(underCard.sgpa).toBe(7.6);
    expect(underCard.source).toBe("gradecard");
  });

  it("does not let a scrape clobber a hand-typed figure", () => {
    const out = mergeHistory(entry("manual", 9.1), entry("etlab", 6.4));
    expect(out.sgpa).toBe(9.1);
    expect(out.source).toBe("manual");
    expect(out.conflict).toEqual({ source: "etlab", sgpa: 6.4 });
  });
});

describe("mergeHistoryInto", () => {
  it("folds a whole map key by key, respecting precedence per semester", () => {
    const base = { S1: entry("gradecard", 7.8), S2: entry("etlab", 6.0) };
    const incoming = { S1: entry("etlab", 7.0), S2: entry("gradecard", 6.5), S3: entry("etlab", 8.0) };
    const out = mergeHistoryInto(base, incoming);
    expect(out.S1!.source).toBe("gradecard");   // card held against the scrape
    expect(out.S1!.sgpa).toBe(7.8);
    expect(out.S1!.conflict).toEqual({ source: "etlab", sgpa: 7.0 });
    expect(out.S2!.source).toBe("gradecard");   // card won over the stored scrape
    expect(out.S2!.sgpa).toBe(6.5);
    expect(out.S3!.source).toBe("etlab");        // new semester, no contest
  });

  it("does not mutate the base map", () => {
    const base = { S1: entry("etlab", 7.0) };
    mergeHistoryInto(base, { S1: entry("gradecard", 8.0) });
    expect(base.S1!.sgpa).toBe(7.0);
  });
});
