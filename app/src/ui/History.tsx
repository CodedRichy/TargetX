import { For, Show, createMemo, createSignal } from "solid-js";
import { evaluate, sgpa as computeSgpa, GRADE_POINTS } from "../engine";
import { overall, setHistory, state, edit } from "../state/store";
import { TrendChart } from "./charts";

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
        // Recompute only from courses the university has actually graded.
        const graded = courses
          .map((c) => evaluate(c))
          .filter((ev) => ev.grade !== null)
          .map((ev) => [ev.credits, GRADE_POINTS[ev.grade!]] as [number, number]);
        const recomputed = graded.length ? computeSgpa(graded) : null;
        const credits = graded.reduce((sum, [c]) => sum + c, 0);

        // Only compare when the stored subjects account for the whole
        // semester. Recomputing an SGPA from four of a semester's seven
        // subjects always disagrees with the printed one, and reporting that
        // as a credit fault is crying wolf - the student would learn to
        // ignore the warning that matters.
        // Registered credits are what the stored subjects add up to, failures
        // included. Comparing against the earned total would call every
        // semester with a backlog incomplete.
        const registered = published?.creditsRegistered ?? null;
        const complete = registered !== null && registered > 0
          && Math.abs(credits - registered) < 0.01;
        const drift = complete && recomputed !== null
          ? Math.round((recomputed - published!.sgpa) * 1000) / 1000
          : null;

        return { name, published, registered, recomputed, credits, complete,
                 courses: courses.length, drift };
      });
  });

  const drifting = () => rows().filter((r) => r.drift !== null && Math.abs(r.drift) >= 0.01);

  /** Semesters carried over from a save that only knew the earned total. */
  const unconfirmed = () => overall().unconfirmed;

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
            {overall().percent.toFixed(1)}% · {overall().credits} credits
          </span>
        </div>
      </div>

      <div class="history-grid">
        <div>
          <table>
            <thead>
              <tr>
                <th class="left">Semester</th>
                <th>Published SGPA</th>
                <th>Registered credits</th>
                <th>Earned</th>
                <th>Recomputed</th>
                <th class="left">Cross-check</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>{(row) => <HistoryRow row={row} />}</For>
            </tbody>
          </table>

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
            data={Object.entries(state.history)
              .map(([name, v]) => ({ name, ...v }))
              .sort((a, b) => Number(a.name.slice(1)) - Number(b.name.slice(1)))}
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
  /** The published registered total, or null when no save ever held one. */
  registered: number | null;
  recomputed: number | null;
  credits: number;
  /** True when the stored subjects cover the whole published credit total. */
  complete: boolean;
  courses: number;
  drift: number | null;
}

function HistoryRow(props: { row: Row }) {
  const [sgpaDraft, setSgpaDraft] = createSignal(
    props.row.published ? String(props.row.published.sgpa) : "");
  const [creditDraft, setCreditDraft] = createSignal(
    props.row.registered === null ? "" : String(props.row.registered));

  const commit = () => {
    const sgpaValue = Number(sgpaDraft().trim());
    const creditValue = Number(creditDraft().trim());
    if (sgpaDraft().trim() === "") {
      edit((s) => { delete s.history[props.row.name]; });
      return;
    }
    if (!Number.isFinite(sgpaValue)) return;
    // A blank credit box is "I do not know yet", not zero - the CGPA falls
    // back to the earned total and says so rather than dividing by nothing.
    const credits = creditDraft().trim() === "" ? null : creditValue;
    if (credits !== null && !Number.isFinite(credits)) return;
    setHistory(props.row.name, sgpaValue, credits);
  };

  return (
    <tr class="row">
      <td class="left num code">{props.row.name}</td>
      <td>
        <input class="cell-input num" value={sgpaDraft()} placeholder="–"
               onInput={(e) => setSgpaDraft(e.currentTarget.value)} onBlur={commit} />
      </td>
      <td>
        <input class="cell-input num" value={creditDraft()} placeholder="–"
               onInput={(e) => setCreditDraft(e.currentTarget.value)} onBlur={commit} />
      </td>
      <td class="num">
        {props.row.published?.creditsEarned ?? "–"}
      </td>
      <td class="num">
        {props.row.recomputed === null ? "–" : props.row.recomputed.toFixed(2)}
      </td>
      <td class="left">
        <Show when={props.row.drift !== null} fallback={
          <span style={{ color: "var(--text-faint)" }}>
            <Show when={props.row.published} fallback={<>not recorded</>}>
              <Show when={props.row.registered !== null}
                    fallback={<>registered credits not recorded</>}>
                <Show when={props.row.recomputed !== null}
                      fallback={<>no graded subjects stored</>}>
                  partial record — {props.row.credits} of {props.row.registered} credits
                </Show>
              </Show>
            </Show>
          </span>
        }>
          <Show when={Math.abs(props.row.drift!) < 0.01} fallback={
            <span class="pill shortage num">
              off by {props.row.drift! > 0 ? "+" : ""}{props.row.drift!.toFixed(2)}
            </span>
          }>
            <span class="pill safe">reconciles</span>
          </Show>
        </Show>
      </td>
    </tr>
  );
}
