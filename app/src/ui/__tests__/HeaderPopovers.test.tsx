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
 *
 * The panels are queried on `document` rather than on the render container:
 * they are rendered through a Portal into `document.body`, out of the header,
 * because the header carries a backdrop-filter and WebView2 clips a filtered
 * element's descendants to its own box - which painted them and then clipped
 * them away in the shipped app while every test passed.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App, Bell } from "../App";
import { setView } from "../../state/nav";
import { edit } from "../../state/store";
import type { Finding } from "../../state/launch";

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

/**
 * A real press: pointerdown then click, both bubbling to `document`.
 *
 * Both are needed and in this order. The outside-dismissal listener is on
 * pointerdown - a click listener was handed already-detached nodes when a row
 * removed itself - and the buttons themselves are driven by click. A helper
 * that fired only one of the two would test a sequence no pointer produces.
 */
const click = (el: Element) => {
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};

describe.each([
  ["notifications", "button.bell", "Notifications"],
  ["the account menu", "button.profile", "Account"],
])("%s", (_name, selector, label) => {
  it("opens on click and stays open", () => {
    const { container } = render(() => <App />);
    const trigger = container.querySelector(selector)!;
    expect(document.querySelector(".pop")).toBeNull();

    click(trigger);
    const pop = document.querySelector(".pop")!;
    expect(pop).not.toBeNull();
    expect(pop.getAttribute("aria-label")).toBe(label);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("closes on a click outside it", () => {
    const { container } = render(() => <App />);
    click(container.querySelector(selector)!);
    expect(document.querySelector(".pop")).not.toBeNull();

    click(document.body);
    expect(document.querySelector(".pop")).toBeNull();
  });

  it("stays open when the click lands inside it", () => {
    const { container } = render(() => <App />);
    click(container.querySelector(selector)!);
    const pop = document.querySelector(".pop")!;

    click(pop);
    expect(document.querySelector(".pop")).not.toBeNull();
  });
});

/**
 * Dismissal.
 *
 * `Bell` is rendered directly with fixed findings rather than through `App`.
 * The launch check hands its findings over on a 450ms timer, so a test that
 * mounted the whole app and looked immediately would find an empty popover and
 * every assertion below would pass by describing nothing.
 *
 * A finding is re-derived from the record on every launch, so dismissing one
 * cannot mean "never mention this again" - it means "I have read it". The
 * per-row control is covered rather than only the bulk one, because clearing
 * three unrelated problems together is the behaviour that would actually lose a
 * student a warning they had not dealt with yet.
 */
describe("dismissing notifications", () => {
  const FINDINGS: Finding[] = [
    { kind: "attendance", severity: "warn", title: "1 subject below the floor",
      detail: "MICROCONTROLLERS is under 75%.", goto: "ledger", action: "See which" },
    { kind: "stale", severity: "info", title: "Last synced 6 days ago",
      detail: "Attendance may have moved since.", goto: "data", action: "Sync now" },
    { kind: "reconcile", severity: "warn", title: "S3 does not reconcile",
      detail: "The published SGPA disagrees with the stored subjects.",
      goto: "history", action: "Open History" },
  ];

  const openBell = () => {
    const { container } = render(() => <Bell findings={FINDINGS} />);
    click(container.querySelector("button.bell")!);
    return container;
  };

  it("shows every finding", () => {
    openBell();
    expect(document.querySelectorAll(".pop-item").length).toBe(3);
  });

  it("removes the row that was dismissed and leaves the others", () => {
    const container = openBell();
    click(document.querySelectorAll(".pop-x")[1]!);

    const titles = [...document.querySelectorAll(".pop-item strong")]
      .map((n) => n.textContent);
    expect(titles).toEqual(["1 subject below the floor", "S3 does not reconcile"]);
  });

  it("keeps the popover open after a dismissal", () => {
    const container = openBell();
    click(document.querySelector(".pop-x")!);
    expect(document.querySelector(".pop")).not.toBeNull();
  });

  it("counts the badge down as rows go", () => {
    const container = openBell();
    expect(container.querySelector(".bell-badge")!.textContent).toBe("3");

    click(document.querySelector(".pop-x")!);
    expect(container.querySelector(".bell-badge")!.textContent).toBe("2");
  });

  it("clears everything at once, and closes", () => {
    const container = openBell();
    click(document.querySelector(".pop-head .link")!);

    expect(document.querySelector(".pop")).toBeNull();
    expect(container.querySelector(".bell-badge")).toBeNull();
  });

  it("offers no bulk control for a single finding", () => {
    const { container } = render(() => <Bell findings={[FINDINGS[0]!]} />);
    click(container.querySelector("button.bell")!);
    expect(document.querySelector(".pop-head .link")).toBeNull();
  });
});
