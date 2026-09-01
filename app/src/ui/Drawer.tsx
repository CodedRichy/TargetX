import { For, Show, createSignal } from "solid-js";
import { goalRequirement, rows, summary } from "../state/store";
import { AttendanceScatter, GoalGauge } from "./charts";
import { TargetsTab } from "./Targets";
import { TERMS } from "../state/glossary";

/**
 * Column glossary.
 *
 * A student who does not know what ESE means cannot use a column called ESE,
 * and the old build hid this behind a modal - so the explanation and the thing
 * being explained were never on screen together. It lives in the drawer now
 * and stays open while the table is read.
 *
 * The text comes from `state/glossary`, which is also what the ask box answers
 * definitions from. It used to be a second copy here with every figure written
 * out by hand - "85% earns 5, then 4, 3, 2, 1 down to 60%", "at most 10% of
 * classes held" - in the one panel whose entire job is teaching the rules, with
 * nothing failing if the regulation moved under it.
 */


export function Drawer() {
  const [tab, setTab] = createSignal<"analytics" | "targets" | "legend">("analytics");

  const scatter = () => rows()
    // Attendance is the X axis, so a subject with none on record has no point
    // to plot - not a point sitting at 0% or 100%.
    .filter((r) => r.ev.assessed && r.course.code && r.ev.attendance !== null)
    .map((r) => ({
      code: r.course.code!, attendance: r.ev.attendance!,
      cie: r.ev.cie, cieMax: r.ev.cieMax,
    }));

  const lit = (which: string) => (tab() === which
    ? { color: "var(--brand-bright)", "border-color": "var(--brand-deep)" }
    : {});

  return (
    // Named so it is reachable as a landmark: an unnamed `aside` is announced
    // as "complementary" with no clue that this is where the charts and the
    // column glossary live.
    <aside class="drawer" aria-label="Analytics, targets and column glossary"
           classList={{ wide: tab() === "targets" }}>
      <div class="drawer-tabs" role="group" aria-label="Drawer panel">
        <button class="icon-btn" aria-pressed={tab() === "analytics"}
                style={lit("analytics")}
                onClick={() => setTab("analytics")}>Analytics</button>
        <button class="icon-btn" aria-pressed={tab() === "targets"}
                style={lit("targets")}
                onClick={() => setTab("targets")}>Targets</button>
        <button class="icon-btn" aria-pressed={tab() === "legend"}
                style={lit("legend")}
                onClick={() => setTab("legend")}>What the columns mean</button>
      </div>

      <Show when={tab() === "targets"}><TargetsTab /></Show>

      <Show when={tab() === "analytics"} fallback={
        <Show when={tab() === "legend"}>
        <dl>
          <For each={TERMS}>{(term) => (
            <><dt>{term.name}</dt><dd>{term.body}</dd></>
          )}</For>
        </dl>
        </Show>
      }>
        <div class="chart-block">
          <h4>Goal</h4>
          <GoalGauge
            projected={summary().sgpaProjected}
            required={goalRequirement()?.required ?? null}
            reachable={goalRequirement()?.possible ?? true}
            assessed={summary().assessed > 0}
          />
          <Show when={goalRequirement()} fallback={
            <p class="chart-note">Set a target CGPA above to see what this semester has to deliver.</p>
          }>
            {(need) => (
              <p class="chart-note">
                <Show when={need().possible} fallback={<>{need().reason}</>}>
                  <Show when={need().slack} fallback={
                    <>This semester needs {need().required!.toFixed(2)}. Projection is
                      {" "}{summary().sgpaProjected.toFixed(2)}.</>
                  }>
                    Already secured by your past semesters.
                  </Show>
                </Show>
              </p>
            )}
          </Show>
        </div>

        {/* The route to the CGPA goal is NOT rendered here any more. It
            lives on the Targets tab beside the route to the semester's own
            SGPA target, because those two chase DIFFERENT NUMBERS and a
            student who cannot see them together cannot see that they differ.
            Analytics keeps the readings; Targets keeps the routes. */}
        <p class="chart-note">
          The route to this goal, and the route to this semester's own SGPA target,
          are on the Targets tab — side by side, because they are different numbers.
        </p>

        {/* The SGPA-trend chart lived here too, a third copy of the one on Home
            and History. On a per-semester screen the useful reading is not the
            whole-record trend - it is what THIS semester is costing in
            attendance, below. Trend stays on Home and History where the whole
            record is the subject. */}
        <div class="chart-block">
          <h4>Attendance vs internals</h4>
          <AttendanceScatter points={scatter()} />
          <p class="chart-note">
            These two axes are causally linked: attendance is worth CIE marks.
            Points drifting left are losing marks before any exam is written.
          </p>
        </div>
      </Show>
    </aside>
  );
}
