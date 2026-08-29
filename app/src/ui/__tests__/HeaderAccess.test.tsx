// @vitest-environment jsdom
/**
 * The header, which is also the title bar.
 *
 * Two things in it were unreachable by name. The wordmark's X is a drawing,
 * and `Mark` hides itself from the accessibility tree unless it is given a
 * title - so the only `h1` on the screen announced as "Target", losing the
 * last letter of the product's name. The add-semester button is drawn as a
 * plus sign, and a glyph is the accessible name unless one is supplied.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Course } from "../../engine";
import { App } from "../App";
import { Mark } from "../Mark";
import { setView } from "../../state/nav";
import { addCourse, edit, updateCourse } from "../../state/store";

afterEach(cleanup);

const COURSE: Partial<Course> = {
  code: "CST303", name: "Compiler Design", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 45, held: 50, dl: 0,
};

// jsdom has no `matchMedia`, and `startTheme` asks for the OS colour scheme
// the moment `App` mounts. Stubbed rather than mocked out, so the component
// under test is the real one.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: (q: string) => ({
      matches: false, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
    // Setup is a takeover that runs until it is finished, not until data
    // exists, so without this `App` renders the onboarding flow and there is
    // no header to check.
    d.onboarded = true;
  });
  addCourse();
  updateCourse(0, COURSE);
  // The semester switcher belongs to the ledger view, and Home is the landing
  // screen.
  setView("ledger");
});

describe("the wordmark", () => {
  it("is announced with its X, not as 'Target'", () => {
    const { container } = render(() => <App />);
    const h1 = container.querySelector("h1.wordmark")!;
    const mark = h1.querySelector("svg")!;
    expect(mark.getAttribute("role")).toBe("img");
    expect(mark.getAttribute("aria-label")).toBe("X");
    expect(mark.getAttribute("aria-hidden")).toBeNull();
  });

  it("still hides the mark wherever it is decoration", () => {
    const { container } = render(() => <Mark size="24" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBe("presentation");
  });
});

describe("the semester switcher", () => {
  it("names the add button after what it does, not after its glyph", () => {
    const { container } = render(() => <App />);
    const add = [...container.querySelectorAll("nav.sems button")]
      .find((b) => b.textContent === "+")!;
    expect(add).toBeTruthy();
    expect(add.getAttribute("aria-label")).toBe("Add the next semester");
  });

  it("marks the semester in view, so the choice is not colour alone", () => {
    const { container } = render(() => <App />);
    const sems = [...container.querySelectorAll("nav.sems button")]
      .filter((b) => b.textContent !== "+");
    expect(sems.map((b) => b.textContent)).toEqual(["S5"]);
    expect(sems[0]!.getAttribute("aria-current")).toBe("true");
  });
});
