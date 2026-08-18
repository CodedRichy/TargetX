import { Show } from "solid-js";

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
