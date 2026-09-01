// @vitest-environment jsdom
/**
 * The update prompt.
 *
 * This banner is the only thing that will ever tell a student their copy of
 * TargetX computes a mark wrongly, so its two failure modes both matter: a
 * prompt that cannot be dismissed gets read past, and a prompt that vanishes
 * mid-install looks like a crash.
 *
 * The install path is deliberately covered here rather than only in
 * `sync/update.test.ts`: that file proves the progress ARITHMETIC, this one
 * proves the progress is actually shown, and the two have been wrong
 * independently on this project before.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateNotice } from "../App";
import type { Available } from "../../sync/update";

afterEach(cleanup);

const offer = (over: Partial<Available> = {}): Available => ({
  version: "0.2.0",
  notes: null,
  install: vi.fn(async () => {}),
  ...over,
});

describe("what it says before anything is clicked", () => {
  it("names the version on offer", () => {
    render(() => <UpdateNotice update={offer()} onDismiss={() => {}} />);
    expect(screen.getByText(/TargetX 0\.2\.0 is available/)).toBeTruthy();
  });

  it("does not wear `primary`, which is a filled button's class", () => {
    // The offer is a link with a lifted colour. Wearing `primary` as well made
    // it match `button.primary` too, and the scoped colour override left
    // `button.primary:hover` painting --brand-bright behind --brand text -
    // measured at 1.3:1, so the label vanished under the pointer. A stylesheet
    // cannot assert this; the class list is the thing that was wrong.
    const { container } = render(() => <UpdateNotice update={offer()} onDismiss={() => {}} />);
    const install = screen.getByText("Install and restart");
    expect(install.classList.contains("primary")).toBe(false);
    expect(container.querySelector("button.primary")).toBeNull();
  });

  it("can always be refused", () => {
    const onDismiss = vi.fn();
    render(() => <UpdateNotice update={offer()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText("Not now"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("while it is downloading", () => {
  /** An install that reports progress and then hangs, so the UI can be read. */
  function pending() {
    let report!: (f: number | null) => void;
    const started = new Promise<void>(() => { /* never settles */ });
    const install = vi.fn((onProgress?: (f: number | null) => void) => {
      report = onProgress!;
      return started;
    });
    return { update: offer({ install }), report: () => report };
  }

  it("shows a percentage once the size is known", async () => {
    const { update, report } = pending();
    const { container } = render(() => <UpdateNotice update={update} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText("Install and restart"));
    report()(0.42);
    await Promise.resolve();
    expect(container.textContent).toContain("42%");
    // The bar has to move with it - a number changing over a static bar was
    // the exact "is this stuck?" state this replaced.
    const bar = container.querySelector(".update-bar") as HTMLElement;
    expect(bar.style.transform).toBe("scaleX(0.42)");
  });

  it("shows movement, not a zero, when the size is unknown", async () => {
    const { update, report } = pending();
    const { container } = render(() => <UpdateNotice update={update} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText("Install and restart"));
    report()(null);
    await Promise.resolve();
    expect(container.textContent).toContain("Downloading…");
    expect(container.textContent).not.toContain("0%");
    expect(container.querySelector(".update-bar.indeterminate")).toBeTruthy();
  });

  it("withdraws the refusal while installing, so nothing is half-replaced", async () => {
    const { update } = pending();
    render(() => <UpdateNotice update={update} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText("Install and restart"));
    await Promise.resolve();
    expect(screen.queryByText("Not now")).toBeNull();
  });
});

describe("when the install fails", () => {
  it("says so, and offers the install again", async () => {
    // The silent-failure rule covers the CHECK, not this: the student asked
    // for this one and is owed an answer.
    const update = offer({ install: vi.fn(async () => { throw new Error("disk full"); }) });
    const { container } = render(() => <UpdateNotice update={update} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText("Install and restart"));
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).toContain("That update could not be installed");
    expect(screen.getByText("Install and restart")).toBeTruthy();
    expect(screen.getByText("Not now")).toBeTruthy();
  });

  it("says WHY, in the page rather than in a tooltip", async () => {
    // "disk full" and "network unreachable" are different instructions to the
    // student, and the reason lived in a `title` - which is to say nowhere for
    // anyone not hovering, and nowhere at all on a touch screen.
    const update = offer({ install: vi.fn(async () => { throw new Error("disk full"); }) });
    const { container } = render(() => <UpdateNotice update={update} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText("Install and restart"));
    await Promise.resolve();
    await Promise.resolve();
    expect(container.textContent).toContain("disk full");
    // And that the current build is still usable, which is the question the
    // sentence above raises and did not answer.
    expect(container.textContent).toContain("keep using this version");
  });

  it("keeps the failure out of the offer's row", async () => {
    // Both banners are capped at 66ch, so as flex siblings in a wrapping row
    // they fitted side by side on a 1280px window and the failure appeared 600px
    // to the right of the button that had just failed, reading as an unrelated
    // notice. The container stacks; this pins that it still does.
    const update = offer({ install: vi.fn(async () => { throw new Error("nope"); }) });
    const { container } = render(() => <UpdateNotice update={update} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText("Install and restart"));
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector(".launch-notice")!.classList.contains("stack")).toBe(true);
    expect(container.querySelector(".install-failed")).toBeTruthy();
  });
});
