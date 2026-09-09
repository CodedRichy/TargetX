import { For, Show, createMemo, createSignal } from "solid-js";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_FULL_MARKS_PCT, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN,
  attendanceMarks, courseLabel, daywiseBySubject, monthLabel, monthsHeld,
  toOptionalFloat,
} from "../engine";
import type {
  AttendancePlan, AttendanceStatus, DaywiseDay, TimetableDay,
} from "../engine";
import { isNarrow } from "../state/platform";
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
 * A percentage written so it can never claim a line it has not reached.
 *
 * `toFixed(0)` rounds, and rounding crosses the two lines this whole screen is
 * about. At 74.5% every figure on the card printed "75%" while `plan.state`
 * stayed on the true value, so the verdict read "At 75% - below the 75% line"
 * and the ONLY thing still saying which side of eligibility the student was on
 * was the red fill. 84.5% printed "85%" beside "4 of 5 marks"; 59.5% printed
 * "60%", the condonation floor, from below it.
 *
 * Truncating to a tenth is not merely closer, it is provably consistent with
 * the decisions drawn from the same number. Every line and every R 7.5.ii mark
 * band is a whole-number `>=` floor, and truncation is monotone and fixes
 * whole numbers - so the printed figure is at or above a band exactly when
 * `current` is. Rounding has no such guarantee in either direction.
 *
 * The tenth is dropped when it is zero, so an ordinary 82% still reads "82%"
 * and the decimal appears only where it is carrying the fact.
 */
const pctText = (value: number): string => {
  const cut = Math.floor(value * 10) / 10;
  return Number.isInteger(cut) ? cut.toFixed(0) : cut.toFixed(1);
};

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
      /*
       * Exact first, and only then a substring.
       *
       * This was one substring pass, first hit wins, and a subject name that
       * is a prefix of another's is normal in a KTU semester: "Software
       * Engineering" is inside "Software Engineering Lab". Whichever the
       * portal happened to print FIRST in the day won the theory subject's
       * row - so the lab's periods were counted twice, the theory subject's
       * own period was never counted at all, and the panel then reported a
       * disagreement that existed only because of the mismatch. A panel whose
       * job is to catch one wrong day cannot invent one out of a name.
       *
       * A subject that matches nothing exactly still falls through to the
       * substring pass, because the portal's period string is not always the
       * course title verbatim - it is often the title with a room or a batch
       * suffix. What changed is only that an exact name can no longer lose to
       * a longer one that merely contains it.
       */
      const hits = (test: (key: string) => boolean) => {
        for (const [printed, tally] of log) {
          if (test(printed.toLowerCase())) return tally;
        }
        return null;
      };
      const found =
        hits((key) => (name !== "" && key === name) || (code !== "" && key === code))
        ?? hits((key) => (code !== "" && key.includes(code)) || (name !== "" && key.includes(name)));
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
          {/* Named so the phone layer can reach it. Three tables on this screen
              wear `grid-table` and they want different things at 411px: this
              one wraps, the calendar fits as it is, and only the timetable
              genuinely has to slide. */}
          <table class="grid-table recon-table">
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
                  /*
                   * Which of the two figures actually differs, said in words.
                   *
                   * This read "log says more/fewer classes" off the sign of
                   * the HELD difference alone, so the case the panel exists
                   * for - same number of classes, one of them marked absent
                   * that the student remembers attending - fell into the
                   * "fewer" branch by default and was announced as a count
                   * the log never disputed. The paragraph above the table
                   * then tells the student a gap is not worth reading as a
                   * mistake "when the log is simply shorter", so the one
                   * genuine finding was filed under the app's own known
                   * blind spot. Held and attended are two different claims
                   * and are now reported as two different claims.
                   */
                  const disagreement = () => {
                    const heldGap = logged.held - (r.storedHeld ?? 0);
                    if (heldGap !== 0) {
                      const n = Math.abs(heldGap);
                      return `log has ${n} ${heldGap > 0 ? "more" : "fewer"} `
                        + `class${n === 1 ? "" : "es"}`;
                    }
                    // Same classes, different verdict on them: the log and the
                    // portal disagree about attendance, not about the timetable.
                    const attGap = logged.attended - (r.storedAttended ?? 0);
                    const n = Math.abs(attGap);
                    return `same classes, log marks ${n} `
                      + `${attGap > 0 ? "more attended" : "fewer attended"}`;
                  };
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
                            <span class="pill shortage">{disagreement()}</span>
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
        {/*
         * The same week, one day at a time, once the layout is narrow.
         *
         * Five days x eight periods is not a phone layout at any font size.
         * The grid used to keep its 820px floor here and slide inside a
         * 411px frame, which showed a student three of eight periods and hid
         * the rest behind a horizontal drag they had no reason to guess at -
         * and the app's standing rule is that nothing scrolls sideways.
         *
         * The alternative to a scroller is not a smaller grid. Squeezing
         * eight subject names into 411px means truncating them, and a
         * timetable that says "Design and A..." twice in a row has lost the
         * only thing it was drawn to say. So the axis that costs least is
         * dropped: a student looking at a phone wants today, and the day
         * selector is one tap away from any of the other four. No period,
         * subject or teacher leaves the screen - only the four days the
         * student is not currently reading.
         *
         * `isNarrow` and not CSS alone, because this is a different set of
         * elements and not a restyling of the same ones: CSS can hide a
         * table, it cannot turn one into a list with its own selected-day
         * state. Desktop keeps the grid, untouched.
         */}
        <Show when={isNarrow()} fallback={
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
        }>
          <TimetableDayList days={grid()} cols={cols()} />
        </Show>

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

/** Weekday names, indexed the way `Date.getDay` numbers them. */
const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/**
 * Whether two day names name the same weekday.
 *
 * The day label is whatever etlab's template printed - "Monday" on the portal
 * this parser was written against, but the same cell reads "Mon" on another
 * college's skin of the same software, and the parser passes it through
 * verbatim rather than inventing a canonical form. Three case-folded letters
 * is the shortest form any English weekday is ever written in and is still
 * unique across all seven, so it is the widest comparison that cannot be
 * wrong. A day this fails to recognise costs the default selection, not the
 * day itself - it is still in the selector.
 */
const sameWeekday = (a: string, b: string): boolean =>
  a.trim().slice(0, 3).toLowerCase() === b.trim().slice(0, 3).toLowerCase();

/**
 * The weekly timetable as one day at a time: the phone form of the grid.
 *
 * `cols` is the parent's period count, not `day.periods.length`, deliberately.
 * A row that parsed short would otherwise show six periods where the week has
 * eight, and a missing slot at the end of the list is indistinguishable from a
 * day that ends early - the student would read "no class after period 6" off
 * a parse gap. Every slot up to the week's width is drawn, and an empty one
 * says so in words.
 */
function TimetableDayList(props: { days: TimetableDay[]; cols: number }) {
  /*
   * The pick is held as the day's NAME, not its index into the grid.
   * A re-sync replaces the whole grid, and a college that publishes a
   * six-day week for one term and five for the next would leave an index
   * pointing at a different day than the one the student tapped - silently,
   * which is the only kind of wrong this app treats as unacceptable.
   */
  const [picked, setPicked] = createSignal<string | null>(null);

  const selected = createMemo<TimetableDay | null>(() => {
    const days = props.days;
    const chosen = picked();
    const held = chosen === null ? undefined : days.find((d) => d.day === chosen);
    if (held) return held;
    // Today, when today is one of the days on the timetable. A student opening
    // this on a Sunday gets the first row - Monday, as the portal orders it -
    // because the alternative is an empty screen on the two days of the week
    // when the question "what is on tomorrow" is most likely being asked.
    const today = WEEKDAY_NAMES[new Date().getDay()]!;
    return days.find((d) => sameWeekday(d.day, today)) ?? days[0] ?? null;
  });

  return (
    <div class="tt-phone">
      {/*
       * Real buttons in a labelled group, and `aria-pressed` rather than
       * `aria-current`: these five are a set of states of one view, only one
       * of which is on, which is what pressed means. `aria-current` would say
       * "this is the day you are on in a sequence of days", which is a claim
       * about the calendar and not about this control.
       */}
      <div class="tt-days" role="group" aria-label="Day of the week">
        <For each={props.days}>
          {(day) => (
            <button
              type="button"
              class="tt-day"
              aria-pressed={selected()?.day === day.day}
              onClick={() => setPicked(day.day)}
            >
              {/* Three letters is all 411px has room for across five days.
                  The full name is still announced, so a screen reader hears
                  "Wednesday" and not "Wed". */}
              <span aria-hidden="true">{day.day.trim().slice(0, 3)}</span>
              <span class="sr-only">{day.day}</span>
            </button>
          )}
        </For>
      </div>

      <Show when={selected()}>
        {(day) => (
          /* An ordered list because the order is the fact: period 3 follows
             period 2. The name changes with the day so the list does not
             announce itself as the same thing after a tap. */
          <ol class="tt-list" aria-label={`${day().day}, period by period`}>
            <For each={Array.from({ length: props.cols })}>
              {(_, i) => {
                const period = () => day().periods[i()];
                return (
                  <li class="tt-slot">
                    <span class="tt-slot-no" aria-hidden="true">P{i() + 1}</span>
                    <span class="sr-only">Period {i() + 1}</span>
                    <span class="tt-slot-body">
                      <Show when={period()?.subject} fallback={
                        /* "Free period", not the grid's em dash. A dash in a
                           cell of a grid reads as empty; a dash on its own
                           line in a list reads as missing data. */
                        <span class="tt-empty">Free period</span>
                      }>
                        <span class="tt-subject">{period()!.subject}</span>
                        <Show when={period()!.teacher}>
                          <span class="tt-teacher">{period()!.teacher}</span>
                        </Show>
                      </Show>
                    </span>
                  </li>
                );
              }}
            </For>
          </ol>
        )}
      </Show>
    </div>
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
    `Attendance ${pctText(pct())}%. Eligibility line ${ATTENDANCE_MIN}%. `
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
        <span class="num">{pctText(pct())}%</span>
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
          {(p) => <span class="tile-note num">{pctText(p().current)}%</span>}
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
                  <>At {pctText(p().current)}% there is no way back above{" "}
                    {ATTENDANCE_MIN}% this semester.</>
                }>
                  At <strong class="num">{pctText(p().current)}%</strong> — below the{" "}
                  {ATTENDANCE_MIN}% line. Attend the next{" "}
                  <strong class="num">{p().attend}</strong> without missing one to get back.
                </Show>
                {/*
                 * The second line, which this screen was drawing nothing for.
                 *
                 * A card at 30% and a card at 74% were the same card: same
                 * red, same "below the 75% line", same "attend N in a row to
                 * get back" - and at 30% that N was 360, an arithmetic fact
                 * offered as a plan. But the two are not the same situation.
                 * Above 60% a shortage is a fee and a form; below it R 6.2
                 * gives no appeal at all, and a student reading a recovery
                 * count has no way to tell which of those they are in. The
                 * engine already knows - `ATTENDANCE_CONDONE` is the line
                 * `isDebarred` is drawn from - and the recovery number stays
                 * on screen because it is still true and still what they must
                 * do; it is now said next to what it cannot fix on its own.
                 */}
                <Show when={p().current < ATTENDANCE_CONDONE}>
                  {" "}Also below the <strong class="num">{ATTENDANCE_CONDONE}%</strong>{" "}
                  floor R 6.2 lets the Principal condone — under that line there
                  is no appeal, so getting back over it is the first thing this
                  count has to buy.
                </Show>
              </p>
            }>
              <p class="tile-verdict">
                At <strong class="num">{pctText(p().current)}%</strong>. Miss more than{" "}
                <strong class="num">{p().skip}</strong> and you drop below {ATTENDANCE_MIN}%.
              </p>
            </Show>
          </>
        )}
      </Show>
    </article>
  );
}
