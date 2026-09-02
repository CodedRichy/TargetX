// @vitest-environment jsdom
/**
 * Issue #12: the drawer, and the columns it was covering.
 *
 * Reported as the sidebar overlapping the semester data, with details cut off
 * and "sidebar toggling is not enabled". Measured, nothing overlapped: the
 * drawer took a fixed 340px of a 1440px window and the ledger's fourteen
 * columns need ~1253, so Target, Need and Status scrolled off the right edge
 * against the drawer's border. Cut off and covered look the same from the
 * outside, and there was no control anywhere that would move the drawer.
 *
 * The width arithmetic is defended in the layout CSS and measured with a real
 * browser (`npm run build && node tools/ledger-width.mjs`, which fails if a
 * case that has to fit stops fitting); jsdom has no layout, so what is checked here
 * is the part jsdom can actually see - that the control exists, says which
 * state it is in, removes the drawer from the tree rather than hiding it
 * behind it, and that the choice is written to the record so a window that is
 * too narrow this launch is still too narrow the next one.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Course } from "../../engine";
import { App } from "../App";
import { setView } from "../../state/nav";
import { drawerOpen, setDrawerOpen } from "../../state/nav";
import { addCourse, edit, state, updateCourse } from "../../state/store";

afterEach(cleanup);

const COURSE: Partial<Course> = {
  code: "PCCST501", name: "Computer Networks", credits: 4, type: "TH 40/60",
  s1: 38, s2: 31, other: 8, attended: 41, held: 48, dl: 0,
};

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
    d.onboarded = true;
    delete d.drawerOpen;
  });
  addCourse();
  updateCourse(0, COURSE);
  setView("ledger");
});

const toggle = (c: Element) => c.querySelector("button.drawer-toggle") as HTMLButtonElement;

describe("the analytics drawer", () => {
  it("is open on a save that has never been asked", () => {
    // Absent, not false. A record written before this field existed must not
    // open with the panel put away.
    expect(state.drawerOpen).toBeUndefined();
    expect(drawerOpen()).toBe(true);
    const { container } = render(() => <App />);
    expect(container.querySelector("aside.drawer")).toBeTruthy();
  });

  it("has a control, and the control says which state it is in", () => {
    const { container } = render(() => <App />);
    const btn = toggle(container);
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    // Named after what it does to the table, not after itself: "toggle drawer"
    // does not tell a student that this is what gets their columns back.
    expect(btn.getAttribute("aria-label")).toMatch(/full width/i);
  });

  it("takes the drawer out of the layout rather than hiding it", () => {
    // Hidden but still occupying its 340px track would leave the table exactly
    // as cut off as it was, which is the whole complaint.
    const { container } = render(() => <App />);
    toggle(container).click();
    expect(container.querySelector("aside.drawer")).toBeNull();
    expect(container.querySelector(".app")!.classList.contains("no-drawer")).toBe(true);
    expect(toggle(container).getAttribute("aria-pressed")).toBe("false");
  });

  it("writes the choice to the record, so it survives a restart", () => {
    // The reason to close it is a window too narrow to hold both, and a window
    // does not get wider between launches.
    const { container } = render(() => <App />);
    toggle(container).click();
    expect(state.drawerOpen).toBe(false);
    toggle(container).click();
    expect(state.drawerOpen).toBe(true);
  });

  it("offers the control only where the drawer exists", () => {
    // The drawer is the ledger's. A control on Home that hides something not
    // on screen is a control that appears to do nothing.
    setDrawerOpen(true);
    setView("home");
    const { container } = render(() => <App />);
    expect(toggle(container)).toBeNull();
  });
});
