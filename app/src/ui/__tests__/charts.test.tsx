/**
 * The two rules that stop a chart from being a function of its container.
 *
 * `viewBox="0 0 300 130" width="100%"` does not mean "fill the width" - it
 * means "scale the whole drawing by container/300". In Home's 784px-wide Trend
 * tile that produced a 340px-tall chart with 8px axis labels drawn at 21px,
 * and in the 324px drawer the same labels came out at 7.4px. The drawing was
 * only ever correct at exactly 300px wide, and the height it took was
 * whatever the layout happened to give it - which is how Home came to overflow
 * its own scroller by 519px at 1280x800.
 *
 * Neither of these is checkable by eye on one screen size, which is why they
 * are pinned here rather than left to the screenshot pass.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";
import { AttendanceScatter, TrendChart } from "../charts";

afterEach(cleanup);

const points = [
  { name: "S1", sgpa: 7.95, credits: 20 },
  { name: "S2", sgpa: 7.48, credits: 23 },
];

describe("a chart's height", () => {
  it("is a fixed number of pixels, not a share of its width", () => {
    const { container } = render(() => <TrendChart data={points} cgpa={7.7} />);
    const svg = container.querySelector("svg")!;
    // The specific number matters less than that there IS one: a percentage
    // here is the defect, because it makes the height follow the width.
    expect(svg.getAttribute("height")).toBe("150");
    expect(svg.getAttribute("width")).not.toMatch(/%/);
  });

  it("is fixed on the scatter too", () => {
    const { container } = render(() => (
      <AttendanceScatter points={[{ code: "PCCST501", attendance: 85, cie: 30, cieMax: 40 }]} />
    ));
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("height")).toBe("190");
    expect(svg.getAttribute("width")).not.toMatch(/%/);
  });

  it("draws at one user unit per CSS pixel, so the type is the size it says", () => {
    // The viewBox width tracks the measured width rather than a constant 300.
    // jsdom has no ResizeObserver, so this is the documented fallback - the
    // point of the assertion is the pairing of viewBox to width, not the 300.
    const { container } = render(() => <TrendChart data={points} cgpa={7.7} />);
    const svg = container.querySelector("svg")!;
    const [, , boxWidth, boxHeight] = svg.getAttribute("viewBox")!.split(" ");
    expect(boxWidth).toBe(svg.getAttribute("width"));
    expect(boxHeight).toBe(svg.getAttribute("height"));
  });
});

describe("the attendance thresholds", () => {
  it("label the 60% floor and the 75% line on separate baselines", () => {
    // They are 15 points apart on a 60-point axis, so at any narrow width a
    // shared baseline runs the first caption into the second line.
    const { container } = render(() => (
      <AttendanceScatter points={[{ code: "PCCST501", attendance: 85, cie: 30, cieMax: 40 }]} />
    ));
    const labels = [...container.querySelectorAll("text")]
      .filter((t) => /FLOOR|ELIGIBLE/.test(t.textContent ?? ""));
    expect(labels).toHaveLength(2);
    expect(labels[0]!.getAttribute("y")).not.toBe(labels[1]!.getAttribute("y"));
  });
});
