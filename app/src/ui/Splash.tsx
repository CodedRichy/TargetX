import { Show } from "solid-js";

/**
 * The opening screen.
 *
 * Shown while the launch check audits the stored data. It is held for a short
 * floor even when the check finishes instantly - a panel that appears and
 * vanishes inside 80ms reads as a flicker, which looks like a fault rather
 * than like work being done.
 *
 * It states what it is doing. "Loading…" tells a student nothing; "checking
 * your saved data" tells them why the wait exists at all.
 */
export function Splash(props: { message?: string }) {
  return (
    <div class="splash">
      <div class="splash-body">
        <h1 class="wordmark splash-mark">Target<span>X</span></h1>
        <div class="splash-bar" aria-hidden="true"><i /></div>
        <p class="splash-note">{props.message ?? "Checking your saved data"}</p>
      </div>
    </div>
  );
}

/**
 * Inline work indicator.
 *
 * For anything that runs inside a screen rather than instead of one - a sync,
 * a catalogue fetch, a PDF being read. Never a spinner over the whole app: the
 * rest of the screen stays readable and usable while one part of it works.
 */
export function Busy(props: { label: string; when: boolean }) {
  return (
    <Show when={props.when}>
      <span class="busy" role="status">
        <span class="busy-dots" aria-hidden="true"><i /><i /><i /></span>
        {props.label}
      </span>
    </Show>
  );
}
