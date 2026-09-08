import { createMemo, createSignal } from "solid-js";
import type { AvatarDefinition, Expression, Mood } from "./definition";
import { TEX } from "./definition";

/**
 * The one renderer. It draws a body and two eyes and knows nothing else.
 *
 * Everything that could be called a mood lives in `definition.ts`; this file only
 * turns numbers into a path and two capsules. That split is the reason a new
 * expression is a data edit rather than a component.
 *
 * Motion is CSS transitions on geometry properties, not a JS tween, for one
 * reason that matters more than elegance: `motion.css` already drops every
 * `--dur-*` token to zero under `prefers-reduced-motion`, so a face built on
 * those tokens inherits the accessibility behaviour instead of reimplementing
 * it and getting it wrong. This is the same argument `ui/morph.ts` makes.
 */

/**
 * A superellipse, sampled.
 *
 * `|x/a|^n + |y/b|^n = 1`. At n = 2 this is an ellipse, which is what
 * roundness 1 must produce; lower roundness raises the exponent and squares
 * the corners toward a squircle. Sampling rather than solving for Béziers
 * because 64 points is visually exact at any size a face is drawn, and the
 * closed-form control points for a general superellipse are not worth the
 * arithmetic.
 */
function blob(width: number, height: number, roundness: number, steps = 64): string {
  const a = width / 2;
  const b = height / 2;
  const n = 2 / Math.max(roundness, 0.05);
  const pow = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** e;
  const pts: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const x = pow(Math.cos(t), 2 / n) * a;
    const y = pow(Math.sin(t), 2 / n) * b;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

/** Where one eye lands once the head has turned. */
function place(
  which: "left" | "right", expr: Expression, body: AvatarDefinition["body"],
) {
  const e = expr.eyes[which];
  const side = which === "left" ? -1 : 1;
  // Yaw and pitch slide the eyes across a face that has no actual depth. The
  // divisors are the lie's strength, tuned by eye rather than derived - there
  // is no real projection here to be faithful to.
  const dx = (expr.head.y / 45) * (body.width / 6) * expr.perspective;
  const dy = (expr.head.x / 45) * (body.height / 7) * expr.perspective;
  return {
    cx: side * expr.eyes.spacing + e.x + dx,
    cy: e.y + dy,
    rx: e.width / 2,
    ry: e.height / 2,
    angle: e.angle,
  };
}

/**
 * One blink clock for every face on screen.
 *
 * Tex is a character, not a widget: he can be in the header, on Home and in
 * the assistant at the same moment, and per-instance timers had each of them
 * blinking on its own random schedule. Three faces blinking out of step do
 * not read as one character seen three times, they read as three creatures.
 *
 * Module-level and started once on first use, so a screen with no face never
 * schedules anything, and nothing is scheduled at all under reduced motion -
 * this must never become the thing that moves on a page someone asked to hold
 * still. The interval is deliberately irregular: a fixed one reads as a
 * hardware indicator rather than as a face.
 */
const [blinking, setBlinking] = createSignal(false);
let clockStarted = false;

function startBlinkClock(): void {
  if (clockStarted) return;
  clockStarted = true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const tick = () => {
    setTimeout(() => {
      setBlinking(true);
      setTimeout(() => { setBlinking(false); tick(); }, 130);
    }, 4000 + Math.random() * 5000);
  };
  tick();
}

/**
 * Where the pointer is, shared by every face, updated at most once a frame.
 *
 * One listener on the window rather than one per face, for the same reason
 * there is one blink clock: three faces are one character, and three
 * independent `pointermove` handlers is three chances for them to disagree
 * about where the student's hand is. Throttled to a frame because gaze is
 * read inside a memo that measures each face - unthrottled, a fast mouse
 * would do that measuring hundreds of times a second for a few degrees of
 * rotation nobody can see.
 *
 * Nothing is attached under reduced motion. A face that follows the cursor is
 * motion the student did not ask for, and it is the kind that never stops.
 */
const [pointer, setPointer] = createSignal<{ x: number; y: number } | null>(null);
let watchingPointer = false;

function watchPointer(): void {
  if (watchingPointer) return;
  watchingPointer = true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let queued = false;
  window.addEventListener("pointermove", (e) => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      setPointer({ x: e.clientX, y: e.clientY });
    });
  }, { passive: true });
  // Losing the pointer means losing the thing he was looking at. Centring is
  // the honest answer; holding the last gaze leaves him staring at a corner.
  window.addEventListener("pointerleave", () => setPointer(null), { passive: true });
}

/** How far off centre a face will look, in degrees of yaw and pitch. */
const GAZE_YAW = 17;
const GAZE_PITCH = 11;
/**
 * Distance at which the gaze is fully deflected.
 *
 * Not the viewport: dividing by half the window would mean a face barely
 * turns for a cursor right beside it on a wide screen, which is exactly when
 * the student is looking at him. A fixed radius makes him most responsive to
 * what is near, which is what eyes do.
 */
const GAZE_REACH = 420;

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

export function Face(props: {
  mood?: Mood;
  /** Drawn size in px; the definition's own units are the coordinate space. */
  size?: number;
  definition?: AvatarDefinition;
  /** Blinking is on by default and stops itself under reduced motion. */
  blink?: boolean;
  /** Following the cursor is on by default; also stops under reduced motion. */
  track?: boolean;
  label?: string;
}) {
  const def = () => props.definition ?? TEX;
  if (props.blink !== false) startBlinkClock();
  if (props.track !== false) watchPointer();

  let el: SVGSVGElement | undefined;

  /**
   * A press, acknowledged.
   *
   * He was inert when clicked, which on a face reads worse than on a button -
   * you poked something with eyes and it did not notice. A brief squash is
   * the whole reaction: enough to say he felt it, short enough that it never
   * becomes a thing to sit through. `pointerdown` rather than `click`, so it
   * lands under the finger rather than after it, and nothing here stops the
   * event - the button he sits inside still gets its click.
   */
  const [poked, setPoked] = createSignal(false);
  const poke = () => {
    setPoked(true);
    setTimeout(() => setPoked(false), 190);
  };

  const expr = createMemo<Expression>(() => {
    const table = def().expressions;
    if (blinking()) return table.blink ?? table.neutral!;
    return table[props.mood ?? "neutral"] ?? table.neutral!;
  });

  const size = () => props.size ?? 64;
  const box = () => `${-def().body.width / 2} ${-def().body.height / 2} `
    + `${def().body.width} ${def().body.height}`;

  /**
   * The authored expression, turned toward the cursor.
   *
   * Added to the pose rather than replacing it, so a thinking Tex still looks
   * away while a neutral one follows you - the expression says what he is
   * doing and the gaze says where he is doing it. Halved while he is thinking
   * or blinking: someone looking something up does not hold eye contact, and
   * a blink that tracks reads as a twitch.
   */
  const posed = createMemo<Expression>(() => {
    const base = expr();
    const at = props.track === false ? null : pointer();
    if (!at || !el) return base;
    const box = el.getBoundingClientRect();
    if (box.width === 0) return base;
    const damp = blinking() || (props.mood ?? "").startsWith("thinking") ? 0.4 : 1;
    const yaw = clamp1((at.x - (box.left + box.width / 2)) / GAZE_REACH) * GAZE_YAW * damp;
    const pitch = clamp1((at.y - (box.top + box.height / 2)) / GAZE_REACH) * GAZE_PITCH * damp;
    return {
      ...base,
      head: { x: base.head.x + pitch, y: base.head.y + yaw, z: base.head.z },
    };
  });

  const left = createMemo(() => place("left", posed(), def().body));
  const right = createMemo(() => place("right", posed(), def().body));

  return (
    <svg ref={el} class="tex-face" width={size()} height={size()} viewBox={box()}
         onPointerDown={poke}
         role="img" aria-label={props.label ?? `Tex looking ${props.mood ?? "neutral"}`}>
      {/* Roll turns the whole head; yaw squashes the silhouette, because a
          sphere seen off-axis is narrower and a face that only slides its
          eyes reads as flat. */}
      <g style={{
        transform: `rotate(${posed().head.z}deg) `
          + `scaleX(${(1 - Math.abs(posed().head.y) / 260).toFixed(3)}) `
          // The squash on a press. Y only - a face pushed from the front
          // spreads sideways, and scaling both axes just makes him small.
          + `scale(1, ${poked() ? 0.9 : 1})`,
        "transition": `transform ${poked() ? "var(--dur-fast)" : "var(--dur-slow)"} var(--ease)`,
      }}>
        <path d={blob(def().body.width, def().body.height, def().body.roundness)}
              fill={def().colors.body} />
        {/* Capsules, not ovals. An ellipse curves the whole way round and
            reads as a dot at any size; a capsule has straight parallel sides
            and semicircular caps, which is what gives the face its character
            and what makes a squint legible - shortening an ellipse just makes
            a smaller dot, shortening a capsule closes an eye. `rx` at half the
            width is what rounds the caps into true semicircles; anything less
            is a rounded rectangle and looks like one. */}
        {[left(), right()].map((e) => (
          <rect fill={def().colors.eyes}
                style={{
                  x: `${e.cx - e.rx}px`, y: `${e.cy - e.ry}px`,
                  width: `${e.rx * 2}px`, height: `${e.ry * 2}px`,
                  rx: `${Math.min(e.rx, e.ry)}px`, ry: `${Math.min(e.rx, e.ry)}px`,
                  transform: `rotate(${e.angle}deg)`,
                  "transform-origin": `${e.cx}px ${e.cy}px`,
                  "transition": "x var(--dur-slow) var(--ease), "
                    + "y var(--dur-slow) var(--ease), "
                    + "width var(--dur-fast) var(--ease), "
                    + "height var(--dur-fast) var(--ease), "
                    + "rx var(--dur-fast) var(--ease), "
                    + "transform var(--dur-slow) var(--ease)",
                }} />
        ))}
      </g>
    </svg>
  );
}
