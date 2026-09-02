import { For, Show, createMemo, createSignal } from "solid-js";
import {
  ATTENDANCE_FULL_MARKS_PCT, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN,
  attendanceMarks, courseLabel, daywiseBySubject, monthLabel, monthsHeld,
  toOptionalFloat,
} from "../engine";
import type {
  AttendancePlan, AttendanceStatus, DaywiseDay, TimetableDay,
} from "../engine";
import { rows, state } from "../state/store";
import { setView } from "../state/nav";

/**
 * Attendance.
 *
 * The one screen that answers "how many classes can I still miss?" for every
 * subject at once, drawn rather than tabulated. The engine has already solved
 * both directions - `attendancePlan.skip` is the room above the 75% line,
 * `attendancePlan.attend` is the consecutive run back to it - so nothing here
 * recomputes a percentage; it only surfaces what the plan already carries.
 *
 * A subject with no attended/held on record is shown as "not recorded" rather
 * than as 0% or 100%: a blank field is absence of data, not a full or empty
 * house, and inventing either is the exact lie the rest of the app refuses to
 * tell.
 */

/** A subject's attendance standing, ready to render. */
interface Line {
  index: number;
  /** The subject as the student knows it. See `courseLabel`. */
  label: string;
  plan: AttendancePlan | null;
  /**
   * The counts every other figure on the card is derived from.
   *
   * They were only ever reachable as editable inputs inside one expanded
   * Ledger row, so this screen stated a percentage and a miss budget and never
   * showed the two numbers behind them - an app whose whole position is that
   * it never states a number it cannot show its working for, not showing the
   * working for its loudest number.
   */
  attended: number | null;
  held: number | null;
}

export function Attendance() {
  const lines = createMemo<Line[]>(() =>
    rows().map((row) => ({
      index: row.index,
      label: courseLabel(row.course),
      plan: row.ev.plan,
      attended: toOptionalFloat(row.course.attended),
      held: toOptionalFloat(row.course.held),
    })));

  return (
    <div class="screen attendance">
      <div class="screen-head">
        <div>
          <h2>How many classes can you miss?</h2>
          <p class="lede">
            {state.activeSemester} · the room you have above the {ATTENDANCE_MIN}%
            eligibility line, per subject. The meter marks both lines that
            matter: {ATTENDANCE_MIN}% to sit the exam, and{" "}
            {ATTENDANCE_FULL_MARKS_PCT}% to stop losing internal marks.
          </p>
        </div>
      </div>

      <Show when={lines().length > 0} fallback={
        <div class="tile empty-home">
          <h3>No subjects yet</h3>
          <p class="lede">
            Add this semester's subjects with their attended and held classes,
            and each one turns into a miss budget you can read at a glance.
          </p>
          <div class="setup-actions">
            <button class="primary" onClick={() => setView("ledger")}>Open the semester</button>
          </div>
        </div>
      }>
        <div class="cards attendance-list">
          <For each={lines()}>{(line) => <SubjectCard line={line} />}</For>
        </div>
      </Show>

      <BySubjectSection />
      <CalendarSection />
      <TimetableSection />
    </div>
  );
}

/**
 * How each status is drawn and named.
 *
 * The `cls` collapses the eight parsed statuses onto the five the eye needs:
 * the three excused variants (on duty, duty leave, duty) share one "credited"
 * colour because they are one fact - the class ran and did not count - and
 * "none" (a period with no class) sits with the inert states. `word` is the
 * spelled-out status for the cell's tooltip, so the meaning colour carries is
 * also available to a pointer and a screen reader, not colour alone.
 */
/**
 * `glyph` is what keeps this grid readable without colour.
 *
 * The blocks were empty divs distinguished only by hue, and the three that
 * matter are close in lightness on both themes - dark --good L0.76, --warn
 * L0.80, --danger L0.73 - so under a red-green deficiency they collapse into
 * three identical squares. The shape carries the meaning; the colour reinforces
 * it. The Ledger already solved this two files away and the pattern was simply
 * not applied here.
 */
const STATUS_META: Record<AttendanceStatus, { cls: string; word: string; glyph: string }> = {
  present:   { cls: "present",  word: "Present",    glyph: "·" },
  absent:    { cls: "absent",   word: "Absent",     glyph: "×" },
  od:        { cls: "credited", word: "On duty",    glyph: "~" },
  dutyleave: { cls: "credited", word: "Duty leave", glyph: "~" },
  duty:      { cls: "credited", word: "Duty",       glyph: "~" },
  leave:     { cls: "leave",    word: "Leave",      glyph: "~" },
  holiday:   { cls: "holiday",  word: "Holiday",    glyph: "" },
  none:      { cls: "none",     word: "No class",   glyph: "" },
};

/**
 * The day-by-day per-period calendar.
 *
 * A heatmap of every period the portal has a status for, one row per day and
 * one column per period. Nothing here recomputes attendance; it draws what the
 * portal recorded, coloured so a run of absences is visible at a glance. When
 * the page was never synced the whole thing is one quiet line, never an empty
 * grid pretending the student has perfect attendance.
 */
/**
 * The day-by-day record, rolled up per subject and checked against the counts
 * the portal published.
 *
 * Two independent figures for the same fact: what the period log says happened,
 * and what the subject page says the totals are. They should agree. When they
 * do not, one of them is wrong and the student is the only person who can say
 * which - so the app states the disagreement rather than silently preferring
 * the number it happens to store.
 *
 * Subjects are matched from the portal's printed period string back to the
 * student's own courses; anything that matches nothing is left out rather than
 * shown under a name they would not recognise.
 */
function BySubjectSection() {
  /**
   * Every day the archive holds, oldest month first (issue #13).
   *
   * This comparison used to run on the last pull alone, which is one month -
   * against a portal total that covers the whole semester. So it reported "log
   * says fewer classes" on every row of every subject, every time, and a panel
   * whose job is to catch a wrongly marked absence was instead crying wolf on
   * all of them. With months kept rather than overwritten it can add up what
   * the app has actually seen.
   */
  const allDays = createMemo<DaywiseDay[]>(() => {
    const archive = state.daywiseMonths;
    const keys = monthsHeld(archive).reverse();
    if (keys.length === 0) return state.daywiseAttendance ?? [];
    return keys.flatMap((key) => archive?.[key] ?? []);
  });

  const monthCount = createMemo(() => monthsHeld(state.daywiseMonths).length);

  const counted = createMemo(() => {
    const log = daywiseBySubject(allDays());
    if (log.size === 0) return [];
    return rows().map((row) => {
      const code = (row.course.code ?? "").trim().toLowerCase();
      const name = courseLabel(row.course).trim().toLowerCase();
      let found: { attended: number; held: number } | null = null;
      for (const [printed, tally] of log) {
        const key = printed.toLowerCase();
        if ((code !== "" && key.includes(code)) || (name !== "" && key.includes(name))) {
          found = tally;
          break;
        }
      }
      return {
        label: courseLabel(row.course),
        logged: found,
        storedAttended: toOptionalFloat(row.course.attended),
        storedHeld: toOptionalFloat(row.course.held),
      };
    }).filter((r) => r.logged !== null);
  });

  return (
    <Show when={counted().length > 0}>
      <section class="schedule-section" aria-labelledby="bysub-heading">
        <div class="schedule-head">
          <div>
            <h3 id="bysub-heading">Counted from the day-by-day record</h3>
            <p class="schedule-sub">
              What the period log adds up to, per subject, beside the totals the
              portal published.
              {" "}
              {/* Said before the table rather than after it. The log covers the
                  months TargetX has synced, and the portal total covers the
                  whole semester - so until those are the same span a gap here
                  is the app's own blind spot and not a portal error, and a
                  student should know that before reading a row as a mistake. */}
              <Show when={monthCount() > 0} fallback={
                <>They should agree — where they do not, one of them is wrong.</>
              }>
                The log covers the{" "}
                <Show when={monthCount() === 1} fallback={
                  <><span class="num">{monthCount()}</span> months</>
                }>one month</Show>{" "}
                TargetX has synced, so it only matches the portal once that is
                the whole semester. A gap is worth reading as a mistake when the
                months line up and one day is off, not when the log is simply
                shorter.
              </Show>
            </p>
          </div>
        </div>

        <div class="grid-frame">
          <table class="grid-table">
            <thead>
              <tr>
                <th class="grid-label" scope="col">Subject</th>
                <th scope="col">From the log</th>
                <th scope="col">Portal total</th>
                <th class="left" scope="col">Agreement</th>
              </tr>
            </thead>
            <tbody>
              <For each={counted()}>
                {(r) => {
                  const logged = r.logged!;
                  const agrees = () =>
                    r.storedAttended !== null && r.storedHeld !== null
                    && logged.attended === r.storedAttended
                    && logged.held === r.storedHeld;
                  const known = () =>
                    r.storedAttended !== null && r.storedHeld !== null;
                  return (
                    <tr>
                      <th class="grid-label left" scope="row">{r.label}</th>
                      <td class="num">{logged.attended}/{logged.held}</td>
                      <td class="num">
                        {known() ? `${r.storedAttended}/${r.storedHeld}` : "–"}
                      </td>
                      <td class="left">
                        <Show when={known()} fallback={
                          <span class="dim">no published total to compare</span>
                        }>
                          <Show when={agrees()} fallback={
                            <span class="pill shortage">
                              log says {logged.held - (r.storedHeld ?? 0) > 0 ? "more" : "fewer"} classes
                            </span>
                          }>
                            <span class="pill safe">matches</span>
                          </Show>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </div>
      </section>
    </Show>
  );
}

function CalendarSection() {
  /**
   * Issue #13: the month being looked at, not just the month last synced.
   *
   * A wrongly marked absence is found by looking back at a day you remember
   * being in class, and until now every sync overwrote the grid - so the month
   * a student wanted was the one the app had just thrown away. The archive
   * keeps each month it has seen; this picks between them.
   *
   * The choice is a signal rather than stored state. It is a place in a record
   * being read, like a scroll position, not a preference: reopening the app
   * should show the current month, which is the one that is still changing.
   */
  const months = createMemo(() => monthsHeld(state.daywiseMonths));
  const [picked, setPicked] = createSignal<string | null>(null);

  // Newest held month when nothing is picked, and also whenever the pick has
  // gone - a chosen month can disappear if the record is reset underneath.
  const month = createMemo(() => {
    const chosen = picked();
    const held = months();
    return chosen && held.includes(chosen) ? chosen : held[0] ?? null;
  });

  const days = createMemo<DaywiseDay[]>(() => {
    const key = month();
    if (key) return state.daywiseMonths?.[key] ?? [];
    // No archive yet - a record synced by an older build, or a portal whose
    // page carries no dates. The last pull is still worth showing.
    return state.daywiseAttendance ?? [];
  });
  // Every day has the same number of periods after parsing, but a defensive max
  // keeps the header honest if a short row ever slips through.
  const cols = createMemo(() =>
    Math.max(8, ...days().map((d) => d.periods.length), 0) || 8);
  const headers = createMemo(() => Array.from({ length: cols() }, (_, i) => i + 1));

  return (
    <section class="schedule-section" aria-labelledby="cal-heading">
      <div class="schedule-head">
        <div>
          <h3 id="cal-heading">Your attendance, day by day</h3>
          <p class="schedule-sub">
            Every period the portal has on record, coloured by status. A green
            block is a class you attended; red is one you missed; amber is an
            excused class that never counts against you.
          </p>
        </div>

        {/* Only once there are two. A switcher over a single month is a
            control that cannot do anything, and it would appear on the very
            first sync - when the archive has nothing to switch to yet. */}
        <Show when={months().length > 1}>
          <nav class="cal-months" aria-label="Month">
            <For each={months()}>{(key) => (
              <button class="pill cal-month" aria-current={month() === key}
                      onClick={() => setPicked(key)}>{monthLabel(key)}</button>
            )}</For>
          </nav>
        </Show>
      </div>

      {/* Said in words, not only by which pill is lit: the grid's own rows are
          labelled "1st", "6th" and name no month, so a student reading a
          screenshot of it has no way to tell September from October. */}
      <Show when={month()}>{(key) => (
        <p class="cal-month-note">
          Showing <strong>{monthLabel(key())}</strong>.{" "}
          <Show when={months().length === 1}
                fallback={<>TargetX keeps every month it has synced.</>}>
            Past months appear here as they are synced - the portal serves one
            month at a time, so TargetX can keep the months it sees but cannot
            reach back for ones it never did.
          </Show>
        </p>
      )}</Show>

      <Show when={days().length > 0} fallback={
        <p class="schedule-empty">Sync to see your day-by-day attendance.</p>
      }>
        {/* Not aria-hidden. It was, which meant the only explanation of what
            the grid's colours mean was hidden from the readers least able to
            infer it from the colours. */}
        <div class="cal-legend">
          <span><i class="cal-swatch present" aria-hidden="true" />Present</span>
          <span><i class="cal-swatch absent" aria-hidden="true" />Absent</span>
          <span><i class="cal-swatch credited" aria-hidden="true" />Credited (on duty / duty leave)</span>
          <span><i class="cal-swatch leave" aria-hidden="true" />Leave</span>
          <span><i class="cal-swatch holiday" aria-hidden="true" />Holiday / no class</span>
        </div>

        <div class="grid-frame">
          <div class="grid-scroll">
            <table class="grid-table cal-table">
              <thead>
                <tr>
                  <th class="grid-label" scope="col">Day</th>
                  <For each={headers()}>
                    {(n) => <th scope="col">P{n}</th>}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={days()}>
                  {(day) => (
                    <tr>
                      <th class="grid-label" scope="row">{day.label}</th>
                      <For each={Array.from({ length: cols() })}>
                        {(_, i) => {
                          const period = () => day.periods[i()];
                          const meta = () =>
                            STATUS_META[period()?.status ?? "none"];
                          const title = () => {
                            const p = period();
                            if (!p) return "No class";
                            return p.subject
                              ? `${meta().word} — ${p.subject}`
                              : meta().word;
                          };
                          return (
                            <td class="cal-cell">
                              {/* `title` is hover-only: unreachable by keyboard,
                                  unreliable on a td for screen readers, and
                                  invisible on touch. It stays for the pointer,
                                  and the status is also stated in text. */}
                              <div class={`cal-block ${meta().cls}`} title={title()}>
                                <span aria-hidden="true">{meta().glyph}</span>
                                <span class="sr-only">{title()}</span>
                              </div>
                            </td>
                          );
                        }}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>
      </Show>
    </section>
  );
}

/**
 * The weekly timetable, with any substitutions below it.
 *
 * The plan the calendar above is measured against: which subject each period is
 * meant to be, and who teaches it. Substitutions are the exceptions the portal
 * publishes for the week - listed only when there are any, so a normal week
 * shows a clean grid and nothing more.
 */
function TimetableSection() {
  const grid = createMemo<TimetableDay[]>(() => state.timetable?.grid ?? []);
  const subs = createMemo(() => state.timetable?.substitutions ?? []);
  const cols = createMemo(() =>
    Math.max(8, ...grid().map((d) => d.periods.length), 0) || 8);
  const headers = createMemo(() => Array.from({ length: cols() }, (_, i) => i + 1));

  return (
    <section class="schedule-section" aria-labelledby="tt-heading">
      <div class="schedule-head">
        <div>
          <h3 id="tt-heading">Your weekly timetable</h3>
          <p class="schedule-sub">
            What each period is scheduled to be, day by day. Any changes the
            portal has published for the week are listed underneath.
          </p>
        </div>
      </div>

      <Show when={grid().length > 0} fallback={
        <p class="schedule-empty">Sync to see your weekly timetable.</p>
      }>
        <div class="grid-frame">
          <div class="grid-scroll">
            <table class="grid-table tt-table">
              <thead>
                <tr>
                  <th class="grid-label" scope="col">Day</th>
                  <For each={headers()}>
                    {(n) => <th scope="col">Period {n}</th>}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={grid()}>
                  {(day) => (
                    <tr>
                      <th class="grid-label" scope="row">{day.day}</th>
                      <For each={Array.from({ length: cols() })}>
                        {(_, i) => {
                          const period = () => day.periods[i()];
                          return (
                            <td class="tt-cell">
                              <Show when={period()?.subject} fallback={
                                <span class="tt-empty">—</span>
                              }>
                                <span class="tt-subject">{period()!.subject}</span>
                                <Show when={period()!.teacher}>
                                  <span class="tt-teacher">{period()!.teacher}</span>
                                </Show>
                              </Show>
                            </td>
                          );
                        }}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </div>

        <Show when={subs().length > 0}>
          <div class="tt-subs">
            <h4>Changes this week</h4>
            <For each={subs()}>
              {(sub) => (
                <div class="tt-sub-row">
                  <span class="tt-sub-when">
                    {sub.date}{sub.period ? ` · Period ${sub.period}` : ""}
                  </span>
                  <span class="tt-sub-body">
                    <strong>{sub.teacher || "A teacher"}</strong>
                    {sub.inPlaceOf ? <> in place of <strong>{sub.inPlaceOf}</strong></> : null}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}

/** One subject: its standing, the headline number, and the strip. */
/**
 * Where a percentage stands against KTU's two attendance lines, drawn once.
 *
 * The two lines are the point. `ATTENDANCE_MIN` (75) is eligibility - below it
 * the exam cannot be sat - and `ATTENDANCE_FULL_MARKS_PCT` (85) is where R
 * 7.5.ii finally pays all five internal marks. The band between them is the
 * figure this whole app exists to surface: a student sitting at 78% is
 * "fine" by the only number their college quotes them, and is losing internal
 * marks every week for it.
 *
 * Rendered as one `role="img"` with a written label rather than as bare divs,
 * because the meter carries a fact and a screen reader must get the fact, not
 * a decorative strip. Nothing here computes a figure: `current` arrives from
 * the engine, and where it is unknown the caller does not render a meter.
 */
function ThresholdMeter(props: { current: number }) {
  const pct = () => Math.max(0, Math.min(100, props.current));
  const tone = () => (
    pct() >= ATTENDANCE_FULL_MARKS_PCT ? "" :
    pct() >= ATTENDANCE_MIN ? " warn" : " bad"
  );
  /** What R 7.5.ii pays at this percentage. Engine-computed, never guessed. */
  const earned = () => attendanceMarks(pct()) ?? 0;
  const label = () =>
    `Attendance ${pct().toFixed(0)}%. Eligibility line ${ATTENDANCE_MIN}%. `
    + `Full internal marks from ${ATTENDANCE_FULL_MARKS_PCT}%. `
    + `Currently earning ${earned()} of ${ATTENDANCE_MARK_MAX} attendance marks.`;

  return (
    <div class="meter">
      <div class="meter-track" role="img" aria-label={label()}>
        {/* The bleed zone: eligible, but not earning full marks. */}
        <span class="meter-band" style={{
          left: `${ATTENDANCE_MIN}%`,
          width: `${ATTENDANCE_FULL_MARKS_PCT - ATTENDANCE_MIN}%`,
        }} />
        <span class={`meter-fill${tone()}`} style={{ "inline-size": `${pct()}%` }} />
        <span class="meter-mark" style={{ left: `${ATTENDANCE_MIN}%` }} />
        <span class="meter-mark strong" style={{ left: `${ATTENDANCE_FULL_MARKS_PCT}%` }} />
      </div>
      {/* The right end prices the position in the unit that actually moves the
          student's grade. Repeating the 85% constant on every card said the
          same thing seven times on one screen; what differs per subject - and
          what no other calculator shows - is how many of the five R 7.5.ii
          marks this attendance is currently earning. */}
      <div class="meter-ends">
        <span class="num">{pct().toFixed(0)}%</span>
        <span>
          <strong class="num">{earned()}</strong> of {ATTENDANCE_MARK_MAX} marks
        </span>
      </div>
    </div>
  );
}

function SubjectCard(props: { line: Line }) {
  const plan = () => props.line.plan;

  return (
    <article class="card att-card">
      <div class="tile-head">
        <h3>{props.line.label}</h3>
        <Show when={plan()} fallback={<span class="tile-note dim">not recorded</span>}>
          {(p) => <span class="tile-note num">{p().current.toFixed(0)}%</span>}
        </Show>
      </div>

      {/* The working for the percentage beside it. Deliberately does NOT repeat
          the percentage - it is one line up, and saying it twice would make the
          counts read as a second opinion rather than as the source. */}
      <Show when={props.line.attended !== null && props.line.held !== null}>
        <p class="att-counts num">
          {props.line.attended} of {props.line.held} attended
          <Show when={(plan()?.dlCredited ?? 0) > 0}>
            {" · "}{plan()!.dlCredited} duty leave credited
          </Show>
          <Show when={(plan()?.dlWasted ?? 0) > 0}>
            {" · "}<span class="dim">{plan()!.dlWasted} over the cap</span>
          </Show>
        </p>
      </Show>

      <Show when={plan()} fallback={
        <p class="tile-verdict dim">
          No attended and held classes on record for this subject, so there is no
          miss budget to show.
        </p>
      }>
        {(p) => (
          <>
            <Show when={p().state === "surplus"} fallback={
              <div class="hero-number tight">
                <Show when={p().attend !== null} fallback={
                  <span class="huge num dim">–</span>
                }>
                  <span class="huge num">{p().attend}</span>
                  <span class="hero-unit">
                    class{p().attend === 1 ? "" : "es"} in a row to recover
                  </span>
                </Show>
              </div>
            }>
              <div class="hero-number tight">
                <span class="huge num">{p().skip}</span>
                <span class="hero-unit">
                  more class{p().skip === 1 ? "" : "es"} you can miss
                </span>
              </div>
            </Show>

            {/* One glyph, both lines, every state - replacing the two pip
                strips that differed only by hue. */}
            <ThresholdMeter current={p().current} />

            <Show when={p().state === "surplus"} fallback={
              <p class="tile-verdict bad">
                <Show when={p().attend !== null} fallback={
                  <>At {p().current.toFixed(0)}% there is no way back above{" "}
                    {ATTENDANCE_MIN}% this semester.</>
                }>
                  At <strong class="num">{p().current.toFixed(0)}%</strong> — below the{" "}
                  {ATTENDANCE_MIN}% line. Attend the next{" "}
                  <strong class="num">{p().attend}</strong> without missing one to get back.
                </Show>
              </p>
            }>
              <p class="tile-verdict">
                At <strong class="num">{p().current.toFixed(0)}%</strong>. Miss more than{" "}
                <strong class="num">{p().skip}</strong> and you drop below {ATTENDANCE_MIN}%.
              </p>
            </Show>
          </>
        )}
      </Show>
    </article>
  );
}
