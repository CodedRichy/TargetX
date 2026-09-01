// @vitest-environment jsdom
/**
 * The bell and the account menu.
 *
 * Both shipped dead. Each one closed itself on the very click that opened it,
 * because Solid delegates every `onClick` to `document` and the close-on-
 * outside-click listener was on `document` as well - `stopPropagation` does
 * not stop other listeners bound to the same node, so the toggle ran and the
 * dismissal ran, in one click, every time.
 *
 * These tests dispatch REAL bubbling events rather than calling the handlers,
 * because the bug lived entirely in how two listeners on one node interleave.
 * A test that invoked the click handler directly would have passed against the
 * broken build.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { setView } from "../../state/nav";
import { edit } from "../../state/store";

afterEach(cleanup);

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
  });
  setView("home");
});

/** A click that bubbles to `document`, which is where the bug was. */
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

describe.each([
  ["notifications", "button.bell", "Notifications"],
  ["the account menu", "button.profile", "Account"],
])("%s", (_name, selector, label) => {
  it("opens on click and stays open", () => {
    const { container } = render(() => <App />);
    const trigger = container.querySelector(selector)!;
    expect(container.querySelector(".pop")).toBeNull();

    click(trigger);
    const pop = container.querySelector(".pop")!;
    expect(pop).not.toBeNull();
    expect(pop.getAttribute("aria-label")).toBe(label);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on a click outside it", () => {
    const { container } = render(() => <App />);
    click(container.querySelector(selector)!);
    expect(container.querySelector(".pop")).not.toBeNull();

    click(document.body);
    expect(container.querySelector(".pop")).toBeNull();
  });

  it("stays open when the click lands inside it", () => {
    const { container } = render(() => <App />);
    click(container.querySelector(selector)!);
    const pop = container.querySelector(".pop")!;

    click(pop);
    expect(container.querySelector(".pop")).not.toBeNull();
  });
});
