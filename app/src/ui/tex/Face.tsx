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

export function Face(props: {
  mood?: Mood;
  /** Drawn size in px; the definition's own units are the coordinate space. */
  size?: number;
  definition?: AvatarDefinition;
  /** Blinking is on by default and stops itself under reduced motion. */
  blink?: boolean;
  label?: string;
}) {
  const def = () => props.definition ?? TEX;
  if (props.blink !== false) startBlinkClock();

  const expr = createMemo<Expression>(() => {
    const table = def().expressions;
    if (blinking()) return table.blink ?? table.neutral!;
    return table[props.mood ?? "neutral"] ?? table.neutral!;
  });

  const size = () => props.size ?? 64;
  const box = () => `${-def().body.width / 2} ${-def().body.height / 2} `
    + `${def().body.width} ${def().body.height}`;

  const left = createMemo(() => place("left", expr(), def().body));
  const right = createMemo(() => place("right", expr(), def().body));

  return (
    <svg class="tex-face" width={size()} height={size()} viewBox={box()}
         role="img" aria-label={props.label ?? `Tex looking ${props.mood ?? "neutral"}`}>
      {/* Roll turns the whole head; yaw squashes the silhouette, because a
          sphere seen off-axis is narrower and a face that only slides its
          eyes reads as flat. */}
      <g style={{
        transform: `rotate(${expr().head.z}deg) `
          + `scaleX(${(1 - Math.abs(expr().head.y) / 260).toFixed(3)})`,
        "transition": "transform var(--dur-slow) var(--ease)",
      }}>
        <path d={blob(def().body.width, def().body.height, def().body.roundness)}
              fill={def().colors.body} />
        {[left(), right()].map((e) => (
          <ellipse fill={def().colors.eyes}
                   style={{
                     cx: `${e.cx}px`, cy: `${e.cy}px`,
                     rx: `${e.rx}px`, ry: `${e.ry}px`,
                     transform: `rotate(${e.angle}deg)`,
                     "transform-origin": `${e.cx}px ${e.cy}px`,
                     "transition": "cx var(--dur-slow) var(--ease), "
                       + "cy var(--dur-slow) var(--ease), "
                       + "rx var(--dur-fast) var(--ease), "
                       + "ry var(--dur-fast) var(--ease), "
                       + "transform var(--dur-slow) var(--ease)",
                   }} />
        ))}
      </g>
    </svg>
  );
}
