import { For, Show, createMemo } from "solid-js";
import { ATTENDANCE_MIN, courseLabel } from "../engine";
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

/**
 * Missable / recoverable classes drawn as a strip.
 *
 * The count in words is the load-bearing fact; the strip is a glance. Capped so
 * a subject with forty classes of room does not draw a hundred-pixel ribbon -
 * the headline number stays exact and the overflow is stated in words. The
 * strip itself is `aria-hidden`, because the same number is announced in the
 * heading beside it and a screen reader counting pips would only repeat it.
 */
const MAX_PIPS = 30;

/** A subject's attendance standing, ready to render. */
interface Line {
  index: number;
  /** The subject as the student knows it. See `courseLabel`. */
  label: string;
  plan: AttendancePlan | null;
}

export function Attendance() {
  const lines = createMemo<Line[]>(() =>
    rows().map((row) => ({
      index: row.index,
      label: courseLabel(row.course),
      plan: row.ev.plan,
    })));

  return (
    <div class="screen attendance">
      <div class="screen-head">
        <div>
          <h2>How many classes can you miss?</h2>
          <p class="lede">
            {state.activeSemester} · the room you have above the {ATTENDANCE_MIN}%
            eligibility line, per subject. A full strip is a class you can still
            skip; an empty one is a class you owe.
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
const STATUS_META: Record<AttendanceStatus, { cls: string; word: string }> = {
  present:   { cls: "present",  word: "Present" },
  absent:    { cls: "absent",   word: "Absent" },
  od:        { cls: "credited", word: "On duty" },
  dutyleave: { cls: "credited", word: "Duty leave" },
  duty:      { cls: "credited", word: "Duty" },
  leave:     { cls: "leave",    word: "Leave" },
  holiday:   { cls: "holiday",  word: "Holiday" },
  none:      { cls: "none",     word: "No class" },
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
function CalendarSection() {
  const days = createMemo<DaywiseDay[]>(() => state.daywiseAttendance ?? []);
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
      </div>

      <Show when={days().length > 0} fallback={
        <p class="schedule-empty">Sync to see your day-by-day attendance.</p>
      }>
        <div class="cal-legend" aria-hidden="true">
          <span><i class="cal-swatch present" />Present</span>
          <span><i class="cal-swatch absent" />Absent</span>
          <span><i class="cal-swatch credited" />Credited (on duty / duty leave)</span>
          <span><i class="cal-swatch leave" />Leave</span>
          <span><i class="cal-swatch holiday" />Holiday / no class</span>
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
                              <div class={`cal-block ${meta().cls}`} title={title()} />
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
function SubjectCard(props: { line: Line }) {
  const plan = () => props.line.plan;

  // How many pips the strip draws, and whether the true count overran the cap.
  const budget = () => {
    const p = plan();
    if (p === null) return 0;
    return p.state === "surplus" ? p.skip : (p.attend ?? 0);
  };
  const shown = () => Math.min(budget(), MAX_PIPS);
  const overflow = () => Math.max(0, budget() - MAX_PIPS);

  return (
    <article class="card att-card">
      <div class="tile-head">
        <h3>{props.line.label}</h3>
        <Show when={plan()} fallback={<span class="tile-note dim">not recorded</span>}>
          {(p) => <span class="tile-note num">{p().current.toFixed(0)}%</span>}
        </Show>
      </div>

      <Show when={plan()} fallback={
        <p class="tile-verdict dim">
          No attended and held classes on record for this subject, so there is no
          miss budget to show.
        </p>
      }>
        {(p) => (
          <Show when={p().state === "surplus"} fallback={
            <>
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
              <Show when={shown() > 0}>
                <div class="att-pips" aria-hidden="true">
                  <For each={Array.from({ length: shown() })}>
                    {() => <span class="att-pip recover"></span>}
                  </For>
                </div>
              </Show>
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
            </>
          }>
            <div class="hero-number tight">
              <span class="huge num">{p().skip}</span>
              <span class="hero-unit">
                more class{p().skip === 1 ? "" : "es"} you can miss
              </span>
            </div>
            <Show when={shown() > 0} fallback={
              <p class="fineprint">No room to spare — the next miss drops you under {ATTENDANCE_MIN}%.</p>
            }>
              <div class="att-pips" aria-hidden="true">
                <For each={Array.from({ length: shown() })}>
                  {() => <span class="att-pip miss"></span>}
                </For>
              </div>
              <Show when={overflow() > 0}>
                <p class="fineprint">+{overflow()} more not shown</p>
              </Show>
            </Show>
            <p class="tile-verdict">
              At <strong class="num">{p().current.toFixed(0)}%</strong>. Miss more than{" "}
              <strong class="num">{p().skip}</strong> and you drop below {ATTENDANCE_MIN}%.
            </p>
          </Show>
        )}
      </Show>
    </article>
  );
}
