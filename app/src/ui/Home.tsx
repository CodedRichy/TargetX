import { For, Show, createMemo } from "solid-js";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_FULL_MARKS_PCT, ATTENDANCE_MARK_MAX,
  ATTENDANCE_MIN, attendanceMarks, courseLabel, isDebarred, isIncomplete,
  toOptionalFloat,
  unconfirmedNames,
} from "../engine";
import {
  dismissChanges, goalRequirement, overall, rows, state, summary, trend,
} from "../state/store";
import { setView } from "../state/nav";
import { GoalGauge, TrendChart } from "./charts";
import type { Change } from "../engine";

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

/**
 * Attendance marks forfeited by a student sitting exactly on the eligibility
 * line, out of `ATTENDANCE_MARK_MAX`.
 *
 * Derived from the bands, never pasted: this number is the entire argument for
 * why the app defaults its target to `ATTENDANCE_FULL_MARKS_PCT` rather than
 * `ATTENDANCE_MIN`, and a stale literal here would be the app teaching a wrong
 * rule with total confidence. `attendanceMarks` returns null only for an
 * unparseable input, and `ATTENDANCE_MIN` is a number.
 */
const FORFEIT_AT_ELIGIBILITY =
  ATTENDANCE_MARK_MAX - (attendanceMarks(ATTENDANCE_MIN) ?? 0);

/** A subject worth surfacing, with the reason it made the list. */
interface Concern {
  /** The subject as the student knows it. See `courseLabel`. */
  label: string;
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
    // A semester with no subjects in it is not a semester on record. Setup
    // creates the current one before anything is in it, so a student who had
    // just finished onboarding was told "1 semester on record" while looking
    // at an empty screen - the app opening with a claim it could not support,
    // which is the one thing it is supposed never to do.
    ...Object.entries(state.semesters)
      .filter(([, sem]) => (sem?.courses.length ?? 0) > 0)
      .map(([name]) => name),
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
    let cheapest: { label: string; attend: number; marks: number } | null = null;
    // Subjects a student would call fine: past the eligibility line, short of
    // the line where attendance stops costing marks. The whole point of the
    // sentence this feeds is that nothing else in a student's life flags
    // them - the portal shows a green 78% and says nothing about R 7.5.ii.
    let blindSpot = 0;
    let priced = 0;

    for (const row of rows()) {
      const ev = row.ev;
      if (ev.attMarks === null) continue;
      counted += 1;
      lost += ATTENDANCE_MARK_MAX - ev.attMarks;

      const pct = ev.attendance;
      if (pct !== null && pct >= ATTENDANCE_MIN && pct < ATTENDANCE_FULL_MARKS_PCT) {
        blindSpot += 1;
      }

      // Whether this subject's next band can be PRICED at all. Climbing one
      // is counted in classes, and a student who typed a bare percentage
      // instead of attended/held has given the app no classes to count.
      if (toOptionalFloat(row.course.held) !== null) priced += 1;

      const band = ev.attBand;
      if (!band || band.nextMarks === null || band.attend <= 0) continue;
      if (!cheapest || band.attend < cheapest.attend) {
        cheapest = {
          label: courseLabel(row.course),
          attend: band.attend,
          marks: band.nextMarks - band.earned,
        };
      }
    }
    return { lost: Math.round(lost * 10) / 10, counted, cheapest, blindSpot, priced };
  });

  /** Everything breakable, ordered by how bad it is rather than by code. */
  const concerns = createMemo<Concern[]>(() => {
    const out: Concern[] = [];
    for (const row of rows()) {
      const ev = row.ev;
      const label = courseLabel(row.course);

      // Withdrawn or incomplete: nothing below applies to a course the
      // student is not sitting, least of all an attendance shortage that
      // would warn them off an exam that is no longer theirs.
      if (isIncomplete(ev.grade)) continue;

      if (ev.grade === "F") {
        out.push({ label, severity: "bad", rank: 0,
                   detail: "failed — needs a supplementary attempt" });
      } else if (ev.grade === null && !ev.needPassBest.possible) {
        // Ahead of the attendance clause, and with no `assessed` gate, so this
        // chain reaches the same verdict `statusFor` does on the same course.
        // Below the attendance clause it did not: a lab that cannot be passed
        // whatever happens next was described here as merely waiting on an
        // attendance figure, while its ledger row said UNREACHABLE and the
        // header pill counted it. The certainty comes from the branch
        // condition - `cieCeiling` plus a whole paper is under the pass mark -
        // so no missing field can rescue it and none needs waiting for.
        //
        // The best-case figure rather than `needPass.possible`: the latter is
        // solved against the floor, so it calls a pass impossible for a course
        // that simply has marks still to come. Telling a student their pass is
        // gone over an unwritten series exam is the worst false alarm this
        // screen could raise.
        out.push({ label, severity: "bad", rank: 1,
                   detail: "a pass is no longer reachable from the internals" });
      } else if (ev.grade === null && ev.cieIncomplete && ev.assessed) {
        // Attendance is not recorded, so the internal is short of its R 7.5.ii
        // component and every figure below it would be priced off a floor.
        // That is one field the student can fill in themselves, which is why
        // it is listed - a course whose only gap is an unmarked series exam is
        // deliberately NOT listed here: there is nothing they can do about it,
        // and a concern nobody can act on is noise. The semester tile counts
        // those instead. When both are missing the attendance field is still
        // the actionable half, but it is not the whole story and the detail
        // must not imply that filling it in settles the internal.
        out.push({ label, severity: "warn", rank: 2,
                   detail: ev.cieUnmarked
                     ? "attendance not recorded and a component still unmarked "
                       + "— its internal is incomplete, so no grade is being read off it"
                     : "attendance not recorded — its internal is incomplete, "
                       + "so no grade is being read off it" });
      } else if (isDebarred(ev)) {
        // Below the condonation floor there is no route back. R 6.2 allows
        // condonation from 60% up; under it the exam is gone for the semester
        // however many classes are left. Telling this student "N classes in a
        // row to be eligible" is not encouragement, it is a wrong instruction
        // they will follow. `Ledger.tsx` already draws this line; Home did not.
        out.push({ label, severity: "bad", rank: 1,
                   detail: `below the ${ATTENDANCE_CONDONE}% condonation floor `
                     + "— the exam cannot be sat this semester, and attending "
                     + "from here does not change that" });
      } else if (ev.eligible === false) {
        const plan = ev.plan;
        out.push({ label, severity: "warn", rank: 2,
                   detail: plan?.attend
                     ? `below ${ATTENDANCE_MIN}% — ${plan.attend} classes in a row to be eligible`
                     : `below ${ATTENDANCE_MIN}% — not eligible to sit the exam` });
      } else if (ev.grade === null && ev.assessed && !ev.needTargetBest.possible) {
        out.push({ label, severity: "warn", rank: 3,
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

  /** The last semester the goal is solved over; the active one without a horizon. */
  const lastSemester = () =>
    `S${Number(state.activeSemester.slice(1)) + (need()?.horizon.semesters ?? 0)}`;

  /**
   * What the goal line is taking on trust, in one sentence or none.
   *
   * The required average is spread over a horizon TargetX inferred from past
   * semesters, and where a migrated save never knew a semester's registered
   * credits the CGPA it is solved against is itself a best effort. Both are
   * the same kind of caveat, so they share a line rather than competing for
   * the reader's attention with two separate warnings.
   */
  const assumption = () => {
    const n = need();
    if (!n) return null;
    const clauses: string[] = [];
    if (n.horizon.semesters > 0) {
      const first = `S${Number(state.activeSemester.slice(1)) + 1}`;
      const span = n.horizon.semesters === 1 ? first : `${first}–${lastSemester()}`;
      clauses.push(`${span} carry ${n.horizon.credits} credits`);
    }
    // Two different things happen to a semester with no registered total and
    // they need two different sentences. Where the earned total stood in, the
    // semester is still in the CGPA and only its divisor is off. Where neither
    // total is known it is not in the CGPA at all, and calling that "weighted
    // by credits earned" - which is what this line said until the engine told
    // the two apart - names a fallback that did not happen while hiding the
    // one that did.
    const fellBack = unconfirmedNames(n.unconfirmed, "earned");
    const droppedOut = unconfirmedNames(n.unconfirmed, "none");
    if (fellBack.length > 0) {
      clauses.push(`${fellBack.join(", ")} ${fellBack.length === 1 ? "is" : "are"}`
        + " weighted by credits earned rather than registered");
    }
    if (droppedOut.length > 0) {
      clauses.push(`${droppedOut.join(", ")} ${droppedOut.length === 1 ? "is" : "are"}`
        + " left out of the CGPA entirely, with neither credit total known");
    }
    return clauses.length > 0 ? `Assumes ${clauses.join(", and ")}.` : null;
  };

  // The pointer-tracked light that plays across these tiles is wired once for
  // the whole app - a single delegated `pointermove` in `App`'s `onMount` feeds
  // every card-like surface, tiles included, so nothing is wired here.

  return (
    <div class="screen home">
      <div class="screen-head">
        <div>
          <h2>Where you stand</h2>
          {/* With nothing on record the count is not "0 semesters", it is
              absent. A zero here is a fact about the record; the student has
              not made one yet, and the empty state below already says so in
              words that lead somewhere. */}
          {/* No lede at all when the record is empty. It said "nothing
              recorded yet" directly above a card whose heading is "Nothing
              recorded yet", which is the same sentence twice in one eyeful and
              makes the screen read as an error rather than as a start. */}
          <Show when={onRecord() > 0}>
            <p class="lede">
              {state.activeSemester} · {onRecord()} semester
              {onRecord() === 1 ? "" : "s"} on record
            </p>
          </Show>
        </div>
        {/* The header action is for a student who HAS data and wants more of
            it. With an empty record the card below carries the same call, and
            two identical primary buttons on one screen is a choice the student
            has to make between two things that do the same thing. */}
        <Show when={state.lastSync || onRecord() > 0}>
        <Show when={state.lastSync} fallback={
          <button class="ghost" onClick={() => setView("data")}>Get your marks in</button>
        }>
          <span class="fineprint num">
            Synced {new Date(state.lastSync!).toLocaleDateString()}
          </span>
        </Show>
        </Show>
      </div>

      <Show when={state.changes}>
        {(c) => <ChangesPanel at={c().at} items={c().items} />}
      </Show>

      <Show when={started()} fallback={<EmptyHome />}>
        <div class="bento">

          {/* The one promoted surface on Home. Standing is what the screen is
              for; everything else on it explains or qualifies this number. */}
          <section class="tile hero promoted">
            <div class="tile-head">
              <h3>Standing</h3>
              {/* Registered credits are the denominator - except where a
                  migrated save only knew the earned total, and saying
                  "registered" there would assert something untrue on the
                  first screen the student reads. A semester with NEITHER total
                  is not in this figure at all, which is a stronger caveat than
                  "unconfirmed" and gets its own words. History explains both. */}
              <span class="tile-note num">
                <Show when={overall().unconfirmed.length === 0}
                      fallback={
                        <Show when={unconfirmedNames(overall().unconfirmed, "none").length > 0}
                              fallback={<>{overall().credits} credits, some unconfirmed</>}>
                          {overall().credits} credits, and{" "}
                          {unconfirmedNames(overall().unconfirmed, "none").length} semester
                          {unconfirmedNames(overall().unconfirmed, "none").length === 1 ? "" : "s"}
                          {" "}not counted
                        </Show>
                      }>
                  {overall().credits} credits registered
                </Show>
              </span>
            </div>

            <div class="hero-figure">
              {/* No past semester means no CGPA, not a CGPA of zero. A first
                  year reading 0.00 on the largest number on the screen is
                  being told they have failed everything, on the day they
                  installed it. A dash says the same thing as the empty state
                  three lines up, which is the discipline this app applies to
                  every other unknown. */}
              <div class="hero-number">
                <Show when={overall().credits > 0} fallback={
                  <>
                    <span class="huge num dim">–</span>
                    <span class="hero-unit">no completed semester yet</span>
                  </>
                }>
                  <span class="huge num">{overall().cgpa.toFixed(2)}</span>
                  <span class="hero-unit num">CGPA · {overall().percent.toFixed(1)}%</span>
                </Show>
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
              {/* Missing data is not an unreachable target. `insufficient`
                  keeps the red for the case that has actually gone wrong. */}
              {(n) => (
                <p class="tile-verdict"
                   classList={{ bad: (!n().possible && !n().insufficient) || short() > 0.005,
                                dim: n().insufficient }}>
                  <Show when={n().possible} fallback={
                    <Show when={n().insufficient}
                          fallback={<>Target is out of reach — {n().reason}.</>}>
                      Add this semester's subjects and their credits, and this
                      turns into the SGPA that gets you there.
                    </Show>
                  }>
                    <Show when={n().slack} fallback={
                      <>
                        {/* A CGPA target is a graduation target: with
                            semesters still to come the figure is an average
                            to hold, not a bill due in December. */}
                        <Show when={n().horizon.semesters > 0} fallback={
                          <>{state.activeSemester} has to deliver{" "}</>
                        }>
                          {state.activeSemester} through {lastSemester()} have to average{" "}
                        </Show>
                        <strong class="num">{n().required!.toFixed(2)}</strong> SGPA.
                        You are projecting{" "}
                        <strong class="num">{summary().sgpaProjected.toFixed(2)}</strong>
                        {" "}in {state.activeSemester}
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
            <Show when={assumption()}>
              {(text) => <p class="fineprint">{text()}</p>}
            </Show>
          </section>

          <section class="tile" classList={{ flagged: attendanceCost().lost >= 1 }}>
            <div class="tile-head">
              <h3>Attendance is costing you marks</h3>
            </div>
            <Show when={attendanceCost().counted > 0} fallback={
              <p class="tile-verdict dim">
                No attendance recorded yet. It is worth up to {ATTENDANCE_MARK_MAX} CIE
                marks per subject, and all {ATTENDANCE_MARK_MAX} need{" "}
                {ATTENDANCE_FULL_MARKS_PCT}%, not the {ATTENDANCE_MIN}% you are told
                about — so it is the cheapest thing here to fix.
              </p>
            }>
              <div class="hero-number tight">
                <span class="huge num">{attendanceCost().lost.toFixed(0)}</span>
                <span class="hero-unit">
                  CIE marks lost across {attendanceCost().counted} subjects
                </span>
              </div>
              <Show when={attendanceCost().blindSpot > 0}>
                <p class="tile-verdict">
                  <strong class="num">{attendanceCost().blindSpot}</strong> of them are
                  above {ATTENDANCE_MIN}% and losing marks anyway. Full marks start at{" "}
                  <strong class="num">{ATTENDANCE_FULL_MARKS_PCT}%</strong> — sitting on{" "}
                  {ATTENDANCE_MIN}% forfeits{" "}
                  <span class="unit">
                    <strong class="num">{FORFEIT_AT_ELIGIBILITY}</strong> of{" "}
                    {ATTENDANCE_MARK_MAX}
                  </span>, and nothing else will tell you.
                </p>
              </Show>
              <p class="tile-verdict">
                {/* Three different reasons there is nothing to offer, and the
                    tile used to give the flattering one for all of them: it
                    said "nothing to reclaim" directly under a count of marks
                    already lost. Marks lost with no route back is the common
                    case for a student who typed a bare percentage, because a
                    band is climbed in CLASSES and a percentage carries none. */}
                <Show when={attendanceCost().cheapest} fallback={
                  <Show when={attendanceCost().lost > 0} fallback={
                    <>Every subject is already in its top attendance band.
                      Nothing to reclaim.</>
                  }>
                    <Show when={attendanceCost().priced > 0} fallback={
                      <>
                        Those marks cannot be won back until TargetX knows the
                        classes. Enter attended and held in the Semester table
                        — a bare percentage says where you are and not how far
                        a class moves it.
                      </>
                    }>
                      No subject can climb a band with the classes that are
                      left. The marks already lost stay lost; what is left to
                      protect is the ones still in reach.
                    </Show>
                  </Show>
                }>
                  {(c) => (
                    <>
                      Cheapest to win back:{" "}
                      <strong class="num">{c().attend}</strong> classes in a row in{" "}
                      <strong>{c().label}</strong> buys{" "}
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
                    <b>{c.label}</b>
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

          <section class="tile now">
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
              <Show when={summary().pending > 0 || summary().unsettled > 0}
                    fallback={<>Every subject has been assessed.</>}>
                <Show when={summary().pending > 0}>
                  <strong class="num">{summary().pending}</strong> subject
                  {summary().pending === 1 ? "" : "s"} not yet assessed — out of
                  Confirmed entirely, and in Projected at what each can still
                  reach.{" "}
                </Show>
                <Show when={summary().unsettled > 0}>
                  <strong class="num">{summary().unsettled}</strong> subject
                  {summary().unsettled === 1 ? " has" : "s have"} an internal that
                  is not settled — a component mark or the attendance is still
                  missing, so no grade is being read off it yet.
                </Show>
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
 * What the last sync moved.
 *
 * A sync replaces the whole record silently; this is the one place that says
 * what was new about it. Shown from the second sync on (a first has nothing to
 * compare against), and dismissible - once a student has read that a grade
 * posted, the news has been delivered and a permanent banner would just be
 * clutter they learn to scroll past.
 *
 * An EMPTY batch is still shown, briefly stated: "synced, nothing moved" is a
 * real answer to "did anything change", and the silence of no panel at all
 * leaves the student wondering whether the sync even ran.
 */
const CHANGE_ORDER: Record<Change["kind"], number> = {
  grade: 0, sgpa: 1, attendance: 2, series: 3,
};
const CHANGE_CAP = 8;

function ChangesPanel(props: { at: string; items: Change[] }) {
  const sorted = () => [...props.items].sort(
    (a, b) => CHANGE_ORDER[a.kind] - CHANGE_ORDER[b.kind]);
  const when = () => new Date(props.at).toLocaleDateString();

  return (
    <section class="changes" classList={{ quiet: props.items.length === 0 }}>
      <div class="changes-head">
        <h3>
          <Show when={props.items.length > 0}
                fallback={<>Synced {when()} — nothing had moved</>}>
            What changed since your last sync
          </Show>
        </h3>
        <button class="link" onClick={() => dismissChanges()}>Dismiss</button>
      </div>
      <Show when={props.items.length > 0}>
        <ul class="change-list">
          <For each={sorted().slice(0, CHANGE_CAP)}>{(c) => (
            <li>
              <span class={`chip ${c.kind}`}>{c.field}</span>
              <b>{c.course}</b>
              <span class="num">
                <Show when={c.before !== null}
                      fallback={<>posted <strong>{c.after}</strong></>}>
                  {c.before} <span class="arrow" aria-label="changed to">-&gt;</span>{" "}
                  <strong>{c.after}</strong>
                </Show>
              </span>
            </li>
          )}</For>
        </ul>
        <Show when={props.items.length > CHANGE_CAP}>
          <p class="fineprint">and {props.items.length - CHANGE_CAP} more</p>
        </Show>
      </Show>
    </section>
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
      {/* "Nothing recorded yet" as a heading describes the app's problem. This
          describes the student's next move, which is the only thing an empty
          state is for. */}
      <h3>Get your marks in</h3>
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
