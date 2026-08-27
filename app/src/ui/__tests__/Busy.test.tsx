// @vitest-environment jsdom
/**
 * Smoke test for the Busy component (src/ui/Splash.tsx).
 *
 * The docblock says this is an inline indicator that appears only "when"
 * true, never a full-screen takeover. This renders the real component and
 * checks that the status role and label text are absent when `when` is
 * false, and present with the exact label when `when` is true - it does not
 * assert anything about layout or CSS, only what the DOM actually contains.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Busy } from "../Splash";

afterEach(cleanup);

describe("Busy", () => {
  it("renders nothing when `when` is false", () => {
    const { container } = render(() => <Busy label="Syncing" when={false} />);
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders the status role and label when `when` is true", () => {
    const { container } = render(() => <Busy label="Syncing" when={true} />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain("Syncing");
  });
});
