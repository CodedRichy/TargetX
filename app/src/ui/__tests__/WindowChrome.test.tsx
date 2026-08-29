// @vitest-environment jsdom
/**
 * The window buttons.
 *
 * With `decorations: false` the operating system stops drawing a title bar,
 * and these three buttons become the ONLY way to close the application. That
 * makes them different from every other control in the app: a bug here does
 * not degrade a feature, it traps the window on screen.
 *
 * The maximise glyph is a second thing worth holding down. It has to follow
 * the real window, because double-clicking the drag region, pressing Win+Up
 * and snapping to a screen edge all maximise without this component being
 * involved - a local boolean would be wrong seconds after launch.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();
const isMaximized = vi.fn(async () => false);
/** Captures the resize subscriber so a test can drive it. */
let onResizedCb: (() => void) | undefined;
const onResized = vi.fn(async (cb: () => void) => { onResizedCb = cb; return () => {}; });

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ minimize, toggleMaximize, close, isMaximized, onResized }),
}));

function inShell(yes: boolean) {
  if (yes) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

beforeEach(() => {
  [minimize, toggleMaximize, close, onResized].forEach((m) => m.mockClear());
  isMaximized.mockReset();
  isMaximized.mockResolvedValue(false);
  onResizedCb = undefined;
  inShell(true);
});
afterEach(() => { inShell(false); cleanup(); });

/** Let the onMount chain of awaits settle. */
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("outside the desktop shell", () => {
  it("renders nothing at all", async () => {
    inShell(false);
    const { WindowChrome } = await import("../WindowChrome");
    const { container } = render(() => <WindowChrome />);
    // A browser still has its own chrome; drawing a second set of buttons
    // that control nothing would be worse than drawing none.
    expect(container.textContent).toBe("");
    expect(container.querySelector(".winctl")).toBeNull();
  });
});

describe("the three buttons", () => {
  it("offers exactly minimise, maximise and close", async () => {
    const { WindowChrome } = await import("../WindowChrome");
    const { container } = render(() => <WindowChrome />);
    await settle();
    expect(container.querySelectorAll(".winbtn")).toHaveLength(3);
  });

  it("each one drives the real window", async () => {
    const { WindowChrome } = await import("../WindowChrome");
    render(() => <WindowChrome />);
    await settle();

    fireEvent.click(screen.getByLabelText("Minimise"));
    await settle();
    expect(minimize).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("Maximise"));
    await settle();
    expect(toggleMaximize).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByLabelText("Close"));
    await settle();
    expect(close).toHaveBeenCalledOnce();
  });

  it("marks only the close button as destructive", async () => {
    const { WindowChrome } = await import("../WindowChrome");
    const { container } = render(() => <WindowChrome />);
    await settle();
    const close = container.querySelectorAll(".winbtn-close");
    expect(close).toHaveLength(1);
    expect((close[0] as HTMLElement).getAttribute("aria-label")).toBe("Close");
  });

  it("uses none of the app's own button classes", async () => {
    // screens.css:57 styles button.primary / .ghost / .danger / .link for the
    // application's own buttons - padding, radius, borders. A title-bar button
    // that picks one up stops looking like a title-bar button: `danger` gave
    // close a permanent red border before this was caught in a screenshot.
    const { WindowChrome } = await import("../WindowChrome");
    const { container } = render(() => <WindowChrome />);
    await settle();
    for (const owned of ["primary", "ghost", "danger", "link"]) {
      expect(container.querySelectorAll(`.winbtn.${owned}`)).toHaveLength(0);
    }
  });
});

describe("the maximise glyph follows the window, not a local flag", () => {
  // waitFor rather than a fixed number of microtask ticks: the state arrives
  // through a dynamic import of the Tauri window module, and how many ticks
  // that takes to settle is a property of the module loader, not of this
  // component. Counting ticks passes or fails for reasons unrelated to the
  // behaviour being tested.
  it("reads the real state on mount", async () => {
    isMaximized.mockResolvedValue(true);
    const { WindowChrome } = await import("../WindowChrome");
    render(() => <WindowChrome />);
    // Launched already maximised - a fresh boolean would have said "Maximise".
    await waitFor(() => expect(screen.getByLabelText("Restore")).toBeTruthy());
  });

  it("re-reads when the window is resized by something else", async () => {
    const { WindowChrome } = await import("../WindowChrome");
    render(() => <WindowChrome />);
    await waitFor(() => expect(screen.getByLabelText("Maximise")).toBeTruthy());
    await waitFor(() => expect(onResizedCb).toBeDefined());

    // Win+Up, an edge snap, or a double-click on the drag region: the window
    // is now maximised and this component was never told directly.
    isMaximized.mockResolvedValue(true);
    onResizedCb?.();
    await waitFor(() => expect(screen.getByLabelText("Restore")).toBeTruthy());
  });
});
