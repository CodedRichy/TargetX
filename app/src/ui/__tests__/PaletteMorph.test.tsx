// @vitest-environment jsdom
/**
 * The palette outliving `open`, and the header pill surviving it.
 *
 * Growing out of the pill means the palette can no longer unmount the moment
 * it is closed - there has to be something on screen to shrink. That is a
 * second lifecycle running alongside the prop, and two failures live in the
 * gap between them: a palette that never unmounts, and a header pill left
 * invisible for the rest of the session because the flag that hides it was
 * set on open and cleared only by an animation that never ran.
 *
 * jsdom has no Web Animations API, so `morph` returns null here and the
 * component takes its no-animation path. That is not a gap in the test - it is
 * the same path a real browser takes when the pill is off screen or motion is
 * off, and it is the path where "unmount immediately" has to still be true.
 */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSignal } from "solid-js";
import { morph } from "../morph";

vi.mock("../../state/ask", () => ({
  askConfigured: () => false, askRemote: vi.fn(),
}));
vi.mock("../../state/auth", () => ({
  signedIn: () => false, authConfigured: () => false,
  authBusy: () => false, signIn: vi.fn(),
}));

const { Palette } = await import("../Palette");

const box = () => screen.queryByRole("dialog", { name: "Search" });
const flag = () => document.documentElement.dataset.palette ?? null;

afterEach(() => { cleanup(); delete document.documentElement.dataset.palette; });

describe("the palette's own lifecycle", () => {
  it("mounts on open and unmounts on close", async () => {
    const [open, setOpen] = createSignal(false);
    render(() => <Palette open={open()} onClose={() => setOpen(false)} />);
    expect(box()).toBeNull();

    setOpen(true);
    expect(box()).toBeTruthy();

    setOpen(false);
    // No animation to wait for, so the close is not deferred into a state
    // where a stuck promise would leave the dialog on screen forever.
    expect(box()).toBeNull();
  });

  it("puts the pill back when it closes", () => {
    const [open, setOpen] = createSignal(false);
    render(() => <Palette open={open()} onClose={() => setOpen(false)} />);

    setOpen(true);
    expect(flag()).toBe("open");

    setOpen(false);
    // The one that would be invisible to every other test: the header's search
    // control is hidden by this flag, so a flag that outlives the palette is a
    // control the student can never see again without a reload.
    expect(flag()).toBeNull();
  });

  it("puts the pill back when the palette is torn down mid-flight", () => {
    const [open, setOpen] = createSignal(false);
    const r = render(() => <Palette open={open()} onClose={() => setOpen(false)} />);
    setOpen(true);
    expect(flag()).toBe("open");

    // A route change or a reload during the shrink. Nothing will ever call the
    // close path again, so cleanup has to be the one that clears it.
    r.unmount();
    expect(flag()).toBeNull();
  });

  it("does not mount closed, and does not run a close it never opened", () => {
    render(() => <Palette open={false} onClose={() => {}} />);
    expect(box()).toBeNull();
    expect(flag()).toBeNull();
  });
});

describe("morph declines rather than guessing", () => {
  const el = () => {
    const d = document.createElement("div");
    document.body.append(d);
    return d;
  };

  it("returns null where there is no Web Animations API", () => {
    // The whole reason the component has a no-animation path.
    const shell = el();
    expect(typeof (shell as HTMLElement).animate).not.toBe("function");
    expect(morph(shell, el(), "in")).toBeNull();
  });

  it("returns null when the header pill is not on screen", () => {
    const shell = el();
    // Give it an API so the pill is the only thing missing.
    (shell as HTMLElement).animate = vi.fn() as unknown as HTMLElement["animate"];
    expect(document.querySelector(".ask")).toBeNull();
    expect(morph(shell, el(), "in")).toBeNull();
  });

  it("returns null on a zero-sized box rather than flashing", () => {
    const shell = el();
    (shell as HTMLElement).animate = vi.fn() as unknown as HTMLElement["animate"];
    const pill = el();
    pill.className = "ask";
    // jsdom lays nothing out, so every rect is 0x0 - which is exactly the
    // case this guard exists for. Animating from nothing to nothing is a
    // flash, and a flash is worse than the hard cut this replaced.
    expect(morph(shell, el(), "in")).toBeNull();
  });
});
