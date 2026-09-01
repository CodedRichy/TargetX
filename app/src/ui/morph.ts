/**
 * The pill becomes the bar.
 *
 * The palette used to hard-cut: the header pill stayed where it was and a
 * 38rem dialog appeared 12vh down the screen, unrelated to it. Two objects,
 * and the student has to work out that the second one came from the first.
 * They are one object, so it moves like one - the pill grows into the bar on
 * open and shrinks back into the pill on close.
 *
 * FLIP, with one correction that matters. The naive version animates `width`
 * on an element the scrim is centring, so every frame re-centres the box and
 * the translate delta - computed once, against the FINAL layout - is wrong for
 * the whole flight. The element drifts. So the shell is pinned to its measured
 * rect for the duration and released after: identical position, no layout left
 * to fight.
 *
 * Duration comes from `--med`, which the tokens collapse to 0ms under
 * prefers-reduced-motion. Inheriting the accessibility behaviour beats
 * restating it, and it is the same rule motion.css already follows.
 */

/** The header control this grows out of. Absent on some screens; then no morph. */
const PILL = ".ask";

/**
 * A duration token in milliseconds.
 *
 * `parseFloat` on a custom property returns NaN whenever the value is not what
 * you assumed, and `|| fallback` would quietly swallow that - along with 0ms,
 * which is not a missing value but the single most important one this function
 * can return, because it is what reduced motion sets.
 */
function ms(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith("ms") ? n : n * 1000;
}

/**
 * Animate `shell` between the header pill's box and its own.
 *
 * Returns the animation so the caller can wait for it, or null when there is
 * nothing to animate against - no pill on screen, a zero-sized box, or a test
 * environment with no Web Animations API. A null return is a complete answer:
 * the caller shows or hides the palette immediately, which is what it did
 * before any of this existed.
 */
export function morph(
  shell: HTMLElement, scrim: HTMLElement, dir: "in" | "out",
): Animation | null {
  // jsdom has no `animate`, and a component that only works in a browser is
  // a component that cannot be tested.
  if (typeof shell.animate !== "function") return null;

  const pill = document.querySelector(PILL);
  if (!(pill instanceof HTMLElement)) return null;

  const from = pill.getBoundingClientRect();
  const to = shell.getBoundingClientRect();
  // A zero box means the element is not laid out yet. Animating from nothing
  // to nothing produces a flash, which is worse than the hard cut it replaced.
  if (from.width === 0 || to.width === 0) return null;

  const style = getComputedStyle(shell);
  const duration = ms("--med", 200);
  const easing = style.getPropertyValue("--ease").trim() || "ease";

  // Out of the scrim's flex centring for the flight. Set from the measured
  // rect, so releasing it lands on the same pixel it was already on.
  const pinned = shell.style.cssText;
  shell.style.position = "fixed";
  shell.style.insetInlineStart = `${to.left}px`;
  shell.style.insetBlockStart = `${to.top}px`;
  shell.style.margin = "0";

  const asPill: Keyframe = {
    transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    // The pill's own radius, so the corners round off as it collapses rather
    // than staying square until the last frame.
    borderRadius: "999px",
  };
  const asBar: Keyframe = {
    transform: "translate(0px, 0px)",
    width: `${to.width}px`,
    height: `${to.height}px`,
    borderRadius: style.borderRadius,
  };

  scrim.animate(
    dir === "in" ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
    { duration, easing, fill: "both" },
  );

  const anim = shell.animate(dir === "in" ? [asPill, asBar] : [asBar, asPill], {
    duration, easing,
    // Going out, the shell must stay collapsed until it unmounts - dropping
    // to its natural size for one frame is a flash of the thing that just
    // shrank away.
    fill: dir === "out" ? "forwards" : "none",
  });

  if (dir === "in") {
    const release = () => { shell.style.cssText = pinned; };
    anim.finished.then(release, release);
  }
  return anim;
}
