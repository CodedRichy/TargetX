import { For, Show, createSignal } from "solid-js";
import { goalRequirement, rows, summary } from "../state/store";
import { AttendanceScatter, GoalGauge } from "./charts";
import { TargetsTab } from "./Targets";

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
          <For each={GLOSSARY}>{([term, text]) => (
            <><dt>{term}</dt><dd>{text}</dd></>
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
