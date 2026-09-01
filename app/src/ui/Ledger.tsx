import { For, Show, createMemo, createSignal } from "solid-js";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_MIN, COURSE_TYPES, TARGET_CHOICES, TYPE_KEYS,
  isIncomplete, requiredEseCell, specFor, toOptionalFloat,
} from "../engine";
import type {
  AttendanceTargetGap, Course, Evaluation, Letter, RequiredEse, TypeKey,
} from "../engine";
import { addCourse, attendanceGaps, removeCourse, rows, updateCourse } from "../state/store";
import { AttendanceBar } from "./charts";

const dash = "–";
/** Shown and announced on the starred cells; one string so the two agree. */
const CUTOFF_NOTE = "The 40% ESE minimum binds here, not the total.";
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
 * Which of the two figures is printed is `requiredEseCell`'s decision, not
 * this component's, because the text report prints the same pair and the two
 * must not diverge. Where the CIE can still rise, the cell quotes the
 * best-case figure and marks it as a bound: the floor-priced number is real
 * but it is the requirement only if the student never attends another class,
 * and printing it unmarked put an "Impossible" beside a status pill reading
 * TIGHT on the same row.
 *
 * `applies` is false wherever the number would be advice about an exam this
 * course is not headed for: nothing assessed yet, so the figure would be
 * invented; an internal still short of a component or of its attendance
 * marks, so BOTH figures are guesses about marks that are not the student's
 * to earn; or a withdrawal, so there is no exam of theirs to sit.
 */
function Need(props: { need: RequiredEse; best: RequiredEse; applies: boolean }) {
  const cell = () => requiredEseCell(props.need, props.best);
  // `title` is not an accessible name on a `span`, and these two glyphs are
  // the whole of the qualification - a screen reader that skips them hears a
  // flat number where the row shows a bound. `role="img"` plus `aria-label`
  // makes the sentence the name of the mark, so it is read WITH the figure
  // rather than needing a hover the keyboard cannot produce.
  const bound = () => boundTitle(props.need, props.best);
  return (
    <Show when={props.applies} fallback={<span style={{ color: "var(--text-faint)" }}>{dash}</span>}>
    <Show when={cell().shown.possible}
          fallback={<span class="grade f">{cell().shown.text}</span>}>
      <span class="num">
        <Show when={cell().bound}>
          <span class="bound" role="img" aria-label={bound()} title={bound()}>≥</span>
        </Show>
        {cell().shown.value}
        <Show when={cell().shown.binding === "cutoff"}>
          <span class="bound" role="img" title={CUTOFF_NOTE} aria-label={CUTOFF_NOTE}>*</span>
        </Show>
      </span>
    </Show>
    </Show>
  );
}

/**
 * Why the printed requirement is a bound, in the student's words.
 *
 * Only ever shown on a row where `needApplies` holds, and there every
 * component is marked - so the whole gap between the two figures is the
 * attendance marks of R 7.5.ii that are still within reach. That is the one
 * thing the student can still do about the number, which is why the cell
 * quotes the reachable end and this string names the other one.
 */
function boundTitle(need: RequiredEse, best: RequiredEse): string {
  const earn = "if you earn the attendance marks still within reach";
  return need.possible
    ? `${best.text} ${earn}; ${need.text} if your attendance stays where it is.`
    : `${best.text} ${earn}. At today's attendance it is out of reach.`;
}

/** See `Need`. */
const needApplies = (ev: Evaluation) =>
  ev.assessed && !ev.cieFloor && !isIncomplete(ev.grade);

/**
 * Which part of the internal is still missing, in the student's words.
 *
 * Named rather than generic because the two halves take different action: an
 * attendance figure is one field they can fill in themselves, an unmarked
 * series exam is the college's to award and there is nothing to do but wait.
 */
function missingInternal(ev: Evaluation): string {
  if (ev.cieIncomplete && ev.cieUnmarked) {
    return "Attendance has not been recorded and not every internal component "
      + "has been marked, so the internal total shown is a floor rather than "
      + "the mark, and no grade can be read off it.";
  }
  if (ev.cieIncomplete) {
    return "Attendance has not been recorded, so the internal is still missing "
      + "its attendance marks and no grade can be read off a total that is "
      + "short of them.";
  }
  return "Not every internal component has been marked yet, so the total shown "
    + "is a floor - the marks still to come can only raise it, and no grade "
    + "can be read off a figure that is going to move.";
}

/**
 * A mark box.
 *
 * `label` is required rather than optional on purpose. An `input` in a table
 * cell has no accessible name of its own - a column header names the CELL, not
 * the control inside it - so a screen reader reaching one of these announces
 * "edit text" and nothing else. Making the prop mandatory means the type
 * checker, not a reviewer, is what catches the next unnamed box.
 */
function Cell(props: {
  value: unknown; label: string; onInput: (v: string) => void;
  wide?: boolean; placeholder?: string;
}) {
  return (
    <input
      aria-label={props.label}
      class={`cell-input num${props.wide ? " wide" : ""}`}
      value={props.value === null || props.value === undefined ? "" : String(props.value)}
      placeholder={props.placeholder ?? dash}
      onInput={(e) => props.onInput(e.currentTarget.value)}
    />
  );
}

/**
 * The distance to the student's OWN attendance target.
 *
 * Rendered as a second sentence beside the eligibility one, never instead of
 * it. `toTarget` and `toEligible` are two answers to two questions: a course
 * at 80% has room to miss classes and stay eligible AND owes a run of
 * consecutive attendance before it stops shedding CIE marks. Quoting only the
 * first is how an app tells a student at 78% that they are fine.
 *
 * Silent where the target is at or below the eligibility line - there the
 * sentence above is already the stricter of the two and a second one saying
 * less would only soften it.
 */
export function TargetGap(props: { gap: AttendanceTargetGap; ev: Evaluation }) {
  /**
   * The same run of classes is already quoted above.
   *
   * The attendance-band sentence quotes the run that reaches the next R 7.5.ii
   * mark band, and where the personal target sits ON a band boundary - which
   * the default 85 does, being the full-marks band - the two runs are the same
   * number and printing it twice is noise. Compared by the number the student
   * would act on, not by the percentage, because that is the thing being
   * repeated.
   */
  const alreadySaid = () =>
    props.gap.toTarget !== null
    && props.gap.toTarget.state === "deficit"
    && props.ev.attBand !== null
    && props.ev.attBand.nextMarks !== null
    && props.ev.attBand.attend === props.gap.toTarget.attend;

  return (
    <Show when={props.gap.toTarget && !props.gap.targetUnderEligibility && !alreadySaid()}>
      {" "}<Show when={props.gap.toTarget!.state === "surplus"} fallback={
        <Show when={props.gap.toTarget!.attend !== null} fallback={
          <span class="out">
            Your own {props.gap.target!.toFixed(0)}% target is out of reach this semester.
          </span>
        }>
          <span class="down">
            Your own {props.gap.target!.toFixed(0)}% target is a different number:{" "}
            <strong>{props.gap.toTarget!.attend}</strong> in a row.
          </span>
        </Show>
      }>
        <span class="up">
          Already at or above your own {props.gap.target!.toFixed(0)}% target, with room
          to miss <strong>{props.gap.toTarget!.skip}</strong> more.
        </span>
      </Show>
    </Show>
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
function Detail(props: {
  index: number; course: Course; ev: Evaluation; gap: AttendanceTargetGap;
}) {
  const spec = () => COURSE_TYPES[(props.course.type ?? "TH 40/60") as TypeKey];
  const set = (patch: Partial<Course>) => updateCourse(props.index, patch);
  // The same pairing the table cell uses, so the row and its expansion cannot
  // quote different figures for the same requirement.
  const passCell = () => requiredEseCell(props.ev.needPass, props.ev.needPassBest);

  return (
    <tr class="detail" id={`detail-${props.index}`}>
      <td colSpan={14}>
        <div class="detail-grid">
          <div class="panel">
            <h4>Internal components</h4>
            <For each={spec().components}>{(c) => (
              <div class="field">
                <span>{c.header} <em style={{ color: "var(--text-faint)" }}>/ {c.rawMax}</em></span>
                <Cell value={(props.course as Record<string, unknown>)[c.key]}
                      label={`${c.header}, out of ${c.rawMax}`}
                      onInput={(v) => set({ [c.key]: v } as Partial<Course>)} />
              </div>
            )}</For>
            <div class="field">
              <span>Published CIE</span>
              <Cell value={props.course.cie_override}
                    label={`Published CIE, out of ${props.ev.cieMax}`}
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
              <Cell value={props.course.attended} label="Classes attended"
                    onInput={(v) => set({ attended: v })} />
            </div>
            <div class="field">
              <span>Held</span>
              <Cell value={props.course.held} label="Classes held"
                    onInput={(v) => set({ held: v })} />
            </div>
            <div class="field">
              <span>Duty leave</span>
              <Cell value={props.course.dl} label="Duty leave classes"
                    onInput={(v) => set({ dl: v })} />
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
                    <TargetGap gap={props.gap} ev={props.ev} />
                  </>
                )}
              </Show>
            </p>
          </div>

          <div class="panel">
            <h4>Exam and target</h4>
            <div class="field">
              <span>Course type</span>
              <select class="cell-input" aria-label="Course type" value={props.course.type}
                      onChange={(e) => set({ type: e.currentTarget.value as TypeKey })}>
                <For each={TYPE_KEYS}>{(k) => <option value={k}>{COURSE_TYPES[k].label}</option>}</For>
              </select>
            </div>
            <div class="field">
              <span>Credits</span>
              {/* Editing credits marks them confirmed, which is what stops the
                  next sync overwriting the correction. etlab never publishes a
                  per-course credit, so TargetX infers it from the catalogue -
                  and the sync panel tells the student to fix it when the
                  inference is wrong. That flag existed and was never set by
                  anything, so the correction survived until the next sync and
                  then quietly went back. Only a real number confirms: clearing
                  the box is not a correction to protect. */}
              <Cell value={props.course.credits} label="Credits"
                    onInput={(v) => set(Number.isFinite(Number(v)) && String(v).trim() !== ""
                      ? { credits: v, creditsConfirmed: true }
                      : { credits: v, creditsConfirmed: false })} />
            </div>
            <div class="field">
              <span>Published grade</span>
              <Cell value={props.course.portal_grade ?? ""} wide
                    label="Published grade"
                    onInput={(v) => set({ portal_grade: v })} />
            </div>
            <p class="readout">
              <Show when={props.ev.grade} fallback={
                <Show when={props.ev.assessed && !props.ev.cieFloor} fallback={
                  <Show when={props.ev.assessed} fallback={
                    <>Nothing has been assessed in this course yet, so there is no
                      projection to make. A required mark shown here would be
                      invented, not calculated.</>
                  }>
                    {missingInternal(props.ev)}{" "}
                    <Show when={props.ev.cieIncomplete}>
                      Enter attended and held classes, or an attendance
                      percentage, and that half settles.{" "}
                    </Show>
                    <Show when={props.ev.eseMax > 0} fallback={
                      <>The grade comes with the last of those marks - this
                        course is graded on its internal alone.</>
                    }>
                      The grade follows once the internal is settled and the
                      exam mark is in.
                    </Show>
                  </Show>
                }>
                  Best still reachable: <strong>{props.ev.maxPossibleGrade}</strong>.
                  <Show when={passCell().shown.possible} fallback={
                    <> A pass is out of reach: even a full exam on top of the
                      highest internal still open to this course falls short.</>
                  }>
                    {" "}A pass needs <strong>{passCell().shown.text}</strong>
                    <Show when={passCell().bound}>
                      {" "}- the least it can cost, and only once you earn the
                      attendance marks still within reach;{" "}
                      {props.ev.needPass.possible
                        ? `at today's attendance it is ${props.ev.needPass.text}`
                        : "at today's attendance it is out of reach"}
                    </Show>
                    <Show when={passCell().shown.binding === "cutoff"}>
                      {" "}- and that is the 40% exam minimum, so a higher CIE will not
                      lower it.
                    </Show>
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

/**
 * The internal's component marks - Series 1, Series 2, assignment - shown
 * inline under the CIE total. The single CIE number hides its own shape: a low
 * total might be one weak series or a mark not yet entered, and the student
 * would have to open the row to tell which. This puts the pieces on the row
 * itself. Labels are abbreviated ("S1", "S2", "A") to fit the narrow numeric
 * column; the `title` restores the full names and maxes on hover. Shown only
 * when the type actually has components and there is real data to show, so a
 * fresh unmarked row is not littered with a line of dashes.
 *
 * Labs are excluded. The 2024 scheme models a lab's CIE as Cont/Test/Record
 * internally so the total has a shape to compute against, but the college does
 * not publish a lab's internal as discrete series marks the way a theory paper
 * does - etlab carries a single continuous-evaluation figure. Breaking a lab's
 * CIE into a per-component line would be inventing a structure the student is
 * never shown, so the breakdown is theory/project only and a lab keeps just its
 * CIE total.
 */
function CieParts(props: { course: Course; ev: Evaluation }) {
  const showsComponents = () => !(props.course.type ?? "").startsWith("LAB");
  const parts = () =>
    COURSE_TYPES[(props.course.type ?? "TH 40/60") as TypeKey].components.map((c) => {
      const raw = toOptionalFloat(props.course[c.key]);
      const short = c.header.startsWith("Series")
        ? `S${c.header.replace(/\D/g, "")}`
        : c.header.charAt(0).toUpperCase();
      return { short, header: c.header, rawMax: c.rawMax,
               mark: raw === null ? dash : String(Math.round(raw)) };
    });
  const anyMarked = () => parts().some((p) => p.mark !== dash);

  return (
    <Show when={showsComponents() && parts().length > 0 && (anyMarked() || props.ev.assessed)}>
      <div class="cie-parts"
           title={parts().map((p) => `${p.header} ${p.mark}/${p.rawMax}`).join(" · ")}>
        <For each={parts()}>{(p, i) => (
          <>
            <Show when={i() > 0}>{" · "}</Show>
            {p.short}{" "}<span class="num">{p.mark}</span>
          </>
        )}</For>
      </div>
    </Show>
  );
}

export function Ledger() {
  const [open, setOpen] = createSignal<number | null>(null);
  const toggle = (i: number) => setOpen(open() === i ? null : i);

  /**
   * Rows paired with their attendance gaps in ONE pass.
   *
   * `attendanceGaps()` is index-aligned with `rows()` by construction, and
   * indexing one from the other is named in the engine report as the way that
   * pairing breaks silently under a future filter. Zipping them here means a
   * desync would be a missing gap rather than a wrong one.
   */
  const zipped = createMemo(() => {
    const gaps = attendanceGaps();
    return rows().map((row, i) => ({ row, gap: gaps[i]! }));
  });

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
            {/* `scope="col"` on every one, including the empty last: without
                it a screen reader in table mode has to guess the association
                from position, and the guess is wrong wherever a cell holds a
                control. The last column carries the remove button and is
                deliberately unlabelled on screen, so it is named for assistive
                technology alone. */}
            <tr>
              <th class="left" scope="col">Code</th>
              <th class="left" scope="col">Course</th>
              <th scope="col">Cr</th>
              <th scope="col">CIE</th>
              <th class="left" scope="col">Attendance</th>
              <th scope="col"
                  title="CIE marks earned by attendance alone (R 7.5.ii)">Att mk</th>
              <th scope="col">ESE</th>
              <th scope="col">Total</th>
              <th scope="col">Gr</th>
              <th scope="col" title="ESE mark needed to pass">Pass</th>
              <th class="left" scope="col">Target</th>
              <th scope="col" title="ESE mark needed for the target grade">Need</th>
              <th class="left" scope="col">Status</th>
              <th scope="col"><span class="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            <For each={zipped()}>{({ row, gap }) => (
              <>
                <tr class={`row${open() === row.index ? " open" : ""}`}>
                  {/* A real `button`, not a `span` wearing `role="button"`.
                      The span handled Enter and not Space, which is half of
                      what the role it claimed promises, and it advertised no
                      state at all - so a screen reader user could open a row
                      and not be told it had opened. `button.code` in app.css
                      strips the browser chrome so this is the same drawing it
                      was. */}
                  <td class="left">
                    <button type="button" class="code num"
                            aria-expanded={open() === row.index}
                            aria-controls={`detail-${row.index}`}
                            onClick={() => toggle(row.index)}>
                      {row.course.code || "SET CODE"}
                    </button>
                  </td>
                  <td class="left title">{row.course.name || dash}</td>
                  <td class="num">{show(row.ev.credits)}</td>
                  <td class="num">
                    <Show when={row.ev.assessed}
                          fallback={<span style={{ color: "var(--text-faint)" }}>{dash}</span>}>
                      {/* An internal missing a component mark or its
                          attendance figure is a floor, not a total, and the
                          row must not print it as one. This marker asks
                          `cieFloor` - is the CIE unknown - and not whether it
                          can still move: a fully marked CIE below 85%
                          attendance is exactly today's mark, and marking it
                          would call a known number a guess. The required-mark
                          cells ask the other question. */}
                      <Show when={row.ev.cieFloor}>
                        <span class="bound" role="img" title={missingInternal(row.ev)}
                              aria-label={missingInternal(row.ev)}>≥</span>
                      </Show>
                      {show(row.ev.cie, 1)}
                      <span style={{ color: "var(--text-faint)" }}>/{row.ev.cieMax}</span>
                    </Show>
                    <CieParts course={row.course} ev={row.ev} />
                  </td>
                  <td class="left">
                    <AttendanceBar pct={row.ev.attendance} />{" "}
                    <span class="num" style={{
                      color: row.ev.attendance === null ? "var(--text-faint)"
                        : row.ev.attendance < ATTENDANCE_CONDONE ? "var(--danger)"
                        : row.ev.attendance < ATTENDANCE_MIN ? "var(--warn)" : "var(--text-dim)",
                    }}>{row.ev.attendance === null ? dash : `${row.ev.attendance.toFixed(0)}%`}</span>
                    {/* The colour on that figure is the only thing saying
                        which side of the two lines it falls, and the Status
                        column does not always repeat it: a course published
                        as I or W reads INCOMPLETE there whatever its
                        attendance, so on those rows the colour is the sole
                        carrier. Said in words for everyone who cannot see
                        it, quoting the same two constants the colour uses. */}
                    <Show when={row.ev.attendance !== null
                                && row.ev.attendance < ATTENDANCE_MIN}>
                      <span class="sr-only">
                        {row.ev.attendance! < ATTENDANCE_CONDONE
                          ? ` below the ${ATTENDANCE_CONDONE.toFixed(0)}% condonation floor`
                          : ` below the ${ATTENDANCE_MIN.toFixed(0)}% eligibility line`}
                      </span>
                    </Show>
                    {/* The counts the percentage is computed from. They existed
                        only as editable inputs inside the expanded row, so the
                        table stated a percentage on every row and showed the
                        working for none of them - and a student checking their
                        own figure had to open seven rows one at a time. */}
                    <Show when={row.course.attended !== null && row.course.held !== null}>
                      <span class="att-raw num">
                        {toOptionalFloat(row.course.attended)}/{toOptionalFloat(row.course.held)}
                      </span>
                    </Show>
                  </td>
                  <td class="num" title="CIE marks from attendance">
                    {/* `attMax`, not a literal 5. `CourseSpec.attMax` exists so
                        it can vary by course type, and constants.ts explicitly
                        instructs the next maintainer to spell out per-type
                        values - on that day a hardcoded 5 here would print
                        "4/5" for a course the engine scores out of 8. */}
                    {show(row.ev.attMarks)}
                    <span style={{ color: "var(--text-faint)" }}>
                      /{specFor(row.course.type).attMax}
                    </span>
                  </td>
                  <td>
                    <Cell value={row.course.ese}
                          label={`ESE mark, out of ${row.ev.eseMax}`}
                          onInput={(v) => updateCourse(row.index, { ese: v })}
                          placeholder={`/${row.ev.eseMax}`} />
                  </td>
                  <td class="num">{show(row.ev.total)}</td>
                  <td class={`grade${row.ev.grade === "F" ? " f" : ""}${
                    row.ev.grade === "S" || row.ev.grade === "A+" ? " top" : ""}`}>
                    {row.ev.grade ?? dash}
                  </td>
                  <td><Need need={row.ev.needPass} best={row.ev.needPassBest}
                            applies={needApplies(row.ev)} /></td>
                  <td class="left">
                    <select class="cell-input" aria-label="Target grade" value={row.ev.target}
                            onChange={(e) => updateCourse(row.index, {
                              target: e.currentTarget.value as Letter })}>
                      <For each={TARGET_CHOICES}>{(g) => <option value={g}>{g}</option>}</For>
                    </select>
                  </td>
                  <td><Need need={row.ev.needTarget} best={row.ev.needTargetBest}
                            applies={needApplies(row.ev)} /></td>
                  <td class="left">
                    <span class={`pill ${row.status.toLowerCase()}`}>{row.status}</span>
                  </td>
                  <td>
                    {/* The visible glyph IS the name unless one is given, so
                        without this a screen reader reads a row of buttons all
                        called "×". `title` does not win over text content. */}
                    <button class="del" title="Remove this subject"
                            aria-label={`Remove ${row.course.name || row.course.code || "this subject"}`}
                            onClick={() => removeCourse(row.index)}>&times;</button>
                  </td>
                </tr>
                <Show when={open() === row.index}>
                  <Detail index={row.index} course={row.course} ev={row.ev} gap={gap} />
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
