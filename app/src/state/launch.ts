import { GRADE_POINTS, evaluate, sgpa as computeSgpa } from "../engine";
import { state } from "./store";

/**
 * The launch check.
 *
 * Every time the app opens it audits what it is holding before showing it. A
 * tracker that confidently displays a CGPA built on a credit it got wrong is
 * worse than one that admits it - so the checks that can only be answered by
 * recomputation run here, once, rather than being buried in a screen the
 * student may never open.
 *
 * What it deliberately does NOT do is sync. A portal sync needs a password,
 * and the password is never stored; running one on launch would mean keeping
 * a credential on disk to save a click. Staleness is reported instead.
 */

export type FindingKind = "reconcile" | "stale" | "empty" | "attendance" | "corrupt";

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
    if (!published || published.credits <= 0) continue;
    const courses = state.semesters[name]?.courses ?? [];
    const graded = courses
      .map((c) => evaluate(c))
      .filter((ev) => ev.grade !== null)
      .map((ev) => [ev.credits, GRADE_POINTS[ev.grade!]] as [number, number]);
    if (!graded.length) continue;

    const credits = graded.reduce((sum, [c]) => sum + c, 0);
    if (Math.abs(credits - published.credits) >= 0.01) continue;
    if (Math.abs(computeSgpa(graded) - published.sgpa) >= 0.01) out.push(name);
  }
  return out;
}

/** Subjects in the active semester that cannot sit the exam as things stand. */
export function ineligibleCount(): number {
  const courses = state.semesters[state.activeSemester]?.courses ?? [];
  return courses.filter((c) => {
    const ev = evaluate(c);
    return ev.attendance > 0 && !ev.eligible;
  }).length;
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
