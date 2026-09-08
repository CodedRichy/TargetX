import answerUrl from "../../assets/tex-answer.mp3";
import pokeUrl from "../../assets/tex-poke.mp3";

/**
 * The two noises Tex makes, and the single place either of them can happen.
 *
 * One choke point on purpose. Sound is the one output this app has that a
 * student cannot look away from - it reaches a lecture hall, a library, and
 * whoever is sitting next to them - so every rule about when it is allowed
 * belongs in one function rather than at each call site, where the third one
 * added would inevitably forget one.
 *
 * The rules, all of them here:
 *
 * - Nothing plays until the student has interacted with the window. Browsers
 *   and WebView2 refuse audio before a gesture anyway, but the point is not
 *   the policy: an app that makes a noise before it has been touched is an
 *   app that made a noise in a quiet room for no reason.
 * - Nothing plays into a hidden window. The answer that arrives while they
 *   are in another app is not worth announcing.
 * - Nothing plays under `prefers-reduced-motion`. Not literally what that
 *   setting means - but it is the closest thing to "this machine belongs to
 *   someone who does not want to be surprised by it", and the alternative is
 *   inventing a preference nobody knows to look for.
 * - A failed `play()` is swallowed. Autoplay refusals reject, and a rejected
 *   promise here is a decoration failing, never anything the student needs.
 */

/**
 * Both cues, locked at 0.75.
 *
 * One constant rather than a level per cue: two sounds from the same
 * character at different volumes read as two different apps making noise.
 * Fixed rather than exposed, because the useful control is the system volume
 * the student already has, and a slider here would be a second one to find.
 */
const VOLUME = 0.75;

type Cue = "answer" | "poke";

const urls: Record<Cue, string> = { answer: answerUrl, poke: pokeUrl };
const cache = new Map<Cue, HTMLAudioElement>();

/** Set once the student has done anything at all in the window. */
let touched = false;

if (typeof window !== "undefined") {
  const arm = () => { touched = true; };
  window.addEventListener("pointerdown", arm, { once: true, passive: true });
  window.addEventListener("keydown", arm, { once: true, passive: true });
}

function allowed(): boolean {
  if (!touched) return false;
  if (typeof document === "undefined" || document.hidden) return false;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Play one cue, at most one copy of it at a time.
 *
 * Rewinding a cached element rather than constructing an `Audio` per call:
 * two answers landing close together should sound like one app, not two
 * overlapping chimes, and a fresh element each time would also re-fetch on a
 * cold cache and arrive late enough to be confusing.
 */
export function play(cue: Cue): void {
  if (!allowed()) return;
  let el = cache.get(cue);
  if (!el) {
    el = new Audio(urls[cue]);
    el.volume = VOLUME;
    cache.set(cue, el);
  }
  el.currentTime = 0;
  void el.play().catch(() => {});
}
