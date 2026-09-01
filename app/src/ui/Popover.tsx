import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import type { JSX } from "solid-js";

/**
 * A panel hanging off a header control.
 *
 * It is rendered through a Portal, into `document.body`, and positioned with
 * `fixed` coordinates measured from its anchor. That is not architectural
 * neatness - it is the fix for a bug that only existed in the shipped app.
 *
 * The header carries `backdrop-filter`, which is the one genuinely glass
 * surface in this UI. An element with a backdrop filter establishes a
 * containing block AND, in WebView2 - the engine the Windows build actually
 * runs on - clips its descendants to its own box. The header is about 64px
 * tall and these panels hang some 220px below it, so in the real application
 * they were painted and then clipped to nothing. Every test passed, and a
 * headless Chromium screenshot showed them correctly, because neither of those
 * is WebView2.
 *
 * Leaving the panel inside the header and raising its z-index cannot fix this:
 * the clip is applied by the filtered ancestor regardless of stacking. Getting
 * out of that subtree is the fix.
 */
export function Popover(props: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the panel. */
  label: string;
  /** The control it hangs from; measured on open to place the panel. */
  anchor: () => HTMLElement | undefined;
  children: JSX.Element;
}) {
  const [box, setBox] = createSignal({ top: 0, right: 0 });
  let panel: HTMLDivElement | undefined;

  /**
   * Measured on open, not on every frame.
   *
   * The header does not move while a panel is open - it cannot be scrolled and
   * the window cannot be dragged with the panel up - so a resize observer here
   * would be machinery for an event that does not happen.
   */
  const place = () => {
    const a = props.anchor();
    if (!a) return;
    const r = a.getBoundingClientRect();
    setBox({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
  };
  createEffect(() => { if (props.open) place(); });

  /*
   * Close on a press outside, decided by geometry rather than by propagation.
   *
   * Propagation cannot work here: Solid delegates every `onClick` to
   * `document`, and this listener is on `document` too - `stopPropagation`
   * does not stop other listeners bound to the SAME node. The trigger's own
   * toggle would open the panel and this handler would close it in one click.
   *
   * It listens for `pointerdown` rather than `click` because a click on a row
   * inside the panel can remove that row, and a click listener would then be
   * handed a node already detached from the tree - `contains` answers false for
   * something that was plainly inside, and the panel closed on every dismissal.
   *
   * Both the anchor and the panel count as inside. They are no longer in the
   * same subtree, which is the price of the Portal.
   */
  const onDown = (e: Event) => {
    const t = e.target;
    if (!(t instanceof Node)) return;
    if (panel?.contains(t) || props.anchor()?.contains(t)) return;
    props.onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && props.open) props.onClose();
  };

  onMount(() => {
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", onDown);
    document.removeEventListener("keydown", onKey);
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div ref={panel} class="pop" role="dialog" aria-label={props.label}
             style={{ top: `${box().top}px`, right: `${box().right}px` }}>
          {props.children}
        </div>
      </Portal>
    </Show>
  );
}
