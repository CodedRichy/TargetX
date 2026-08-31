import { For, Show } from "solid-js";
import type { SgpaPlan } from "../engine";

/**
 * One route to one SGPA target.
 *
 * Extracted from the Drawer so the same rendering serves both routes the app
 * can produce, and so it can be rendered by a test. It takes the plan and the
 * target as PROPS and reads no store: which target this route chases is the
 * caller's fact, and a component that looked it up itself could render one
 * target's route under the other's heading. `goalPlan` and
 * `semesterTargetPlan` are different routes to different numbers - see the
 * store's doc comments - and `target` printed in the header is what keeps
 * them apart on screen.
 *
 * `target` is also the only honest source for that figure: `planForSgpa`
 * omits `SgpaPlan.target` on the early return it takes when the target is
 * above everything still available, which is exactly the case that most needs
 * the number printed.
 */
export interface RouteProps {
  /** Heading. Names the route, not the target. */
  title: string;
  /** Whose target this is, in the student's words. Completes "Chasing X - ". */
  chasing: string;
  /** The SGPA `plan` was solved for. The caller planned with it. */
  target: number;
  plan: SgpaPlan;
}

/**
 * What a route quotes, what it guarantees, and what is still available above
 * it.
 *
 * The last of those is the part that did not exist before. `SgpaPlan.maxSgpa`
 * - the best SGPA still available with every subject at the best grade still
 * open to it - was carried by the engine and rendered nowhere, so a student
 * whose quoted route did not carry the target saw "not reachable" with no
 * number beside it and no second answer. `reachable: false` means "this route
 * does not guarantee it", not "nothing does"; where `maxSgpa` still covers
 * the target, this panel says so.
 */
export function RoutePanel(props: RouteProps) {
  const plan = () => props.plan;
  const rows = () => plan().plan;
  const bound = () => plan().bound ?? [];
  const unpriced = () => plan().unpriced ?? [];
  const max = () => plan().maxSgpa;

  /** The target is still inside what the semester can reach, by some route. */
  const stillOpen = () => {
    const m = max();
    return m !== undefined && m >= props.target - 1e-9;
  };

  /** Rows whose quoted mark buys its quoted grade only at the CIE ceiling. */
  const boundRows = () => rows().filter((r) => bound().includes(r.label));

  return (
    <div class="chart-block route-panel">
      <h4>{props.title}</h4>
      <p class="chart-note">
        Chasing <strong class="num">{props.target.toFixed(2)}</strong> SGPA — {props.chasing}.
      </p>

      <Show when={rows().length > 0}>
        {/* Keyed on `unpriced`, not on `conditional`: where the greedy ran out
            of rungs because a course cannot be priced at all, what is shown is
            the top of every ladder and "cheapest" is the wrong word for it. A
            route that is merely not GUARANTEED - the marks it quotes are
            floors priced off internals that have not settled - is still the
            cheapest one there is, and the caveat for it is the note below. */}
        <span class="stat-label">
          {unpriced().length > 0 ? "Best still on offer" : "Cheapest route"}
        </span>
        <dl style={{ margin: 0 }}>
          <For each={rows()}>{(row) => (
            <div class="field">
              <span class="num">{row.label}</span>
              <span>
                <strong style={{ color: "var(--brand-bright)" }}>{row.grade}</strong>
                <Show when={!row.locked}>
                  <Show when={row.eseMax > 0} fallback={
                    <span class="num" style={{ color: "var(--text-dim)" }}>
                      {" "}· from the internals alone
                    </span>
                  }>
                    <span class="num" style={{ color: "var(--text-dim)" }}>
                      {" "}· {row.cieUnknown ? "at least " : ""}{row.ese} in the exam
                    </span>
                  </Show>
                </Show>
                <Show when={row.cieUnknown}>
                  <span style={{ color: "var(--warn)" }}> · internals not settled yet</span>
                </Show>
                {/* `cieUnknown` above says the mark was priced off an internal
                    that can still rise; this says the rise is load-bearing.
                    The two are not the same row set - where a 40% exam minimum
                    binds at both ends of the internal, a rising CIE buys the
                    requirement down by nothing and the mark is exact - so the
                    warning colour belongs on this one. */}
                <Show when={bound().includes(row.label)}>
                  <span style={{ color: "var(--warn)" }}>
                    {" "}· {row.secured} on today's internal
                  </span>
                </Show>
              </span>
            </div>
          )}</For>
        </dl>
        <Show when={unpriced().length === 0}>
          <p class="chart-note">
            Balanced on the difficulty of each next grade, not on total marks -
            a plan demanding 60/60 in two papers is not a plan.
          </p>
        </Show>
      </Show>

      {/* What this route actually secures. `sgpaGuaranteed` and not `sgpa`:
          the point of the sentence is what survives the student doing exactly
          this and nothing else. Only shown where it is not the target - on a
          route that carries the target there is nothing to caveat. */}
      <Show when={!plan().reachable && plan().sgpaGuaranteed !== undefined}>
        <p class="chart-note" style={{ color: "var(--warn)" }}>
          Scoring exactly these marks and nothing else reaches{" "}
          <strong class="num">{plan().sgpaGuaranteed!.toFixed(2)}</strong>, not the{" "}
          <strong class="num">{props.target.toFixed(2)}</strong> you need.
        </p>
      </Show>

      {/* THE CEILING. `maxSgpa` is the second answer, and until now it was
          computed and thrown away: 47% of clean mid-semester plans come back
          `reachable: false`, and 95% of those students can still reach the
          target by a harder route than the one quoted. Shown only where the
          quoted route falls short, because on a route that carries the target
          the best still available is not a decision anybody has to make. */}
      <Show when={!plan().reachable && max() !== undefined}>
        <div class="ceiling">
          <span class="stat-label">Best still available</span>
          <span class="num ceiling-figure">{max()!.toFixed(2)}</span>
          <p class="chart-note">
            Every subject at the best grade still open to it.{" "}
            <Show when={stillOpen()} fallback={
              <>That is below <span class="num">{props.target.toFixed(2)}</span>, so no route
                reaches your target this semester — short by{" "}
                <strong class="num">{(props.target - max()!).toFixed(2)}</strong>.</>
            }>
              Your target sits inside that, so it is still reachable — just not
              by the route above.
            </Show>
          </p>
        </div>
      </Show>

      {/* What the harder route would cost, in the only terms the engine
          actually supplies: the courses whose quoted mark is priced off an
          internal that has to rise, and what each secures without that rise.
          No number is invented for how much further to go - the engine does
          not solve a second route and this panel will not pretend it did. */}
      <Show when={!plan().reachable && stillOpen() && boundRows().length > 0}>
        <p class="chart-note">
          The harder route runs through{" "}
          <For each={boundRows()}>{(row, i) => (
            <>
              <Show when={i() > 0}>, </Show>
              <span class="num">{row.label}</span> (quoted for {row.grade}, secures{" "}
              {row.secured} on today's internal)
            </>
          )}</For>
          : earn the attendance marks those quotes assume, or beat the quoted mark.
        </p>
      </Show>

      <Show when={!plan().reachable && stillOpen() && unpriced().length > 0}>
        <p class="chart-note">
          The rest rides on marks nobody has entered yet:{" "}
          <span class="num">{unpriced().join(", ")}</span> — no exam to sit, and the
          internal not settled.
        </p>
      </Show>

      <Show when={plan().reason}>
        {(reason) => <p class="chart-note">{reason()}</p>}
      </Show>
    </div>
  );
}
