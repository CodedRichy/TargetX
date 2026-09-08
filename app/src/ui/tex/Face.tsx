import { createMemo, createSignal } from "solid-js";
import type { AvatarDefinition, Expression, Mood } from "./definition";
import { TEX } from "./definition";
import { play } from "./sound";

/**
 * The one renderer. It draws a body and two eyes and knows nothing else.
 *
 * Everything that could be called a mood lives in `definition.ts`; this file only
 * turns numbers into a path and two capsules. That split is the reason a new
 * expression is a data edit rather than a component.
 *
 * Motion is CSS transitions on geometry properties, not a JS tween, for one
 * reason that matters more than elegance: `tokens.css` collapses `--fast` and
 * `--med` to 0ms under `prefers-reduced-motion`, so a face built on those
 * tokens inherits the accessibility behaviour rather than reimplementing it
 * and getting it wrong. This is the argument `ui/morph.ts` makes.
 *
 * It has to be THOSE names. The first version of this file transitioned on
 * `--dur-fast` and `--dur-slow`, which this project has never defined, and an
 * undefined custom property invalidates the whole `transition` declaration -
 * so every expression change, gaze and press snapped with no animation at
 * all, and the reduced-motion behaviour claimed above was not happening
 * either. Two bugs wearing one typo.
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

/** An eye resolved to where and how big it is drawn. */
interface Placed {
  cx: number; cy: number; rx: number; ry: number; angle: number;
}

/** Where one eye lands once the head has turned. */
function place(
  which: "left" | "right", expr: Expression, body: AvatarDefinition["body"],
): Placed {
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
  // Roughly one blink in four is a double. A single blink on a fixed shape
  // is the most obviously mechanical thing a face can do; the variation is
  // what stops the eye learning the pattern.
  const shut = (then: () => void) => {
    setBlinking(true);
    setTimeout(() => { setBlinking(false); then(); }, 120);
  };
  const tick = () => {
    setTimeout(() => {
      shut(() => {
        if (Math.random() < 0.25) setTimeout(() => shut(tick), 110);
        else tick();
      });
    }, 3600 + Math.random() * 4800);
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
  startIdleGlances();
  let queued = false;
  window.addEventListener("pointermove", (e) => {
    lastMove = Date.now();
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

/**
 * Where he looks when nobody is moving the mouse.
 *
 * Without this he is a statue between events: perfectly still, then snapping
 * to the cursor, then still again. Eyes do not do that. Every few seconds,
 * if the pointer has gone quiet, he glances somewhere and comes back - a
 * saccade, which is the cheapest possible signal that something is running
 * behind the face rather than waiting to be poked.
 *
 * Deliberately small and deliberately irregular. A wide idle glance reads as
 * distraction, and a regular one reads as a screensaver.
 */
const [idleLook, setIdleLook] = createSignal<{ yaw: number; pitch: number }>({ yaw: 0, pitch: 0 });
let lastMove = 0;

function startIdleGlances(): void {
  const wander = () => {
    setTimeout(() => {
      // Only while the student's hand is still. A glance that fights the
      // cursor makes him look shifty rather than alive.
      if (Date.now() - lastMove > 2600) {
        setIdleLook({
          yaw: (Math.random() * 2 - 1) * 9,
          pitch: (Math.random() * 2 - 1) * 5,
        });
        setTimeout(() => setIdleLook({ yaw: 0, pitch: 0 }), 700 + Math.random() * 900);
      }
      wander();
    }, 2400 + Math.random() * 3600);
  };
  wander();
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

/** One eye. A component so the node survives every gaze update. */
function Eye(props: { e: Placed; fill: string }) {
  return (
    <rect fill={props.fill}
          style={{
            x: `${props.e.cx - props.e.rx}px`,
            y: `${props.e.cy - props.e.ry}px`,
            width: `${props.e.rx * 2}px`,
            height: `${props.e.ry * 2}px`,
            rx: `${Math.min(props.e.rx, props.e.ry)}px`,
            ry: `${Math.min(props.e.rx, props.e.ry)}px`,
            transform: `rotate(${props.e.angle}deg)`,
            /* `fill-box` makes the origin this rect's own box, so an eye
               rotates about its own centre. Naming the coordinates by hand did
               not work and could not: under the default `view-box` they are
               read from the viewBox's CORNER, which put the pivot outside the
               face and swung the eyes across it rather than tilting them. */
            "transform-box": "fill-box",
            "transform-origin": "center",
            /* Position on `--fast` because it carries the gaze, which has to
               keep up with a hand; shape on `--med` because that is the
               expression changing, and a mood that snaps reads as a glitch. */
            "transition": "x var(--fast) var(--ease), "
              + "y var(--fast) var(--ease), "
              + "width var(--med) var(--ease), "
              + "height var(--med) var(--ease), "
              + "rx var(--med) var(--ease), "
              + "transform var(--med) var(--ease)",
          }} />
  );
}

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
    play("poke");
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
    if (props.track === false) return base;
    const damp = blinking() || (props.mood ?? "").startsWith("thinking") ? 0.4 : 1;

    // A stale pointer is not a pointer. Following a mouse that stopped two
    // minutes ago is the same staring-at-a-corner problem as never following
    // it at all, so attention reverts to his own idle wandering.
    const at = Date.now() - lastMove < 2600 ? pointer() : null;
    const box = el?.getBoundingClientRect();
    if (!at || !box || box.width === 0) {
      const idle = idleLook();
      return {
        ...base,
        head: {
          x: base.head.x + idle.pitch * damp,
          y: base.head.y + idle.yaw * damp,
          z: base.head.z,
        },
      };
    }
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
        /* `transform-box` defaults to `view-box`, which puts the origin at the
           TOP-LEFT CORNER of the viewBox - here (-120, -120), not (0, 0). Left
           at the default, every yaw squash and every press pivoted about the
           corner, so the face slid sideways and lurched instead of squashing
           where it stood. Centring it is the whole fix. */
        "transform-origin": "center",
        transform: `rotate(${posed().head.z}deg) `
          + `scaleX(${(1 - Math.abs(posed().head.y) / 260).toFixed(3)}) `
          // The squash on a press. Y only - a face pushed from the front
          // spreads sideways, and scaling both axes just makes him small.
          + `scale(1, ${poked() ? 0.9 : 1})`,
        // The group carries both the press and the gaze squash, and both
        // want to feel immediate.
        "transition": "transform var(--fast) var(--ease)",
      }}>
        {/* Breathing lives on its own group rather than on the one above,
            which already carries gaze and press as an inline transform - a
            CSS animation and an inline transform on one element is the
            animation winning and the gaze silently dying. Body only: a face
            whose eyes swell with it looks like it is being inflated. */}
        <g class="tex-breath">
          <path d={blob(def().body.width, def().body.height, def().body.roundness)}
                fill={def().colors.body} />
        </g>
        {/* Capsules, not ovals. An ellipse curves the whole way round and
            reads as a dot at any size; a capsule has straight parallel sides
            and semicircular caps, which is what makes a squint legible -
            shortening an ellipse just gives a smaller dot, shortening a
            capsule closes an eye.

            Two elements rather than a mapped array, and that is load-bearing
            rather than style. An unkeyed `.map` inside JSX makes Solid tear
            down and rebuild both nodes every time the memo re-runs - which,
            with gaze, is every frame the mouse moves. A newly created element
            has no previous value to animate FROM, so the transitions below
            could never fire however correct they were. */}
        <Eye e={left()} fill={def().colors.eyes} />
        <Eye e={right()} fill={def().colors.eyes} />
      </g>
    </svg>
  );
}
