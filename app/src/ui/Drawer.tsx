import { For, Show, createSignal } from "solid-js";
import { goalPlan, goalRequirement, overall, rows, summary, trend } from "../state/store";
import { AttendanceScatter, GoalGauge, TrendChart } from "./charts";

/**
 * Column glossary.
 *
 * A student who does not know what ESE means cannot use a column called ESE,
 * and the old build hid this behind a modal - so the explanation and the thing
 * being explained were never on screen together. It lives in the drawer now
 * and stays open while the table is read.
 */
const GLOSSARY: Array<[string, string]> = [
  ["CIE", "Continuous Internal Evaluation - the marks your college gives during the semester: series exams, assignments, and attendance. Out of 40 for most theory courses."],
  ["ESE", "End Semester Examination - the university exam at the end. Out of 60 for most theory courses."],
  ["The 40% rule", "You must score at least 40% of the ESE paper on its own, whatever your CIE is. A brilliant internal cannot buy a pass. Where this is the binding constraint, the required mark is starred."],
  ["Att mk", "Attendance is worth up to 5 CIE marks under Regulations 2024, R 7.5.ii: 85% earns 5, then 4, 3, 2, 1 down to 60%. This is the part no other KTU calculator shows - being at 76% is not 'fine', it is two marks already gone."],
  ["Pass / Need", "The ESE mark required to pass, and to reach your target grade. Blank means the course has not been assessed yet, not that you scored zero."],
  ["SHORTAGE", "Below 75% attendance. Condonation may be possible down to 60%, for at most two semesters, against a fee."],
  ["DEBARRED", "Below 60%. There is no appeal path under R 6.2."],
  ["UNREACHABLE", "Even a full ESE paper cannot get this course to a pass. Better to know now."],
  ["INCOMPLETE", "Published as I or W - withdrawn, or not completed. KTU leaves it out of the SGPA entirely, credits included, until you complete it. It is not a fail and is not scored as one."],
  ["Duty leave", "Approved absence for NSS, sports, fests or placement drives. It counts as present, but only up to 10% of classes held (R 6.3.ii) - anything beyond that is wasted, and this app says so."],
];

export function Drawer() {
  const [tab, setTab] = createSignal<"analytics" | "legend">("analytics");

  const scatter = () => rows()
    // Attendance is the X axis, so a subject with none on record has no point
    // to plot - not a point sitting at 0% or 100%.
    .filter((r) => r.ev.assessed && r.course.code && r.ev.attendance !== null)
    .map((r) => ({
      code: r.course.code!, attendance: r.ev.attendance!,
      cie: r.ev.cie, cieMax: r.ev.cieMax,
    }));

  return (
    <aside class="drawer">
      <div style={{ display: "flex", gap: "var(--s2)", "margin-bottom": "var(--s5)" }}>
        <button class="icon-btn" aria-pressed={tab() === "analytics"}
                style={tab() === "analytics" ? { color: "var(--brand-bright)", "border-color": "var(--brand-deep)" } : {}}
                onClick={() => setTab("analytics")}>Analytics</button>
        <button class="icon-btn" aria-pressed={tab() === "legend"}
                style={tab() === "legend" ? { color: "var(--brand-bright)", "border-color": "var(--brand-deep)" } : {}}
                onClick={() => setTab("legend")}>What the columns mean</button>
      </div>

      <Show when={tab() === "analytics"} fallback={
        <dl>
          <For each={GLOSSARY}>{([term, text]) => (
            <><dt>{term}</dt><dd>{text}</dd></>
          )}</For>
        </dl>
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

        {/* The route itself needs rows to show; the reason has to be shown
            whether or not there are any - a course dropped from a plan that
            came back empty is exactly the case a student needs told. A
            conditional plan shows its rows too: the target is still open, and
            hiding the route because a course nobody has marked yet cannot be
            priced would withhold the only advice the semester can give. */}
        <Show when={goalPlan()}>{(plan) => (
          <Show when={((plan().reachable || plan().conditional) && plan().plan.length > 0) || plan().reason}>
            <div class="chart-block">
              {/* A conditional plan is not the cheapest anything: the greedy
                  ran out of rungs before it covered the target, so what is
                  shown is the top of every ladder. With no rows at all there
                  is nothing on offer to title - the block is then only the
                  explanation below it. */}
              <h4>
                {plan().conditional && plan().plan.length > 0
                  ? "Best still on offer" : "Cheapest route"}
              </h4>
              <Show when={(plan().reachable || plan().conditional) && plan().plan.length > 0}>
                <dl style={{ margin: 0 }}>
                  <For each={plan().plan}>{(row) => (
                    <div class="field">
                      <span class="num">{row.code}</span>
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
                      </span>
                    </div>
                  )}</For>
                </dl>
                <Show when={!plan().conditional}>
                  <p class="chart-note">
                    Balanced on the difficulty of each next grade, not on total marks -
                    a plan demanding 60/60 in two papers is not a plan.
                  </p>
                </Show>
              </Show>
              {/* The route alone does not carry the target, and the rest
                  rides on a course with no exam and no settled internal. Say
                  which one, and say what the route does get to. */}
              <Show when={plan().conditional}>
                <p class="chart-note" style={{ color: "var(--warn)" }}>
                  This route reaches {plan().sgpa?.toFixed(2)} of the{" "}
                  {plan().target?.toFixed(2)} needed on its own. The rest rides on
                  marks nobody has entered yet: {plan().unpriced?.join(", ")} - no exam
                  to sit, and the internal not settled.
                </p>
              </Show>
              <Show when={plan().reason}>
                {(reason) => <p class="chart-note">{reason()}</p>}
              </Show>
            </div>
          </Show>
        )}</Show>

        <div class="chart-block">
          <h4>SGPA trend</h4>
          <TrendChart data={trend()} cgpa={overall().cgpa} />
        </div>

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
