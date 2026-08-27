import { For, Show, createMemo, createSignal } from "solid-js";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_FULL_MARKS_PCT, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN,
  ESE_PASS_FRACTION, TOTAL_PASS_MARK, checkGpaTarget,
} from "../engine";
import type {
  AttendanceTargetCheck, AttendanceTargetGap, GpaTargetCheck, ResolvedSgpaTarget,
  SgpaTargetReconciliation,
} from "../engine";
import {
  attendanceGaps, attendanceTargetCheck, cgpaTargetCheck, goalPlan, goalRequirement,
  rows, semesterSgpaTarget, semesterTargetPlan, setAttendanceTarget,
  setDefaultSgpaTarget, setGoal, setSemesterSgpaTarget, sgpaTargetVsGoal, state,
  targets,
} from "../state/store";
import { RoutePanel } from "./Route";

/**
 * Targets.
 *
 * The one surface where a student says what they are aiming for, and the one
 * place the app explains what each aim costs. It lives in the drawer beside
 * the semester table because every target here is read against those rows.
 *
 * THE RULING THIS SCREEN EXISTS TO HOLD: KTU's regulations are not editable
 * and are never presented as though they were. The 75% eligibility line, the
 * 60% condonation floor, the R 7.5.ii mark bands, the 50-mark pass and the
 * 40% exam minimum are printed here as reference, in a block with no input in
 * it, because the only reason to trust this app over a spreadsheet is that it
 * knows the real rules. The student's own targets sit on top and may be set
 * ABOVE or BELOW any of those floors - below is allowed, and is marked every
 * time rather than silently accepted.
 *
 * Everything that renders a consequence is a pure component taking the
 * engine's own check object as a prop. That is deliberate: the strings below
 * are the class of defect this project has shipped most often - text asserting
 * behaviour the code does not have - and a component that reads the store
 * cannot be rendered by a test with a known input.
 */

const pct = (v: number) => `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;

/**
 * Where a personal attendance target sits against the regulations.
 *
 * Four bands, four different consequences, and the difference between the last
 * two is whether anything can be done: R 6.2 reaches condonation and does not
 * reach debarment at all. So condonation is marked as a warning - a target of
 * needing a favour - and debarment as a failure.
 */
export function AttendanceTargetReadout(props: { check: AttendanceTargetCheck | null }) {
  return (
    <Show when={props.check} fallback={
      <p class="readout">
        No attendance target. Nothing on the table is measured against one, and
        the {pct(ATTENDANCE_MIN)} eligibility rule still applies whatever you aim for.
      </p>
    }>
      {(c) => (
        <>
          <Show when={c().belowRegulation}>
            <span class={c().band === "debarred" ? "pill debarred" : "pill shortage"}>
              below the {pct(ATTENDANCE_MIN)} rule
            </span>
          </Show>
          <p class="readout">
            <Show when={c().band === "full"}>
              At <strong>{pct(c().target)}</strong> you keep all {c().marksMax} attendance
              marks. Nothing is being given away.
            </Show>
            <Show when={c().band === "eligible"}>
              <span class="down">
                At <strong>{pct(c().target)}</strong> you are eligible to sit the exam, and
                R 7.5.ii pays <strong>{c().marksAtTarget}</strong> of {c().marksMax} —{" "}
                <strong>{c().marksForfeited}</strong> mark
                {c().marksForfeited === 1 ? "" : "s"} given up in every subject before you
                write a word.
              </span>
            </Show>
            <Show when={c().band === "condonation"}>
              <span class="down">
                At <strong>{pct(c().target)}</strong> you are not eligible on your own.
                R 6.2 lets the Principal condone down to {pct(ATTENDANCE_CONDONE)}, for at
                most two semesters and against a fee — a target here is a target of needing
                a favour. R 7.5.ii pays <strong>{c().marksAtTarget}</strong> of {c().marksMax}.
              </span>
            </Show>
            <Show when={c().band === "debarred"}>
              <span class="out">
                At <strong>{pct(c().target)}</strong> you are below {pct(ATTENDANCE_CONDONE)}
                {" "}and R 6.2 gives no appeal. This is a target of not sitting the exam.
              </span>
            </Show>
          </p>
        </>
      )}
    </Show>
  );
}

/**
 * Why 85 and not 75, in one sentence, on screen once.
 *
 * The whole thesis of the app. 75 is the line below which you are not admitted
 * to the exam; it is not the line at which attendance stops costing you. Every
 * figure in it is read off the regulation constants rather than typed, so the
 * sentence cannot drift from the table it describes.
 */
export function AttendanceTargetWhy() {
  return (
    <p class="chart-note">
      {pct(ATTENDANCE_MIN)} only admits you to the exam — R 7.5.ii pays all{" "}
      {ATTENDANCE_MARK_MAX} CIE marks from {pct(ATTENDANCE_FULL_MARKS_PCT)}, so every
      point between the two is marks lost in every subject before you write a word.
    </p>
  );
}

/** A GPA target below the lowest passing grade point is reachable only by failing. */
export function GpaTargetWarning(props: { check: GpaTargetCheck | null; what: string }) {
  return (
    <Show when={props.check?.belowPassing}>
      <p class="readout">
        <span class="down">
          A {props.what} of <strong>{props.check!.target.toFixed(2)}</strong> is below
          every passing grade point. Passing everything, even all at the lowest passing
          letter, averages higher than that — this target can only be met by failing
          something.
        </span>
      </p>
    </Show>
  );
}

/** Which target answered for this semester, and whether it covers the CGPA goal. */
export function SgpaTargetReadout(props: {
  semester: string;
  resolved: ResolvedSgpaTarget;
  vsGoal: SgpaTargetReconciliation;
}) {
  return (
    <>
      <p class="readout">
        <Show when={props.resolved.basis === "semester"}>
          {props.semester} is using its own target of{" "}
          <strong>{props.resolved.value!.toFixed(2)}</strong>.
        </Show>
        <Show when={props.resolved.basis === "default"}>
          {props.semester} has no target of its own, so it falls back to your default
          of <strong>{props.resolved.value!.toFixed(2)}</strong>.
        </Show>
        <Show when={props.resolved.basis === "none"}>
          No SGPA target for {props.semester}, and no default to fall back to.
        </Show>
      </p>
      <Show when={props.vsGoal.sufficient !== null}>
        <p class="readout">
          <Show when={props.vsGoal.sufficient} fallback={
            <span class="down">
              Your <strong>{props.vsGoal.personal!.toFixed(2)}</strong> is{" "}
              <strong>{props.vsGoal.shortfall!.toFixed(2)}</strong> short of the{" "}
              <strong>{props.vsGoal.requiredForCgpa!.toFixed(2)}</strong> your CGPA goal
              needs.
            </span>
          }>
            <span class="up">
              Your <strong>{props.vsGoal.personal!.toFixed(2)}</strong> covers the{" "}
              <strong>{props.vsGoal.requiredForCgpa!.toFixed(2)}</strong> your CGPA goal
              needs.
            </span>
          </Show>
        </p>
        <p class="chart-note">
          Both are yours and neither overrides the other. The two routes below chase the
          two different numbers.
        </p>
      </Show>
    </>
  );
}

/**
 * The regulations, as reference. No input in this block, ever.
 *
 * Every figure is read off `constants.ts`, so this list cannot describe a rule
 * the engine is not applying.
 */
export function RegulationFloors() {
  return (
    <div class="chart-block">
      <h4>KTU's rules</h4>
      <p class="chart-note">
        Set by the regulations, not by you. TargetX works to these whatever you aim for.
      </p>
      <dl class="floors">
        <dt>Exam eligibility</dt>
        <dd>{pct(ATTENDANCE_MIN)} attendance (R 6.2).</dd>
        <dt>Condonation floor</dt>
        <dd>
          {pct(ATTENDANCE_CONDONE)}. Between the two the Principal may condone, for at
          most two semesters and against a fee. Below it there is no appeal (R 6.2).
        </dd>
        <dt>Full attendance marks</dt>
        <dd>
          {pct(ATTENDANCE_FULL_MARKS_PCT)} earns all {ATTENDANCE_MARK_MAX} CIE marks,
          stepping down to 1 at {pct(ATTENDANCE_CONDONE)} (R 7.5.ii).
        </dd>
        <dt>Pass</dt>
        <dd>{TOTAL_PASS_MARK} of 100 on the total.</dd>
        <dt>Exam minimum</dt>
        <dd>
          {pct(ESE_PASS_FRACTION * 100)} of the ESE paper on its own, whatever the
          internal is.
        </dd>
      </dl>
    </div>
  );
}

/** One course, both attendance answers, never merged into one. */
export interface GapEntry { code: string; gap: AttendanceTargetGap }

/**
 * Courses below the PERSONAL attendance target.
 *
 * Kept apart from `summary().lowAttendance`, which is the regulation shortage
 * list, on the engine's own ruling: no target feeds `evaluate` or `summarise`,
 * so a personal aspiration must never be mixed into the list that reports a
 * regulation breach. A course can be on one list, the other, or both, and the
 * two columns here say which.
 *
 * `toTarget` and `toEligible` are TWO ANSWERS, not one with a rounding
 * difference: a course at 80% can both skip classes and stay eligible AND owe
 * a run of consecutive attendance before it stops losing CIE marks. Showing
 * only the friendlier one is the old behaviour this screen exists to end.
 */
export function PersonalAttendanceList(props: {
  entries: GapEntry[];
  target: number | null;
  /** True only on a strict breach of the regulation - see `belowRegulation`. */
  targetBelowRegulation: boolean;
}) {
  return (
    <div class="chart-block">
      <h4>Below your own target</h4>
      <p class="chart-note">
        Your target, not the regulation. The {pct(ATTENDANCE_MIN)} shortage count in the
        bar above is a separate list and a course can be on one and not the other.
      </p>
      <Show when={props.target !== null} fallback={
        <p class="readout">Set an attendance target above and this list fills in.</p>
      }>
        <Show when={props.entries.length > 0} fallback={
          <p class="readout">
            <span class="up">
              Every subject is at or above {pct(props.target!)}. Nothing to claw back.
            </span>
          </p>
        }>
          <Show when={props.targetBelowRegulation}>
            <p class="chart-note" style={{ color: "var(--warn)" }}>
              Your target is below the {pct(ATTENDANCE_MIN)} eligibility rule, so the
              "to target" answer is the looser of the two. The eligibility column is the
              binding one.
            </p>
          </Show>
          <For each={props.entries}>{(entry) => (
            <div class="gap-row">
              <span class="num gap-code">{entry.code}</span>
              <span class="num gap-now">
                {entry.gap.current === null ? "–" : pct(entry.gap.current)}
              </span>
              <div class="gap-answers">
                <div>
                  <span class="stat-label">To {pct(props.target!)}</span>
                  <span class="gap-answer">
                    <Show when={entry.gap.toTarget} fallback={<span class="faint">–</span>}>
                      {(plan) => (
                        <Show when={plan().state === "surplus"} fallback={
                          <Show when={plan().attend !== null} fallback={
                            <span class="out">out of reach this semester</span>
                          }>
                            <span class="down">
                              attend <strong>{plan().attend}</strong> in a row
                            </span>
                          </Show>
                        }>
                          <span class="up">room to miss {plan().skip}</span>
                        </Show>
                      )}
                    </Show>
                  </span>
                </div>
                <div>
                  <span class="stat-label">To eligible</span>
                  <span class="gap-answer">
                    <Show when={entry.gap.toEligible} fallback={<span class="faint">–</span>}>
                      {(plan) => (
                        <Show when={plan().state === "surplus"} fallback={
                          <Show when={plan().attend !== null} fallback={
                            <span class="out">no way back</span>
                          }>
                            <span class="down">
                              attend <strong>{plan().attend}</strong> in a row
                            </span>
                          </Show>
                        }>
                          <span class="up">room to miss {plan().skip}</span>
                        </Show>
                      )}
                    </Show>
                  </span>
                </div>
              </div>
            </div>
          )}</For>
        </Show>
      </Show>
    </div>
  );
}

/** A target field. Blank clears; the store decides what a blank means. */
function TargetField(props: {
  id: string; label: string; value: number | null;
  placeholder?: string; onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = createSignal(props.value === null ? "" : String(props.value));
  return (
    <div class="field">
      <label for={props.id}>{props.label}</label>
      <input id={props.id} class="goal-input num" value={draft()}
             placeholder={props.placeholder ?? ""}
             onInput={(e) => {
               const raw = e.currentTarget.value;
               setDraft(raw);
               const value = Number(raw.trim());
               props.onCommit(raw.trim() === "" || !Number.isFinite(value) ? null : value);
             }} />
    </div>
  );
}

/**
 * The drawer's Targets tab.
 *
 * The only component here that reads the store. Everything it renders below
 * the fields is a pure component above, handed an engine check object.
 */
export function TargetsTab() {
  /**
   * Courses under the personal target, zipped in ONE pass.
   *
   * `attendanceGaps()` is index-aligned with `rows()` by construction, and the
   * engine report names indexing one from the other as the way that pairing
   * breaks silently. Both are mapped together here so a future filter on
   * either cannot desync them.
   */
  const under = createMemo<GapEntry[]>(() => {
    const gaps = attendanceGaps();
    const out: GapEntry[] = [];
    rows().forEach((row, i) => {
      const gap = gaps[i];
      if (!gap || !gap.toTarget || gap.toTarget.state === "surplus") return;
      out.push({ code: row.course.code || row.course.name || "?", gap });
    });
    return out;
  });

  const goalNeed = () => goalRequirement();

  return (
    <>
      <div class="chart-block">
        <h4>What you are aiming for</h4>
        <TargetField id="t-cgpa" label="CGPA at graduation" placeholder="8.0"
                     value={targets().cgpa} onCommit={setGoal} />
        <GpaTargetWarning check={cgpaTargetCheck()} what="CGPA target" />

        <TargetField id="t-att" label="Attendance, every subject" placeholder="85"
                     value={targets().attendance} onCommit={setAttendanceTarget} />
        <AttendanceTargetWhy />
        <AttendanceTargetReadout check={attendanceTargetCheck()} />

        <TargetField id="t-sem" label={`${state.activeSemester} SGPA`} placeholder="—"
                     value={targets().sgpaBySemester[state.activeSemester] ?? null}
                     onCommit={(v) => setSemesterSgpaTarget(state.activeSemester, v)} />
        <TargetField id="t-sgpa-default" label="Every other semester" placeholder="—"
                     value={targets().sgpaDefault} onCommit={setDefaultSgpaTarget} />
        <SgpaTargetReadout semester={state.activeSemester}
                           resolved={semesterSgpaTarget()} vsGoal={sgpaTargetVsGoal()} />
        <GpaTargetWarning check={checkGpaTarget(semesterSgpaTarget().value)}
                          what="semester target" />
      </div>

      <PersonalAttendanceList entries={under()} target={targets().attendance}
                              targetBelowRegulation={
                                attendanceTargetCheck()?.belowRegulation ?? false} />

      {/* TWO ROUTES, TWO NUMBERS, NEVER ONE HEADING. The first chases the
          average the CGPA goal needs across every semester left; the second
          chases the SGPA the student typed for this one. They can disagree,
          and `SgpaTargetReadout` above says by how much. */}
      <Show when={semesterTargetPlan()}>{(plan) => (
        <RoutePanel title={`Route to your ${state.activeSemester} target`}
                    chasing={`the SGPA you set for ${state.activeSemester}`}
                    target={semesterSgpaTarget().value!} plan={plan()} />
      )}</Show>

      <Show when={goalPlan()}>{(plan) => (
        <RoutePanel title="Route to your CGPA goal"
                    chasing={`the average a ${targets().cgpa!.toFixed(2)} CGPA needs from`
                      + ` ${state.activeSemester} on`}
                    target={goalNeed()!.required!} plan={plan()} />
      )}</Show>

      <RegulationFloors />
    </>
  );
}
