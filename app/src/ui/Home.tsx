import { For, Show, createMemo } from "solid-js";
import { ATTENDANCE_MARK_MAX } from "../engine";
import {
  goalRequirement, overall, rows, state, summary, trend,
} from "../state/store";
import { setView } from "../state/nav";
import { GoalGauge, TrendChart } from "./charts";

/**
 * Home.
 *
 * The screen that answers "am I fine?" before the student has to read a
 * table. Everything here is a consequence, not a statistic - the ledger
 * already shows the numbers, and repeating them larger would add nothing.
 *
 * The ordering is deliberate and is the whole design: standing first, then
 * the marks attendance is quietly costing, then what is actually breakable,
 * then how stale the data is. A card only earns its place if a student would
 * do something differently after reading it.
 */

/** A subject worth surfacing, with the reason it made the list. */
interface Concern {
  code: string;
  detail: string;
  severity: "bad" | "warn";
  /** Lower sorts first. Consequence order, not alphabetical. */
  rank: number;
}

export function Home() {
  const started = () => summary().credits > 0 || overall().credits > 0;

  /**
   * Semesters the app actually knows about.
   *
   * The union of what is being tracked and what the university has published -
   * counting only the editable ones reported "2 on record" for a student with
   * four published results sitting in history.
   */
  const onRecord = () => new Set([
    ...Object.keys(state.semesters),
    ...Object.keys(state.history),
  ]).size;

  /**
   * CIE marks currently being lost to attendance (R 7.5.ii).
   *
   * This is the number no portal and no other calculator shows, and it is the
   * reason the app exists - so it gets a card to itself rather than a column.
   */
  const attendanceCost = createMemo(() => {
    let lost = 0;
    let counted = 0;
    let cheapest: { code: string; attend: number; marks: number } | null = null;

    for (const row of rows()) {
      const ev = row.ev;
      if (ev.attMarks === null) continue;
      counted += 1;
      lost += ATTENDANCE_MARK_MAX - ev.attMarks;

      const band = ev.attBand;
      if (!band || band.nextMarks === null || band.attend <= 0) continue;
      if (!cheapest || band.attend < cheapest.attend) {
        cheapest = {
          code: row.course.code || row.course.name || "?",
          attend: band.attend,
          marks: band.nextMarks - band.earned,
        };
      }
    }
    return { lost: Math.round(lost * 10) / 10, counted, cheapest };
  });

  /** Everything breakable, ordered by how bad it is rather than by code. */
  const concerns = createMemo<Concern[]>(() => {
    const out: Concern[] = [];
    for (const row of rows()) {
      const ev = row.ev;
      const code = row.course.code || row.course.name || "?";

      if (ev.grade === "F") {
        out.push({ code, severity: "bad", rank: 0,
                   detail: "failed — needs a supplementary attempt" });
      } else if (ev.grade === null && !ev.needPass.possible) {
        out.push({ code, severity: "bad", rank: 1,
                   detail: "a pass is no longer reachable from the internals" });
      } else if (ev.eligible === false) {
        const plan = ev.plan;
        out.push({ code, severity: "warn", rank: 2,
                   detail: plan?.attend
                     ? `below 75% — ${plan.attend} classes in a row to be eligible`
                     : "below 75% — not eligible to sit the exam" });
      } else if (ev.grade === null && ev.assessed && !ev.needTarget.possible) {
        out.push({ code, severity: "warn", rank: 3,
                   detail: `target out of reach — best still open is ${ev.maxPossibleGrade}` });
      }
    }
    return out.sort((a, b) => a.rank - b.rank);
  });

  const need = () => goalRequirement();
  const short = () => {
    const n = need();
    if (!n || !n.possible || n.slack || n.required == null) return 0;
    return Math.max(0, n.required - summary().sgpaProjected);
  };

  return (
    <div class="screen home">
      <div class="screen-head">
        <div>
          <h2>Where you stand</h2>
          <p class="lede">
            {state.activeSemester} · {onRecord()} semester
            {onRecord() === 1 ? "" : "s"} on record
          </p>
        </div>
        <Show when={state.lastSync} fallback={
          <button class="ghost" onClick={() => setView("data")}>Get your marks in</button>
        }>
          <span class="fineprint num">
            Synced {new Date(state.lastSync!).toLocaleDateString()}
          </span>
        </Show>
      </div>

      <Show when={started()} fallback={<EmptyHome />}>
        <div class="bento">

          <section class="tile hero">
            <div class="tile-head">
              <h3>Standing</h3>
              <span class="tile-note num">{overall().credits} credits registered</span>
            </div>

            <div class="hero-figure">
              <div class="hero-number">
                <span class="huge num">{overall().cgpa.toFixed(2)}</span>
                <span class="hero-unit num">CGPA · {overall().percent.toFixed(1)}%</span>
              </div>
              <Show when={state.goal?.cgpa != null}>
                <GoalGauge projected={summary().sgpaProjected}
                           required={need()?.required ?? null}
                           reachable={need()?.possible ?? true}
                           assessed={summary().assessed > 0} />
              </Show>
            </div>

            <Show when={need()} fallback={
              <p class="tile-verdict dim">
                No target set. Set one and every number here re-reads as a route to it.
              </p>
            }>
              {(n) => (
                <p class="tile-verdict" classList={{ bad: !n().possible || short() > 0.005 }}>
                  <Show when={n().possible} fallback={<>Target is out of reach — {n().reason}.</>}>
                    <Show when={n().slack} fallback={
                      <>
                        {state.activeSemester} has to deliver{" "}
                        <strong class="num">{n().required!.toFixed(2)}</strong> SGPA.
                        You are projecting{" "}
                        <strong class="num">{summary().sgpaProjected.toFixed(2)}</strong>
                        <Show when={short() > 0.005}>
                          {" "}— short by <strong class="num">{short().toFixed(2)}</strong>
                        </Show>.
                      </>
                    }>
                      Already secured by your past semesters — anything above a pass holds it.
                    </Show>
                  </Show>
                </p>
              )}
            </Show>
          </section>

          <section class="tile" classList={{ flagged: attendanceCost().lost >= 1 }}>
            <div class="tile-head">
              <h3>Attendance is costing you marks</h3>
            </div>
            <Show when={attendanceCost().counted > 0} fallback={
              <p class="tile-verdict dim">
                No attendance recorded yet. It is worth up to {ATTENDANCE_MARK_MAX} CIE
                marks per subject, so it is the cheapest thing here to fix.
              </p>
            }>
              <div class="hero-number tight">
                <span class="huge num">{attendanceCost().lost.toFixed(0)}</span>
                <span class="hero-unit">
                  CIE marks lost across {attendanceCost().counted} subjects
                </span>
              </div>
              <p class="tile-verdict">
                <Show when={attendanceCost().cheapest} fallback={
                  <>Every subject is already in its top attendance band. Nothing to reclaim.</>
                }>
                  {(c) => (
                    <>
                      Cheapest to win back:{" "}
                      <strong class="num">{c().attend}</strong> classes in a row in{" "}
                      <strong>{c().code}</strong> buys{" "}
                      <strong class="num">{c().marks}</strong> mark
                      {c().marks === 1 ? "" : "s"}.
                    </>
                  )}
                </Show>
              </p>
            </Show>
          </section>

          <section class="tile">
            <div class="tile-head">
              <h3>Needs attention</h3>
              <Show when={concerns().length > 0}>
                <span class="tile-note num">{concerns().length}</span>
              </Show>
            </div>
            <Show when={concerns().length > 0} fallback={
              <p class="tile-verdict dim">
                Nothing at risk. Every subject is eligible and still on for its target.
              </p>
            }>
              <ul class="concerns">
                <For each={concerns().slice(0, 5)}>{(c) => (
                  <li>
                    <span class={`dot ${c.severity}`} aria-hidden="true"></span>
                    <b class="num">{c.code}</b>
                    <span>{c.detail}</span>
                  </li>
                )}</For>
              </ul>
              <Show when={concerns().length > 5}>
                <p class="fineprint">and {concerns().length - 5} more</p>
              </Show>
              <button class="ghost" onClick={() => setView("ledger")}>
                Open the semester
              </button>
            </Show>
          </section>

          <section class="tile">
            <div class="tile-head">
              <h3>{state.activeSemester}</h3>
              <span class="tile-note num">
                {summary().creditsConfirmed} of {summary().credits} cr settled
              </span>
            </div>
            <div class="split">
              <div>
                <span class="stat-label">Confirmed</span>
                <span class="stat num dim">{summary().sgpaConfirmed.toFixed(2)}</span>
              </div>
              <div>
                <span class="stat-label">Projected</span>
                <span class="stat num">{summary().sgpaProjected.toFixed(2)}</span>
              </div>
            </div>
            <p class="tile-verdict">
              <Show when={summary().credits > 0} fallback={
                <>No subjects in {state.activeSemester} yet.</>
              }>
              <Show when={summary().pending > 0} fallback={<>Every subject has been assessed.</>}>
                <strong class="num">{summary().pending}</strong> subject
                {summary().pending === 1 ? "" : "s"} not yet assessed — they are
                excluded from both numbers rather than counted as zero.
              </Show>
              </Show>
            </p>
          </section>

          <section class="tile trend">
            <div class="tile-head">
              <h3>Trend</h3>
              <button class="link" onClick={() => setView("history")}>History</button>
            </div>
            <TrendChart
              data={trend()}
              cgpa={overall().cgpa}
            />
          </section>

        </div>
      </Show>
    </div>
  );
}

/**
 * Nothing recorded yet.
 *
 * Deliberately not a zeroed-out dashboard. Showing 0.00 CGPA to a student who
 * has entered nothing is the same lie the engine refuses to tell about an
 * unassessed subject.
 */
function EmptyHome() {
  return (
    <div class="tile empty-home">
      <h3>Nothing recorded yet</h3>
      <p class="lede">
        TargetX has no marks to work from. The fastest route is your college
        portal — it brings attendance, internals and every past semester in one
        pass. A KTU grade card or a pasted table works just as well.
      </p>
      <div class="setup-actions wrap">
        <button class="primary" onClick={() => setView("data")}>Get your marks in</button>
        <button class="ghost" onClick={() => setView("ledger")}>Add subjects by hand</button>
      </div>
    </div>
  );
}
