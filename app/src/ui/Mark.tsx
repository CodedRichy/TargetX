/**
 * The X.
 *
 * One shape, three jobs: the application icon, the opening screen, and the X
 * in the wordmark. They have to be the same drawing rather than three
 * lookalikes, because the launch animation flies the first into the third -
 * and a typographic X would not land on a drawn one.
 *
 * Two strokes at 45 degrees with round caps. The rising stroke is the brighter
 * of the two: a mark for an app about a target should read as going up, and
 * the asymmetry is what stops it looking like a close button.
 */
export function Mark(props: { size?: number | string; class?: string; title?: string }) {
  return (
    <svg class={props.class} viewBox="0 0 100 100"
         width={props.size ?? "1em"} height={props.size ?? "1em"}
         role={props.title ? "img" : "presentation"}
         aria-label={props.title} aria-hidden={props.title ? undefined : "true"}
         style={{ overflow: "visible" }}>
      {/* Falling stroke, quieter. */}
      <line x1="22" y1="22" x2="78" y2="78"
            stroke="var(--brand-deep)" stroke-width="17" stroke-linecap="round" />
      {/* Rising stroke, drawn second so it crosses on top. */}
      <line x1="22" y1="78" x2="78" y2="22"
            stroke="var(--brand)" stroke-width="17" stroke-linecap="round" />
    </svg>
  );
}
