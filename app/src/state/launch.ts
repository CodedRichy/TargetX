import { GRADE_POINTS, driftsFrom, evaluate, isGraded, sgpa as computeSgpa } from "../engine";
import { saveFault, state } from "./store";

/**
 * The launch check.
 *
 * Every time the app opens it audits what it is holding before showing it. A
 * tracker that confidently displays a CGPA built on a credit it got wrong is
 * worse than one that admits it - so the checks that can only be answered by
 * recomputation run here, once, rather than being buried in a screen the
 * student may never open.
 *
 * What it deliberately does NOT do is sync. This check is arithmetic over data
 * already in memory and must finish in milliseconds; a portal sync crosses the
 * network to a college server and cannot be on the path to the first paint.
 * Staleness is reported here and acted on separately - see `state/autosync`,
 * which runs after this, only when the student has already chosen to keep
 * their login in the OS credential vault, and never blocks anything.
 */

export type FindingKind =
  "reconcile" | "stale" | "empty" | "attendance" | "corrupt" | "save"
  /** Raised by the background sync, not by this check. */
  | "sync";

export interface Finding {
  kind: FindingKind;
  severity: "warn" | "info";
  title: string;
  detail: string;
  /** Which screen fixes it. */
  goto: "ledger" | "history" | "data";
  action: string;
}

/** How many days since the last successful portal sync, or null if never. */
export function daysSinceSync(): number | null {
  if (!state.lastSync) return null;
  const then = new Date(state.lastSync).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

/**
 * Semesters whose published SGPA disagrees with what the stored subjects
 * recompute to.
 *
 * Only complete semesters are compared. Recomputing from four of seven
 * subjects always disagrees, and reporting that as a fault is crying wolf -
 * the student learns to ignore the warning that matters.
 */
export function reconcileFailures(): string[] {
  const out: string[] = [];
  for (const [name, published] of Object.entries(state.history)) {
    // Registered credits are what the stored subjects should add up to. A
    // semester whose registered total is unknown cannot be reconciled at all.
    const registered = published?.creditsRegistered ?? 0;
    if (!published || registered <= 0) continue;
    const courses = state.semesters[name]?.courses ?? [];
    // A withdrawn or incomplete course is not one of the graded ones, and its
    // credits are not part of the total they are checked against.
    const graded: Array<[number, number]> = [];
    for (const course of courses) {
      const ev = evaluate(course);
      if (isGraded(ev.grade)) graded.push([ev.credits, GRADE_POINTS[ev.grade]]);
    }
    if (!graded.length) continue;

    const credits = graded.reduce((sum, [c]) => sum + c, 0);
    if (Math.abs(credits - registered) >= 0.01) continue;
    if (driftsFrom(computeSgpa(graded), published.sgpa)) out.push(name);
  }
  return out;
}

/** Subjects in the active semester that cannot sit the exam as things stand. */
export function ineligibleCount(): number {
  const courses = state.semesters[state.activeSemester]?.courses ?? [];
  return courses.filter((c) => evaluate(c).eligible === false).length;
}

/**
 * What the last save did, when it did not do all of it.
 *
 * Deliberately NOT part of `runLaunchCheck`: that runs once at launch over data
 * already in memory, and a save fails later, while the student is typing. This
 * is re-read every render instead, and it clears itself the moment a save
 * succeeds.
 *
 * The action sends them to the manual export, because that is the one thing
 * that still works when the automatic path is broken - and it has to be
 * offered while the numbers are still on screen.
 */
export function saveFindings(): Finding[] {
  const fault = saveFault();
  if (!fault) return [];
  if (fault.kind === "backup") {
    return [{
      kind: "save", severity: "info",
      title: "TargetX is not keeping a backup copy",
      detail: "Your marks are being saved, but the older copies TargetX keeps "
        + `beside them could not be written: ${fault.error}`,
      goto: "data", action: "Export a copy",
    }];
  }
  return [{
    kind: "save", severity: "warn",
    title: "Your marks are not being saved",
    detail: fault.kind === "file"
      ? "TargetX could not write to the file it keeps your record in, so "
        + "everything typed since is only in this window and goes when it "
        + `closes. Export a copy before that happens. ${fault.error}`
      : "This browser is refusing to store anything — private mode, or the "
        + "storage is full — and there is no file behind it, so everything "
        + `typed here goes when the tab closes. ${fault.error}`,
    goto: "data", action: "Export a copy now",
  }];
}

export function runLaunchCheck(): Finding[] {
  const out: Finding[] = [];

  // Shape first: everything below assumes these exist.
  if (!state.semesters || typeof state.semesters !== "object") {
    return [{
      kind: "corrupt", severity: "warn",
      title: "Your saved data could not be read",
      detail: "The file TargetX stores on this computer is not in a shape it "
        + "recognises. Restoring a backup is the safe way out; starting fresh "
        + "is the other.",
      goto: "data", action: "Restore a backup",
    }];
  }

  const tracked = Object.values(state.semesters)
    .reduce((n, sem) => n + (sem?.courses?.length ?? 0), 0);

  if (tracked === 0 && !Object.keys(state.history).length) {
    return [{
      kind: "empty", severity: "info",
      title: "Nothing recorded yet",
      detail: "Sign in to your portal, drop in a KTU grade card, or paste a "
        + "table — any of the three fills this in.",
      goto: "data", action: "Get your marks in",
    }];
  }

  const drifting = reconcileFailures();
  if (drifting.length) {
    out.push({
      kind: "reconcile", severity: "warn",
      title: drifting.length === 1
        ? `${drifting[0]} does not reconcile`
        : `${drifting.length} semesters do not reconcile`,
      detail: "The SGPA recomputed from the subjects stored disagrees with the "
        + "one the university published, which means an inferred credit is "
        + "wrong. Every projection built on it inherits the error.",
      goto: "history", action: "Check credits",
    });
  }

  const short = ineligibleCount();
  if (short) {
    out.push({
      kind: "attendance", severity: "warn",
      title: `${short} subject${short === 1 ? "" : "s"} below the attendance floor`,
      detail: "Below 75% is not a warning about marks — it is not being allowed "
        + "to sit the exam. It is also the only thing here that gets harder to "
        + "fix with every week that passes.",
      goto: "ledger", action: "See which",
    });
  }

  const days = daysSinceSync();
  if (days !== null && days >= 7) {
    out.push({
      kind: "stale", severity: "info",
      title: `Last synced ${days} days ago`,
      detail: "Attendance moves every week. TargetX cannot sync on its own "
        + "because it never stores your portal password.",
      goto: "data", action: "Sync now",
    });
  }

  return out;
}
