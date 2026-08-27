// @vitest-environment jsdom
/**
 * Smoke test for the Mark component (src/ui/Splash.tsx... actually Mark.tsx).
 *
 * The docblock on Mark.tsx says the two strokes carry an intentional
 * asymmetry (rising stroke brighter, drawn on top) and that the accessible
 * role flips on whether a title is supplied. This test renders the real
 * component and checks both of those claims against the DOM, not the prose.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { Mark } from "../Mark";

afterEach(cleanup);

describe("Mark", () => {
  it("renders two crossing strokes, the rising one in the brighter colour", () => {
    const { container } = render(() => <Mark />);
    const lines = container.querySelectorAll("line");
    expect(lines).toHaveLength(2);

    const falling = lines[0]!;
    const rising = lines[1]!;
    expect(falling.getAttribute("stroke")).toBe("var(--brand-deep)");
    expect(rising.getAttribute("stroke")).toBe("var(--brand)");
  });

  it("is presentation-only with no title, and an accessible image with one", () => {
    const untitled = render(() => <Mark />);
    const untitledSvg = untitled.container.querySelector("svg")!;
    expect(untitledSvg.getAttribute("role")).toBe("presentation");
    expect(untitledSvg.getAttribute("aria-hidden")).toBe("true");
    expect(untitledSvg.hasAttribute("aria-label")).toBe(false);
    untitled.unmount();

    const titled = render(() => <Mark title="TargetX" />);
    const titledSvg = titled.container.querySelector("svg")!;
    expect(titledSvg.getAttribute("role")).toBe("img");
    expect(titledSvg.getAttribute("aria-label")).toBe("TargetX");
    expect(titledSvg.hasAttribute("aria-hidden")).toBe(false);
  });
});
