import { Index, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import {
  driftsFrom, evaluate, isGraded, sgpa as computeSgpa, unconfirmedNames,
  GRADE_POINTS,
} from "../engine";
import type { HistorySource, SemesterHistory } from "../engine";
import { overall, setHistory, state, edit, trend } from "../state/store";
import { TrendChart } from "./charts";

/**
 * How a source names itself to the student. The grade card is "KTU" because
 * that is the word a student uses for the university's own record; the college
 * portal is "portal" for the same reason. See `HistorySource`.
 */
/**
 * The range a published SGPA can occupy.
 *
 * KTU's highest grade point is S = 10 and its lowest is F = 0, so a weighted
 * average of them cannot leave 0..10. Anything outside it is a typo, and the
 * SGPA box had no bound at all: a sixteen-digit value pasted into it stored
 * happily and the CGPA in the header above read 646678418636100.75 over
 * "6466784186361014.0%". Smaller slips did the same quietly - "99" for "9.9"
 * gave a CGPA of 56.14, and a stray minus gave one below zero.
 *
 * Worse than the display: `setHistory` reads a changed SGPA as a deliberate
 * correction, tags it `manual`, and demotes the figure it replaced to a
 * conflict - so a mistyped digit outranks the grade card it overwrote on the
 * next sync, and the row goes on printing the real number as the loser.
 */
const SGPA_MIN = 0;
const SGPA_MAX = 10;

const SOURCE_LABEL: Record<HistorySource, string> = {
  gradecard: "KTU grade card",
  manual: "your entry",
  unknown: "an earlier sync",
  etlab: "the college portal",
};

/**
 * Past semesters.
 *
 * This screen did not exist and its absence was the reason the CGPA read 0.00
 * and the trend chart was empty. History is what the university published; the
 * semester grid is what is still in play. They are different kinds of fact and
 * get different screens.
 *
 * The cross-check is the point of it. TargetX recomputes each past semester
 * from the credits it holds and compares that against the printed SGPA. When
 * they disagree, a credit is wrong — and the student is told, rather than shown
 * a confident CGPA built on a bad number.
 */
export function History() {
  const rows = createMemo(() => {
    const names = new Set([
      ...Object.keys(state.history),
      ...Object.keys(state.semesters),
    ]);
    return Array.from(names)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .map((name) => {
        const published = state.history[name];
        const courses = state.semesters[name]?.courses ?? [];
        // Recompute only from courses the university has actually graded - a
        // withdrawn or incomplete one is published but carries no grade point.
        const graded: Array<[number, number]> = [];
        for (const course of courses) {
          const ev = evaluate(course);
          if (isGraded(ev.grade)) graded.push([ev.credits, GRADE_POINTS[ev.grade]]);
        }
        const recomputed = graded.length ? computeSgpa(graded) : null;
        const credits = graded.reduce((sum, [c]) => sum + c, 0);

        // Only compare when the stored subjects account for the whole
        // semester. Recomputing an SGPA from four of a semester's seven
        // subjects always disagrees with the printed one, and reporting that
        // as a credit fault is crying wolf - the student would learn to
        // ignore the warning that matters.
        // The two sides draw the I/W line in the same place, which is what
        // keeps a withdrawal from reading as a missing subject: `credits`
        // above sums only rows carrying a grade point, and both ingest paths
        // write `creditsRegistered` over the non-withdrawn rows - failures
        // kept, because an F is a result KTU counts, and I/W dropped, because
        // the printed SGPA was computed without them. Putting withdrawn rows
        // back into `credits` would report every semester containing a W as a
        // partial record. (The sides can still differ legitimately, and that
        // is the point of the check: an ungraded row is in the registered
        // total and not in `credits`, which is a semester only partly stored.)
        // Comparing against the earned total instead would call every
        // semester with a backlog incomplete.
        const registered = published?.creditsRegistered ?? null;
        const complete = registered !== null && registered > 0
          && Math.abs(credits - registered) < 0.01;
        // The raw difference, not a rounded one. Rounding here and comparing
        // afterwards is how this screen and the launch check came to disagree
        // about a difference in [0.0095, 0.01): one rounded it up over the
        // line and the other did not, so a student who followed the warning to
        // History found a semester marked as reconciling. `driftsFrom` is the
        // one rule now, and rounding is left to the rendering.
        const drift = complete && recomputed !== null
          ? recomputed - published!.sgpa
          : null;

        return { name, published, registered, recomputed, credits, complete,
                 courses: courses.length, drift };
      });
  });

  const drifting = () => rows().filter((r) => r.drift !== null
    && driftsFrom(r.recomputed!, r.published!.sgpa));

  /**
   * Semesters with no registered credit total: a save that only ever knew the
   * earned one, a sync that could not price every course from the curriculum
   * and refused to guess, or a credit box left blank.
   *
   * Split, because the consequence differs. `fellBack` is still in the CGPA
   * with a divisor that is too small; `droppedOut` knows neither total, weighs
   * zero, and is not in the CGPA at all.
   */
  const unconfirmed = () => overall().unconfirmed;
  const fellBack = () => unconfirmedNames(unconfirmed(), "earned");
  const droppedOut = () => unconfirmedNames(unconfirmed(), "none");

  return (
    <div class="screen">
      <div class="screen-head">
        <div>
          <h2>History</h2>
          <p class="lede">
            What the university published, semester by semester. These numbers
            drive your CGPA — TargetX never overwrites them with its own
            arithmetic, it only checks them against it.
          </p>
        </div>
        <div class="kpi">
          <span class="kpi-label">CGPA</span>
          <span class="kpi-value num">{overall().cgpa.toFixed(2)}</span>
          <span class="kpi-note num">
            {overall().percent.toFixed(1)}% · {overall().credits} registered credits
          </span>
        </div>
      </div>

      <div class="history-grid">
        <div>
          {/* Same wrapper the ledger has, for the same reason: seven columns of
              published figures do not fit a phone, and the honest fix is to let
              the TABLE slide under a still page rather than to let the page
              itself slide and carry the header and tab bar off screen with it. */}
          <div class="history-scroll">
            <table>
              <thead>
                <tr>
                  <th class="left" scope="col">Semester</th>
                  <th scope="col">Published SGPA</th>
                  <th scope="col">Registered credits</th>
                  <th scope="col">Earned</th>
                  <th scope="col">Recomputed</th>
                  <th class="left" scope="col">Cross-check</th>
                  {/* No visible label: the column holds one control per row and
                      each already names its own semester. A header word here
                      would be read out before every cell in the table. */}
                  <th scope="col"><span class="sr-only">Remove semester</span></th>
                </tr>
              </thead>
              <tbody>
                {/* `Index`, not `For`. `For` keys by object identity and every
                    recomputation of `rows()` builds fresh objects, so a commit
                    threw away and rebuilt every `tr` in the table - taking the
                    focused input with it. Measured before this change: from the
                    first SGPA box, Tab moved focus to the body and the next Tab
                    came back to the same box, so the credits column and every
                    row below the first were unreachable by keyboard at all.
                    `Index` keys by position and hands each row an accessor, so
                    the input the student is typing in is the same element
                    afterwards. */}
                <Index each={rows()}>{(row) => <HistoryRow row={row()} />}</Index>
              </tbody>
            </table>
          </div>

          <Show when={unconfirmed().length > 0}>
            <div class="notice">
              <strong>
                {unconfirmed().length === 1
                  ? `${unconfirmed()[0]!.name} has no registered credit total.`
                  : `${unconfirmed().length} semesters have no registered credit total.`}
              </strong> KTU divides the CGPA by the credits you registered for.
              A failed course still counts in the denominator; a course marked
              I or W does not — the university left it out of that semester's
              published SGPA, so it has to be left out of the credits that SGPA
              is multiplied by.{" "}
              <Show when={fellBack().length > 0}>
                {fellBack().join(", ")} {fellBack().length === 1 ? "is" : "are"} weighted
                by the earned total instead, which understates the divisor wherever
                there is a backlog.{" "}
              </Show>
              <Show when={droppedOut().length > 0}>
                <strong>
                  {droppedOut().join(", ")} {droppedOut().length === 1 ? "is" : "are"} not
                  in the CGPA above at all
                </strong> — neither total is known, so there is nothing to weigh
                {droppedOut().length === 1 ? " it" : " them"} by and no figure has been
                invented. The average you are reading is over the other semesters.{" "}
              </Show>
              Type the registered total — failures in, I and W out — into
              the Registered credits column
              {unconfirmed().length === 1
                ? "" : ` for ${unconfirmedNames(unconfirmed()).join(", ")}`} and
              the CGPA above becomes the one KTU would print.
            </div>
          </Show>

          <Show when={drifting().length > 0}>
            <div class="notice warn">
              <strong>
                {drifting().length === 1
                  ? "1 semester does not reconcile."
                  : `${drifting().length} semesters do not reconcile.`}
              </strong> Credits are never published per subject, only
              per semester, so TargetX infers them — and when the recomputed SGPA
              misses the printed one, an inferred credit is wrong. Your marks are
              fine; the credit column in that semester is not. Fixing it is what
              makes every projection downstream trustworthy.
            </div>
          </Show>
        </div>

        <aside>
          <h4>Trend</h4>
          <TrendChart
            data={trend()}
            cgpa={overall().cgpa}
          />
        </aside>
      </div>
    </div>
  );
}

interface Row {
  name: string;
  published: SemesterHistory | undefined;
  /** The stored registered total, or null when nothing has supplied one. */
  registered: number | null;
  recomputed: number | null;
  credits: number;
  /** True when the graded stored subjects add up to a non-zero registered total. */
  complete: boolean;
  courses: number;
  drift: number | null;
}

function HistoryRow(props: { row: Row }) {
  const storedSgpa = () => (props.row.published ? String(props.row.published.sgpa) : "");
  const storedCredits = () => (props.row.registered === null
    ? "" : String(props.row.registered));

  const [sgpaDraft, setSgpaDraft] = createSignal(storedSgpa());
  const [creditDraft, setCreditDraft] = createSignal(storedCredits());

  /**
   * Put both boxes back to what is stored when this row becomes a DIFFERENT
   * semester.
   *
   * `Index` keys a row by position, which is what keeps the focused input
   * alive across a store write (see the note at the `Index` above) - and the
   * same property means that when a semester is removed the row beneath it is
   * not destroyed. It is handed the next semester's data while still holding
   * the drafts it was created with. Measured: with S1 (9.00 / 20) and S2
   * (5.00 / 22) published, removing S2 left the S4 row's boxes reading "5"
   * and "22", and merely focusing and blurring one of them called
   * `setHistory("S4", 5, 22)` - inventing a grade card the university never
   * published, for the wrong semester, out of the figures the student had
   * just deleted. The CGPA moved 9.00 -> 6.91 with nothing typed.
   *
   * `on` with the name ALONE is what makes this safe to add. The body reads
   * `published` and `registered` untracked, so an ordinary store write cannot
   * re-run it and throw away what a student is halfway through typing - which
   * is precisely the failure `For` caused and the reason `Index` is here.
   * `defer`, because the signals above already hold this row's own values.
   */
  createEffect(on(() => props.row.name, () => {
    setSgpaDraft(storedSgpa());
    setCreditDraft(storedCredits());
  }, { defer: true }));

  /**
   * Removal is two presses, and deliberately not a modal.
   *
   * The first press turns the control into the confirmation, in the row being
   * removed, so what is about to be discarded is on screen beside the question
   * rather than described in a dialog covering it.
   */
  const [confirming, setConfirming] = createSignal(false);

  const commit = () => {
    const sgpaValue = Number(sgpaDraft().trim());
    const creditValue = Number(creditDraft().trim());
    if (sgpaDraft().trim() === "") {
      // Nothing stored and nothing typed: a blur that writes an identical
      // store is still a store write, and every write re-runs the memo this
      // table is built from. Tabbing across a row must cost nothing.
      if (!props.row.published) return;
      // An empty box means "I do not know this", never "destroy the record".
      //
      // Clearing it used to delete the entire SemesterHistory - the SGPA, both
      // credit totals, the source and the recorded conflict - with no
      // confirmation and no undo, on blur. Select-all, Backspace, Tab was
      // enough, and the CGPA in the header silently dropped. That is the most
      // destructive action in the app, and it was the only one with no guard,
      // while erasing everything two screens away has a two-step confirmation.
      //
      // Removing a semester is now a deliberate act with its own control. A
      // blur just puts back what is stored, so the box cannot be used to
      // discard a figure the university published.
      setSgpaDraft(String(props.row.published.sgpa));
      return;
    }
    // Anything that is not a figure KTU could have printed goes back to what
    // is stored, rather than being written OR left sitting in the box.
    //
    // Left in the box was the old behaviour for text: "abc" failed
    // `Number.isFinite`, the store was correctly untouched, and the box then
    // went on showing "abc" indefinitely with nothing said - so the one
    // student who most needed telling had every reason to believe their
    // correction had been recorded. The blank box already restores. These now
    // agree, and the bound above catches the typo that used to store.
    if (!Number.isFinite(sgpaValue) || sgpaValue < SGPA_MIN || sgpaValue > SGPA_MAX) {
      setSgpaDraft(storedSgpa());
      return;
    }
    // A blank credit box is "I do not know yet", not zero - the CGPA falls
    // back to the earned total and says so rather than dividing by nothing.
    const credits = creditDraft().trim() === "" ? null : creditValue;
    // Zero is neither. `historyCredits` reads `creditsRegistered ?? ...`, so a
    // stored 0 is not nullish, wins over the earned total, and drops the
    // semester out of the CGPA completely - while `unconfirmedSemesters`
    // looks only for a MISSING total, so the notice that exists to say a
    // semester is not in the average never fires. Measured: typing 0 into S2
    // took the header from 6.91 to 9.00 with no notice anywhere on screen and
    // the row still reading as if it counted. A negative did the same in
    // reverse, printing a CGPA of 10.33 - above the maximum KTU awards.
    if (credits !== null && (!Number.isFinite(credits) || credits <= 0)) {
      setCreditDraft(storedCredits());
      return;
    }
    // Same reason: a blur off an untouched box used to rewrite the semester
    // with the values it already had.
    if (props.row.published?.sgpa === sgpaValue
        && props.row.registered === credits) return;
    setHistory(props.row.name, sgpaValue, credits);
  };

  return (
    <tr class="row">
      {/* `scope="row"` so the semester name is what a screen reader quotes
          when it reads a cell out of this table, and an `aria-label` on each
          box naming the same semester - a column header names a cell, never
          the control inside it, so both boxes on every row announced as bare
          "edit text". */}
      <th class="left num code" scope="row" data-col="name">{props.row.name}</th>
      <td data-col="sgpa" data-label="Published SGPA">
        {/* `inputmode` for the same reason it is on the ledger cells: a grade
            card is digits, and a phone should offer digits. Not `type="number"`,
            which would blank the draft the moment it disliked a keystroke. */}
        <input class="cell-input num" value={sgpaDraft()} placeholder="–"
               inputmode="decimal"
               aria-label={`Published SGPA for ${props.row.name}`}
               onInput={(e) => setSgpaDraft(e.currentTarget.value)} onBlur={commit} />
      </td>
      <td data-col="credits" data-label="Registered credits">
        <input class="cell-input num" value={creditDraft()} placeholder="–"
               inputmode="numeric"
               aria-label={`Registered credits for ${props.row.name}`}
               onInput={(e) => setCreditDraft(e.currentTarget.value)} onBlur={commit} />
      </td>
      <td class="num" data-col="earned" data-label="Earned">
        {props.row.published?.creditsEarned ?? "–"}
      </td>
      <td class="num" data-col="recomputed" data-label="Recomputed">
        {props.row.recomputed === null ? "–" : props.row.recomputed.toFixed(2)}
      </td>
      <td class="left" data-col="check" data-label="Cross-check">
        <Show when={props.row.drift !== null} fallback={
          <span style={{ color: "var(--text-faint)" }}>
            <Show when={props.row.published} fallback={<>not recorded</>}>
              <Show when={props.row.registered !== null}
                    fallback={<>registered credits not recorded</>}>
                <Show when={props.row.recomputed !== null}
                      fallback={<>no graded subjects stored</>}>
                  partial record — {props.row.credits} of {props.row.registered} credits
                  {/* The two figures disagree, the columns print them side by
                      side, the column is headed "Cross-check", and the lede
                      promises this screen checks one against the other - and
                      then nothing said why they differ. Measured on the seed:
                      published 6.71 beside a recomputed 7.62 explained only
                      as "13 of 24 credits"; with a single 2-credit lab stored
                      of a 24-credit semester, 4.50 beside 8.50. A student
                      reads that as TargetX calling their grade card wrong.
                      The `drifting()` notice stays suppressed for a partial
                      record - firing it would cry wolf on arithmetic that was
                      never comparable - so the row has to say so itself. */}
                  <Show when={props.row.recomputed !== null
                              && driftsFrom(props.row.recomputed,
                                            props.row.published!.sgpa)}>
                    {/* The cell inherits `white-space: nowrap` - right for a
                        one-line pill, fatal for a sentence: measured at 411px
                        it ran 58px past the screen edge with nothing above it
                        clipping, and 149px past at 320px. Inline, because the
                        rule belongs in `.source-conflict` in screens.css and
                        that file is not mine to edit. */}
                    <span class="source-conflict" style={{ "white-space": "normal" }}>
                      Recomputed from part of the semester, so{" "}
                      <span class="num">{props.row.recomputed!.toFixed(2)}</span> is not
                      a second opinion on{" "}
                      <strong class="num">{props.row.published!.sgpa.toFixed(2)}</strong>.
                      Enter the rest of the subjects to compare them.
                    </span>
                  </Show>
                </Show>
              </Show>
            </Show>
          </span>
        }>
          <Show when={!driftsFrom(props.row.recomputed!, props.row.published!.sgpa)} fallback={
            <span class="pill shortage num">
              off by {props.row.drift! > 0 ? "+" : ""}{props.row.drift!.toFixed(2)}
            </span>
          }>
            <span class="pill safe">reconciles</span>
          </Show>
        </Show>
        {/* Two sources named a different SGPA for this semester. The trusted
            one is what the row shows; the disagreement is stated rather than
            dropped, so a student can see the portal was wrong instead of
            wondering why the number moved. #5. */}
        <Show when={props.row.published?.conflict}>
          {/* The `white-space` below answers the same inherited `nowrap` the
              partial-record sentence does. This branch is in no seed, so it
              has never been measured on a phone - two source labels and two
              figures on one unwrappable line would leave the screen. */}
          {(c) => (
            <span class="source-conflict" style={{ "white-space": "normal" }}>
              {SOURCE_LABEL[props.row.published!.source]}{" "}
              <strong class="num">{props.row.published!.sgpa.toFixed(2)}</strong>
              {" · "}{SOURCE_LABEL[c().source]} said{" "}
              <span class="num">{c().sgpa.toFixed(2)}</span>
            </span>
          )}
        </Show>
      </td>
      <td class="row-remove">
        {/* Only offered where there is something to remove. An empty row has
            nothing to discard and the control would be a no-op wearing a
            destructive label. */}
        <Show when={props.row.published}>
          <Show when={confirming()} fallback={
            <button class="link" aria-label={`Remove ${props.row.name} from history`}
                    onClick={() => setConfirming(true)}>Remove</button>
          }>
            <span class="confirm-inline" role="group"
                  aria-label={`Remove ${props.row.name}?`}>
              {/* Names the figure being discarded, not just the semester. The
                  SGPA is the thing that took a semester to earn and the thing
                  the CGPA above will move without. */}
              <span class="fineprint">
                Discard {props.row.name} (
                <span class="num">{props.row.published!.sgpa.toFixed(2)}</span>)?
              </span>
              <button class="link remove-go" onClick={() => {
                edit((s) => { delete s.history[props.row.name]; });
                // The boxes still hold the figures just discarded, and this
                // row SURVIVES the removal whenever the semester is also in
                // the ledger - the name is unchanged, so the reset effect
                // above does not fire for it. Without this, the next blur
                // anywhere in the row put the removed record straight back:
                // measured on the seed, removing S4 left "6.71" and "24" in
                // the boxes of a row now reading "not recorded".
                setSgpaDraft("");
                setCreditDraft("");
                setConfirming(false);
              }}>Remove</button>
              <button class="link" onClick={() => setConfirming(false)}>Keep</button>
            </span>
          </Show>
        </Show>
      </td>
    </tr>
  );
}
