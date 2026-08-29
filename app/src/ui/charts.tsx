import { For, Show, createMemo, createSignal, onCleanup } from "solid-js";
import { ATTENDANCE_CONDONE, ATTENDANCE_MIN } from "../engine";

/**
 * Charts, hand-rolled in SVG.
 *
 * A charting library was the obvious call and was rejected: the three views
 * here are a line, a gauge and a scatter, all of which are a dozen lines of
 * path maths, and pulling in a library would cost ~300KB to render someone
 * else's default styling. Owning the SVG means the thresholds that matter -
 * 75% eligibility, 60% condonation, the target line - are drawn as first-class
 * marks rather than bolted on as annotations.
 */

const fmt = (n: number, places = 2) => n.toFixed(places);

/**
 * The chart's own width in CSS pixels, measured rather than assumed.
 *
 * Every chart here was `viewBox="0 0 300 130" width="100%"`, which does not
 * mean "fill the width" - it means "scale everything by container/300". In the
 * 784px-wide Trend tile on Home that made the chart 340px TALL, with its 8px
 * axis labels drawn at 21px and its hairlines at 2.6px: the single largest
 * block on the screen, and the reason Home overflowed its scroller by 519px at
 * 1280x800. The same chart in the 324px drawer rendered its labels at 7.4px.
 * The drawing was only ever correct at exactly 300px wide.
 *
 * Measuring instead pins one CSS pixel to one user unit, so the height is a
 * constant, the type is the size it says it is, and a wider tile buys more
 * horizontal room for the data rather than a bigger picture of it.
 *
 * The fallback matters: `ResizeObserver` does not exist in jsdom, and a chart
 * that renders nothing under test is a chart whose tests prove nothing.
 */
function useWidth(fallback = 300) {
  const [width, setWidth] = createSignal(fallback);
  const attach = (el: HTMLElement) => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const measured = Math.round(entries[0]?.contentRect.width ?? 0);
      // A zero arrives whenever the element is display:none - a collapsed
      // drawer, a hidden tab. Taking it would divide the scales by nothing.
      if (measured > 0) setWidth(measured);
    });
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  };
  return [width, attach] as const;
}

// --- SGPA trend ------------------------------------------------------------

/**
 * One published semester on the trend line.
 *
 * `credits` is the weight the running CGPA divides by, and it is whatever
 * `historyCredits` returned rather than a raw field off `SemesterHistory`, so
 * the line behind the bars is weighted exactly like the real CGPA. Three
 * cases, and the third is the one an earlier version of this comment left
 * out: registered credits; the earned total where a save predates the split;
 * and ZERO where the save knows neither. A zero-weight semester still draws
 * its bar at full height - the SGPA is real and was really earned - while
 * contributing nothing to the line, so the two disagree on purpose. The
 * History notice is where that is explained; nothing here can say it.
 */
interface TrendPoint { name: string; sgpa: number; credits: number }

/**
 * Semester-by-semester SGPA, with the running CGPA behind it.
 *
 * The CGPA line is the point of the chart. A student reads a single bad
 * semester as a catastrophe; seeing it barely move the weighted line is the
 * fastest way to show what one semester is actually worth.
 */
export function TrendChart(props: { data: TrendPoint[]; cgpa: number }) {
  const [hover, setHover] = createSignal<number | null>(null);
  const [W, attach] = useWidth();
  // These are CSS pixels now, not 1/300ths of the tile's width, so they are
  // sized as type rather than as geometry: an 8 that used to arrive on screen
  // at 21px in the wide Home tile arrives at 8px, which is unreadable. 11 is
  // the app's smallest real type size.
  const H = 150, PAD_L = 32, PAD_B = 26, PAD_T = 14, LABEL = "11";

  const scale = createMemo(() => {
    const data = props.data;
    const width = W();
    const lo = Math.min(5, ...data.map((d) => d.sgpa)) - 0.3;
    const hi = Math.max(10, ...data.map((d) => d.sgpa));
    const x = (i: number) => PAD_L + (data.length < 2 ? (width - PAD_L) / 2
      : (i / (data.length - 1)) * (width - PAD_L - 6));
    const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);
    return { x, y, lo, hi };
  });

  /** Running CGPA after each semester - weighted, not a simple average. */
  const running = createMemo(() => {
    let credits = 0, points = 0;
    return props.data.map((d) => {
      credits += d.credits;
      points += d.sgpa * d.credits;
      return credits ? points / credits : 0;
    });
  });

  const path = (values: number[]) => {
    const { x, y } = scale();
    return values.map((v, i) => `${i ? "L" : "M"}${fmt(x(i), 1)},${fmt(y(v), 1)}`).join(" ");
  };

  return (
    <Show when={props.data.length > 0} fallback={<p class="chart-note">No published semesters yet.</p>}>
      {/* The measured element is the wrapper, not the svg: an svg sized from
          its own measurement is a feedback loop, and it settles wherever the
          first frame happened to land. */}
      <div class="chart-fit" ref={attach}>
      <svg viewBox={`0 0 ${W()} ${H}`} width={W()} height={H} role="img"
           aria-label={`SGPA by semester, current CGPA ${fmt(props.cgpa)}`}>
        <For each={[6, 7, 8, 9, 10]}>{(tick) => (
          <>
            <line x1={PAD_L} x2={W()} y1={scale().y(tick)} y2={scale().y(tick)}
                  stroke="var(--hairline)" stroke-width="1" />
            <text x={PAD_L - 8} y={scale().y(tick) + 4} text-anchor="end"
                  fill="var(--text-faint)" font-size={LABEL} class="num">{tick}</text>
          </>
        )}</For>

        <path d={path(running())} fill="none" stroke="var(--brand-deep)"
              stroke-width="2" stroke-dasharray="3 3" />
        <path d={path(props.data.map((d) => d.sgpa))} fill="none"
              stroke="var(--brand)" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round" />

        <For each={props.data}>{(d, i) => (
          <>
            <circle cx={scale().x(i())} cy={scale().y(d.sgpa)}
                    r={hover() === i() ? 5.5 : 4}
                    fill="var(--bg)" stroke="var(--brand-bright)" stroke-width="2" />
            {/* Generous invisible hit area - 3px circles are not pointable. */}
            <rect x={scale().x(i()) - 12} y={0} width="24" height={H} fill="transparent"
                  onMouseEnter={() => setHover(i())} onMouseLeave={() => setHover(null)} />
            <text x={scale().x(i())} y={H - 7} text-anchor="middle"
                  fill={hover() === i() ? "var(--text)" : "var(--text-faint)"}
                  font-size={LABEL} class="num">{d.name}</text>
          </>
        )}</For>

        <Show when={hover() !== null}>
          {(() => {
            const i = hover()!;
            const d = props.data[i]!;
            return (
              <text x={scale().x(i)} y={scale().y(d.sgpa) - 11} text-anchor="middle"
                    fill="var(--brand-bright)" font-size="12" font-weight="600" class="num">
                {fmt(d.sgpa)}
              </text>
            );
          })()}
        </Show>
      </svg>
      </div>
      <p class="chart-note">
        Solid: semester SGPA. Dashed: CGPA after that semester.
      </p>
    </Show>
  );
}

// --- goal gauge ------------------------------------------------------------

/**
 * Where the projected SGPA sits against what the CGPA goal demands.
 *
 * Drawn as an arc with the requirement as a hard tick, so "short by 0.3" is a
 * visible gap rather than two numbers the student has to subtract.
 */
export function GoalGauge(props: {
  projected: number; required: number | null; reachable: boolean;
  /** False when nothing in the semester has been assessed yet. */
  assessed?: boolean;
}) {
  const W = 300, H = 120, CX = 150, CY = 104, R = 78;
  const angle = (v: number) => Math.PI * (1 - Math.min(Math.max(v, 0), 10) / 10);
  const pt = (v: number, r = R) =>
    [CX + r * Math.cos(angle(v)), CY - r * Math.sin(angle(v))] as const;

  const arc = (from: number, to: number, r: number) => {
    const [x1, y1] = pt(from, r);
    const [x2, y2] = pt(to, r);
    return `M${fmt(x1, 1)},${fmt(y1, 1)} A${r},${r} 0 0 1 ${fmt(x2, 1)},${fmt(y2, 1)}`;
  };

  const tone = () => {
    if (props.required === null) return "var(--brand)";
    if (!props.reachable) return "var(--danger)";
    return props.projected >= props.required ? "var(--good)" : "var(--warn)";
  };

  const known = () => props.assessed !== false;

  /**
   * Whether the requirement can be drawn on the dial at all.
   *
   * SGPA is capped at 10, so a requirement above it is not a position on this
   * arc - it is the statement that no position on the arc is good enough.
   * Drawing a tick there put a mark outside the gauge labelled 11.79, which
   * reads as a scale error rather than as "out of reach".
   */
  const markable = () => props.required !== null && props.required <= 10;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
         aria-label={known()
           ? `Projected SGPA ${fmt(props.projected)}`
           : "No subjects assessed yet"}>
      <path d={arc(0, 10, R)} fill="none" stroke="var(--surface-3)" stroke-width="10"
            stroke-linecap="round" />
      <Show when={known()}>
        <path class="gauge-arc" d={arc(0, props.projected, R)} fill="none"
              stroke={tone()} stroke-width="10" stroke-linecap="round" />
      </Show>

      <Show when={markable()}>
        <line x1={pt(props.required!, R - 10)[0]} y1={pt(props.required!, R - 10)[1]}
              x2={pt(props.required!, R + 10)[0]} y2={pt(props.required!, R + 10)[1]}
              stroke="var(--text)" stroke-width="2" />
        <text x={pt(props.required!, R + 20)[0]} y={pt(props.required!, R + 20)[1]}
              text-anchor="middle" fill="var(--text-dim)" font-size="9" class="num">
          {fmt(props.required!)}
        </text>
      </Show>

      {/* Nothing assessed is not a projection of zero. A dial reading 0.00 for
          a student who has simply not sat anything yet is the same lie the
          engine refuses to tell about an unassessed subject. */}
      <text x={CX} y={CY - 20} text-anchor="middle"
            fill={known() ? "var(--text)" : "var(--text-faint)"}
            font-size="30" font-weight="600" class="num">
        {known() ? fmt(props.projected) : "–"}
      </text>
      <text x={CX} y={CY - 4} text-anchor="middle" fill="var(--text-faint)"
            font-size="8" letter-spacing="1.6">
        {known() ? "PROJECTED SGPA" : "NOTHING ASSESSED YET"}
      </text>
    </svg>
  );
}

// --- attendance vs internals ----------------------------------------------

interface ScatterPoint { code: string; attendance: number; cie: number; cieMax: number }

/**
 * Attendance against internal marks - the chart that carries the thesis.
 *
 * R 7.5.ii makes attendance worth up to 5 CIE marks, so these two axes are
 * causally linked and no portal shows them together. The 75% and 60% lines are
 * drawn because they are where the student's options change, not because a
 * chart needs gridlines.
 */
export function AttendanceScatter(props: { points: ScatterPoint[] }) {
  const [hover, setHover] = createSignal<string | null>(null);
  const [W, attach] = useWidth();
  const H = 190, PAD_L = 34, PAD_B = 30, PAD_T = 14, PAD_R = 10, LABEL = "11";

  const x = (pct: number) => PAD_L + ((Math.min(Math.max(pct, 40), 100) - 40) / 60) * (W() - PAD_L - PAD_R);
  const y = (frac: number) => PAD_T + (1 - Math.min(Math.max(frac, 0), 1)) * (H - PAD_T - PAD_B);

  /**
   * A threshold line and its caption.
   *
   * The two lines sit 15 percentage points apart on a 60-point axis, so in the
   * drawer they are about 80px apart and both captions did not fit to the
   * right of them: the 60% one ran across the 75% line. It is written leftward
   * into the empty 40-60 stretch instead, where nothing is ever plotted -
   * a subject below 40% attendance is off the scale, and the axis is clamped.
   * `row` then keeps the two off a shared baseline so they cannot touch even
   * in a panel narrow enough to bring the lines together.
   */
  const line = (pct: number, colour: string, label: string,
                row: number, leftward = false) => (
    <>
      <line x1={x(pct)} x2={x(pct)} y1={PAD_T} y2={H - PAD_B}
            stroke={colour} stroke-width="1" stroke-dasharray="4 3" />
      <text x={x(pct) + (leftward ? -4 : 4)} y={PAD_T + 9 + row * 14}
            text-anchor={leftward ? "end" : "start"}
            fill={colour} font-size="10" letter-spacing="0.6">{label}</text>
    </>
  );

  return (
    <Show when={props.points.length > 0}
          fallback={<p class="chart-note">No attendance recorded yet.</p>}>
      <div class="chart-fit" ref={attach}>
      <svg viewBox={`0 0 ${W()} ${H}`} width={W()} height={H} role="img"
           aria-label="Attendance against internal marks, by subject">
        {line(ATTENDANCE_MIN, "var(--warn)", "75% ELIGIBLE", 0)}
        {line(ATTENDANCE_CONDONE, "var(--danger)", "60% FLOOR", 1, true)}

        <line x1={PAD_L} x2={W() - PAD_R} y1={H - PAD_B} y2={H - PAD_B}
              stroke="var(--hairline-strong)" stroke-width="1" />
        <For each={[40, 60, 80, 100]}>{(tick) => (
          <text x={x(tick)} y={H - PAD_B + 15} text-anchor="middle"
                fill="var(--text-faint)" font-size={LABEL} class="num">{tick}</text>
        )}</For>
        <For each={[0, 0.5, 1]}>{(frac) => (
          <text x={PAD_L - 7} y={y(frac) + 4} text-anchor="end"
                fill="var(--text-faint)" font-size={LABEL} class="num">
            {Math.round(frac * 100)}
          </text>
        )}</For>

        <For each={props.points}>{(p) => {
          const short = p.attendance < ATTENDANCE_MIN;
          const lost = p.attendance < ATTENDANCE_CONDONE;
          return (
            <g onMouseEnter={() => setHover(p.code)} onMouseLeave={() => setHover(null)}>
              <circle cx={x(p.attendance)} cy={y(p.cie / (p.cieMax || 1))}
                      r={hover() === p.code ? 7 : 5}
                      fill={lost ? "var(--danger-wash)" : short ? "var(--warn-wash)" : "var(--brand-wash)"}
                      stroke={lost ? "var(--danger)" : short ? "var(--warn)" : "var(--brand)"}
                      stroke-width="1.5" />
              <Show when={hover() === p.code}>
                <text x={x(p.attendance)} y={y(p.cie / (p.cieMax || 1)) - 11}
                      text-anchor="middle" fill="var(--text)" font-size="12"
                      font-weight="600">{p.code}</text>
              </Show>
            </g>
          );
        }}</For>
      </svg>
      </div>
      <p class="chart-note">
        X: attendance %. Y: internal marks as a share of the CIE maximum.
      </p>
    </Show>
  );
}

// --- row sparkbar ----------------------------------------------------------

/**
 * Inline attendance bar for a table row.
 *
 * Deliberately not a chart-library canvas: one canvas instance per row janks a
 * 40-row table, and this is nine SVG elements.
 */
export function AttendanceBar(props: { pct: number | null }) {
  const tone = () => {
    const pct = props.pct;
    if (pct === null) return "var(--text-faint)";
    return pct >= ATTENDANCE_MIN ? "var(--good)"
      : pct >= ATTENDANCE_CONDONE ? "var(--warn)" : "var(--danger)";
  };
  // An unknown attendance draws an empty track rather than a full or empty
  // bar - either would read as a percentage nobody has actually recorded.
  const fill = () => props.pct === null ? 0 : Math.max(0, Math.min(100, props.pct)) / 100 * 52;
  return (
    <svg width="52" height="8" viewBox="0 0 52 8" aria-hidden="true"
         style={{ "vertical-align": "middle" }}>
      <rect x="0" y="3" width="52" height="2" fill="var(--surface-3)" rx="1" />
      <rect x="0" y="3" width={fill()} height="2" fill={tone()} rx="1" />
      <line x1={0.75 * 52} x2={0.75 * 52} y1="0" y2="8"
            stroke="var(--text-faint)" stroke-width="1" />
    </svg>
  );
}
