import { For, Show, createSignal } from "solid-js";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_MIN, COURSE_TYPES, TARGET_CHOICES, TYPE_KEYS,
  isIncomplete,
} from "../engine";
import type { Course, Evaluation, Letter, RequiredEse, TypeKey } from "../engine";
import { addCourse, removeCourse, rows, updateCourse } from "../state/store";
import { AttendanceBar } from "./charts";

const dash = "–";
const show = (v: number | null | undefined, places = 0) =>
  v === null || v === undefined ? dash : v.toFixed(places);

/**
 * The required-ESE cell.
 *
 * The asterisk is load-bearing: it marks the case where the separate 40% ESE
 * minimum is the binding constraint rather than the aggregate. Without it a
 * student sees "24/60" for a pass on a CIE of 38 and concludes the internals
 * bought them room, when in fact no amount of CIE moves that number.
 *
 * `applies` is false wherever the number would be advice about an exam this
 * course is not headed for: nothing assessed yet, so the figure would be
 * invented; an internal still missing its attendance component, so the figure
 * is priced off a floor and would read harsher than the truth while looking
 * exact; or a withdrawal, so there is no exam of theirs to sit.
 */
function Need(props: { need: RequiredEse; applies: boolean }) {
  return (
    <Show when={props.applies} fallback={<span style={{ color: "var(--text-faint)" }}>{dash}</span>}>
    <Show when={props.need.possible}
          fallback={<span class="grade f">{props.need.text}</span>}>
      <span class="num">
        {props.need.value}
        <Show when={props.need.binding === "cutoff"}>
          <span class="bound" title="The 40% ESE minimum binds here, not the total.">*</span>
        </Show>
      </span>
    </Show>
    </Show>
  );
}

/** See `Need`. */
const needApplies = (ev: Evaluation) =>
  ev.assessed && !ev.cieIncomplete && !isIncomplete(ev.grade);

function Cell(props: {
  value: unknown; onInput: (v: string) => void; wide?: boolean; placeholder?: string;
}) {
  return (
    <input
      class={`cell-input num${props.wide ? " wide" : ""}`}
      value={props.value === null || props.value === undefined ? "" : String(props.value)}
      placeholder={props.placeholder ?? dash}
      onInput={(e) => props.onInput(e.currentTarget.value)}
    />
  );
}

/**
 * The expanded row.
 *
 * This replaces what used to be a modal dialog. A student comparing two
 * subjects had to open, read, close, open, read - and the numbers they were
 * comparing were behind the dialog. Expanding in place keeps the rest of the
 * table on screen.
 */
function Detail(props: { index: number; course: Course; ev: Evaluation }) {
  const spec = () => COURSE_TYPES[(props.course.type ?? "TH 40/60") as TypeKey];
  const set = (patch: Partial<Course>) => updateCourse(props.index, patch);

  return (
    <tr class="detail">
      <td colSpan={14}>
        <div class="detail-grid">
          <div class="panel">
            <h4>Internal components</h4>
            <For each={spec().components}>{(c) => (
              <div class="field">
                <span>{c.header} <em style={{ color: "var(--text-faint)" }}>/ {c.rawMax}</em></span>
                <Cell value={(props.course as Record<string, unknown>)[c.key]}
                      onInput={(v) => set({ [c.key]: v } as Partial<Course>)} />
              </div>
            )}</For>
            <div class="field">
              <span>Published CIE</span>
              <Cell value={props.course.cie_override}
                    placeholder={`/${props.ev.cieMax}`}
                    onInput={(v) => set({ cie_override: v })} />
            </div>
            <p class="readout">
              <Show when={props.course.cie_override !== "" && props.course.cie_override != null}
                    fallback={<>Summed from components.</>}>
                Using the published internal total. The college's arithmetic wins
                over ours.
              </Show>
            </p>
          </div>

          <div class="panel">
            <h4>Attendance</h4>
            <div class="field">
              <span>Attended</span>
              <Cell value={props.course.attended} onInput={(v) => set({ attended: v })} />
            </div>
            <div class="field">
              <span>Held</span>
              <Cell value={props.course.held} onInput={(v) => set({ held: v })} />
            </div>
            <div class="field">
              <span>Duty leave</span>
              <Cell value={props.course.dl} onInput={(v) => set({ dl: v })} />
            </div>
            <p class="readout">
              <Show when={props.ev.plan} fallback={<>Enter attended and held to get a plan.</>}>
                {(plan) => (
                  <>
                    <Show when={plan().dlCredited > 0}>
                      Duty leave lifts {plan().raw.toFixed(1)}% to{" "}
                      <strong>{plan().current.toFixed(1)}%</strong>.{" "}
                      {/* Classes, not days, and a whole number of them: the
                          cap is a fraction of held, so the leftover comes out
                          fractional even though nobody misses half a class.
                          Rounded up, not to nearest: the legend promises that
                          anything above the cap is reported, and 0.3 of a
                          class rounded to nearest would delete the sentence
                          instead of shortening it. */}
                      <Show when={Math.ceil(plan().dlWasted)}>
                        {(wasted) => (
                          <>
                            <span class="down">
                              {wasted()} class{wasted() === 1 ? "" : "es"} of it landed
                              above the 10% cap and went uncounted.
                            </span>{" "}
                          </>
                        )}
                      </Show>
                    </Show>
                    <Show when={plan().state === "surplus"} fallback={
                      <>
                        Short of 75%.{" "}
                        <Show when={plan().attend !== null} fallback={<span class="out">No way back this semester.</span>}>
                          <span class="down">
                            Attend the next <strong>{plan().attend}</strong> classes without
                            missing one to get back over the line.
                          </span>
                        </Show>
                      </>
                    }>
                      <span class="up">
                        Room to miss <strong>{plan().skip}</strong> more
                        class{plan().skip === 1 ? "" : "es"} and stay eligible.
                      </span>
                    </Show>
                    <Show when={props.ev.attBand?.nextMarks}>
                      {" "}Attending <strong>{props.ev.attBand!.attend}</strong> in a row
                      reaches {props.ev.attBand!.atPct}% and earns{" "}
                      <strong>{props.ev.attBand!.nextMarks}</strong> CIE marks
                      instead of {props.ev.attBand!.earned}.
                    </Show>
                  </>
                )}
              </Show>
            </p>
          </div>

          <div class="panel">
            <h4>Exam and target</h4>
            <div class="field">
              <span>Course type</span>
              <select class="cell-input" value={props.course.type}
                      onChange={(e) => set({ type: e.currentTarget.value as TypeKey })}>
                <For each={TYPE_KEYS}>{(k) => <option value={k}>{COURSE_TYPES[k].label}</option>}</For>
              </select>
            </div>
            <div class="field">
              <span>Credits</span>
              <Cell value={props.course.credits} onInput={(v) => set({ credits: v })} />
            </div>
            <div class="field">
              <span>Published grade</span>
              <Cell value={props.course.portal_grade ?? ""} wide
                    onInput={(v) => set({ portal_grade: v })} />
            </div>
            <p class="readout">
              <Show when={props.ev.grade} fallback={
                <Show when={props.ev.assessed && !props.ev.cieIncomplete} fallback={
                  <Show when={props.ev.cieIncomplete && props.ev.assessed} fallback={
                    <>Nothing has been assessed in this course yet, so there is no
                      projection to make. A required mark shown here would be
                      invented, not calculated.</>
                  }>
                    Attendance has not been recorded, so the internal is still
                    missing its attendance marks and no grade can be read off a
                    total that is short of them. Enter attended and held
                    classes, or an attendance percentage, and the grade
                    follows.
                  </Show>
                }>
                  Best still reachable: <strong>{props.ev.maxPossibleGrade}</strong>.
                  A pass needs <strong>{props.ev.needPass.text}</strong>
                  <Show when={props.ev.needPass.binding === "cutoff"}>
                    {" "}- and that is the 40% exam minimum, so a higher CIE will not
                    lower it.
                  </Show>.
                </Show>
              }>
                {(grade) => (
                  <>
                    Grade <strong>{grade()}</strong>
                    <Show when={props.course.portal_grade}> as published by the university</Show>
                    <Show when={props.ev.failedReason}>
                      {" "}<span class="out">({props.ev.failedReason})</span>
                    </Show>.
                  </>
                )}
              </Show>
            </p>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function Ledger() {
  const [open, setOpen] = createSignal<number | null>(null);
  const toggle = (i: number) => setOpen(open() === i ? null : i);

  return (
    <div class="ledger">
      <Show when={rows().length > 0} fallback={
        <div class="empty">
          <p style={{ color: "var(--text-dim)", "font-size": "var(--text-lg)" }}>
            No subjects in {"this semester"} yet.
          </p>
          <p style={{ "max-width": "52ch", margin: "var(--s3) auto 0" }}>
            Add each subject with its credits and course type. Enter series marks
            and attendance as they come in, and every column to the right becomes
            a decision: what you still need in the exam, how many classes you can
            miss, and which subject is cheapest to push.
          </p>
          <button class="icon-btn" onClick={() => addCourse()}>Add a subject</button>
        </div>
      }>
        <table>
          <thead>
            <tr>
              <th class="left">Code</th>
              <th class="left">Course</th>
              <th>Cr</th>
              <th>CIE</th>
              <th class="left">Attendance</th>
              <th title="CIE marks earned by attendance alone (R 7.5.ii)">Att mk</th>
              <th>ESE</th>
              <th>Total</th>
              <th>Gr</th>
              <th title="ESE mark needed to pass">Pass</th>
              <th class="left">Target</th>
              <th title="ESE mark needed for the target grade">Need</th>
              <th class="left">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>{(row) => (
              <>
                <tr class={`row${open() === row.index ? " open" : ""}`}>
                  <td class="left">
                    <span class="code num" onClick={() => toggle(row.index)}
                          role="button" tabindex="0"
                          onKeyDown={(e) => e.key === "Enter" && toggle(row.index)}>
                      {row.course.code || "SET CODE"}
                    </span>
                  </td>
                  <td class="left title">{row.course.name || dash}</td>
                  <td class="num">{show(row.ev.credits)}</td>
                  <td class="num">
                    <Show when={row.ev.assessed}
                          fallback={<span style={{ color: "var(--text-faint)" }}>{dash}</span>}>
                      {/* An internal whose attendance component is unknown is a
                          floor, not a total, and the row must not print it as
                          one. See `Evaluation.cieIncomplete`. */}
                      <Show when={row.ev.cieIncomplete}>
                        <span class="bound"
                              title="Attendance is not recorded, so the internal is still missing its attendance marks.">≥</span>
                      </Show>
                      {show(row.ev.cie, 1)}
                      <span style={{ color: "var(--text-faint)" }}>/{row.ev.cieMax}</span>
                    </Show>
                  </td>
                  <td class="left">
                    <AttendanceBar pct={row.ev.attendance} />{" "}
                    <span class="num" style={{
                      color: row.ev.attendance === null ? "var(--text-faint)"
                        : row.ev.attendance < ATTENDANCE_CONDONE ? "var(--danger)"
                        : row.ev.attendance < ATTENDANCE_MIN ? "var(--warn)" : "var(--text-dim)",
                    }}>{row.ev.attendance === null ? dash : `${row.ev.attendance.toFixed(0)}%`}</span>
                  </td>
                  <td class="num" title="CIE marks from attendance">
                    {show(row.ev.attMarks)}<span style={{ color: "var(--text-faint)" }}>/5</span>
                  </td>
                  <td>
                    <Cell value={row.course.ese}
                          onInput={(v) => updateCourse(row.index, { ese: v })}
                          placeholder={`/${row.ev.eseMax}`} />
                  </td>
                  <td class="num">{show(row.ev.total)}</td>
                  <td class={`grade${row.ev.grade === "F" ? " f" : ""}${
                    row.ev.grade === "S" || row.ev.grade === "A+" ? " top" : ""}`}>
                    {row.ev.grade ?? dash}
                  </td>
                  <td><Need need={row.ev.needPass} applies={needApplies(row.ev)} /></td>
                  <td class="left">
                    <select class="cell-input" value={row.ev.target}
                            onChange={(e) => updateCourse(row.index, {
                              target: e.currentTarget.value as Letter })}>
                      <For each={TARGET_CHOICES}>{(g) => <option value={g}>{g}</option>}</For>
                    </select>
                  </td>
                  <td><Need need={row.ev.needTarget} applies={needApplies(row.ev)} /></td>
                  <td class="left">
                    <span class={`pill ${row.status.toLowerCase()}`}>{row.status}</span>
                  </td>
                  <td>
                    <button class="del" title="Remove this subject"
                            onClick={() => removeCourse(row.index)}>&times;</button>
                  </td>
                </tr>
                <Show when={open() === row.index}>
                  <Detail index={row.index} course={row.course} ev={row.ev} />
                </Show>
              </>
            )}</For>
          </tbody>
        </table>
        <div style={{ padding: "var(--s4) var(--s5)" }}>
          <button class="icon-btn" onClick={() => addCourse()}>+ Subject</button>
        </div>
      </Show>
    </div>
  );
}
