/**
 * Window controls, for a window that has no title bar of its own.
 *
 * `decorations: false` in tauri.conf.json removes the operating system's title
 * bar, which is the only thing that was providing minimise, maximise and
 * close. Everything the OS stopped doing has to be done here instead, and a
 * window that cannot be closed or moved is a worse product than one with an
 * ordinary title bar - so this file is not decoration, it is the replacement
 * for a load-bearing part of the shell.
 *
 * Two behaviours are easy to lose and are handled explicitly:
 *
 *   - DRAGGING. `data-tauri-drag-region` applies ONLY to the element carrying
 *     it, never to its children, so the header applies it to itself AND to its
 *     non-interactive blocks. Miss one and that patch of the header becomes
 *     dead space the window cannot be moved by.
 *   - MAXIMISE STATE. The middle button is a toggle, and its glyph has to
 *     follow the real window rather than a local boolean: a double-click on
 *     the drag region, a Win+Up, or a snap to the screen edge all maximise
 *     without going through this component. It subscribes to the window's own
 *     resize events for that reason.
 */
import { Show, createSignal, onCleanup, onMount } from "solid-js";

/**
 * True when running inside the desktop shell.
 *
 * Mirrors `canSync` in `sync/etlab` and `canUpdate` in `sync/update` rather
 * than inventing a third detection. In a browser (`npm run dev`, and every
 * test) there is no window to control and this renders nothing - the page
 * still has the browser's own chrome.
 */
export const hasOwnChrome = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Glyphs at 10x10, stroked rather than filled.
 *
 * Drawn here instead of using text characters: the obvious shortcut is to
 * print the Unicode box characters, and they render at wildly different
 * weights and baselines across the fonts this app ships, which is the exact
 * misalignment that makes a custom title bar look homemade.
 */
const Glyph = (props: { kind: "min" | "max" | "restore" | "close" }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"
       fill="none" stroke="currentColor" stroke-width="1.1"
       shape-rendering="geometricPrecision">
    <Show when={props.kind === "min"}>
      <line x1="0.5" y1="5" x2="9.5" y2="5" />
    </Show>
    <Show when={props.kind === "max"}>
      <rect x="0.9" y="0.9" width="8.2" height="8.2" rx="1" />
    </Show>
    <Show when={props.kind === "restore"}>
      {/* The back pane is clipped by the front one, the way Windows draws it -
          two full overlapping squares read as a mistake at this size. */}
      <path d="M2.6 2.6 V1.4 H8.6 V7.4 H7.4" />
      <rect x="1.4" y="2.6" width="6" height="6" rx="0.8" />
    </Show>
    <Show when={props.kind === "close"}>
      <line x1="1" y1="1" x2="9" y2="9" />
      <line x1="9" y1="1" x2="1" y2="9" />
    </Show>
  </svg>
);

export function WindowChrome() {
  const [maximised, setMaximised] = createSignal(false);

  let unlisten: (() => void) | undefined;

  onMount(async () => {
    if (!hasOwnChrome()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();

    const sync = async () => setMaximised(await win.isMaximized());
    await sync();
    // Covers every route to maximised that does not come through the button:
    // double-clicking the drag region, Win+Up, and dragging to a screen edge.
    unlisten = await win.onResized(() => { void sync(); });
  });

  onCleanup(() => unlisten?.());

  const act = async (what: "min" | "toggle" | "close") => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    if (what === "min") await win.minimize();
    else if (what === "close") await win.close();
    else {
      await win.toggleMaximize();
      setMaximised(await win.isMaximized());
    }
  };

  return (
    <Show when={hasOwnChrome()}>
      <div class="winctl">
        <button class="winbtn" title="Minimise" aria-label="Minimise"
                onClick={() => void act("min")}>
          <Glyph kind="min" />
        </button>
        <button class="winbtn"
                title={maximised() ? "Restore" : "Maximise"}
                aria-label={maximised() ? "Restore" : "Maximise"}
                onClick={() => void act("toggle")}>
          <Glyph kind={maximised() ? "restore" : "max"} />
        </button>
        {/* NOT `danger`: screens.css:83 already owns `button.danger` for the
            app's outlined destructive buttons, and reusing the name gave the
            close button a permanent red border and red glyph - an idle title
            bar that looked like an error state. Named for the button, not for
            the sentiment. */}
        <button class="winbtn winbtn-close" title="Close" aria-label="Close"
                onClick={() => void act("close")}>
          <Glyph kind="close" />
        </button>
      </div>
    </Show>
  );
}
