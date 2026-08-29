// @vitest-environment jsdom
/**
 * Names and announcements on the screens either side of the ledger.
 *
 * The audit that produced this file measured 7 of 13 files in `src/ui` as
 * containing no `aria-` attribute or `role` at all. The gaps were of one
 * kind: a control whose only label was a colour, a glyph, or a heading in a
 * different cell. Each fix here is a string, and a string that claims a
 * behaviour the code does not have is the largest defect class this project
 * has logged - so every one of them is rendered below rather than described.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Course } from "../../engine";
import { SaveNotice, UpdateNotice } from "../App";
import { Data } from "../Data";
import { Drawer } from "../Drawer";
import { History } from "../History";
import { addCourse, edit, setSaveFault, updateCourse } from "../../state/store";

afterEach(() => {
  cleanup();
  setSaveFault(null);
});

const COURSE: Partial<Course> = {
  code: "CST303", name: "Compiler Design", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 45, held: 50, dl: 0,
};

beforeEach(() => {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = { S4: { sgpa: 8.1, creditsRegistered: 22, creditsEarned: 22 } };
  });
  addCourse();
  updateCourse(0, COURSE);
});

describe("the drawer", () => {
  it("names itself, so the charts and the glossary are findable as a landmark", () => {
    const { container } = render(() => <Drawer />);
    const aside = container.querySelector("aside.drawer")!;
    expect(aside.getAttribute("aria-label"))
      .toBe("Analytics, targets and column glossary");
  });

  it("says which panel is showing rather than only colouring the button", () => {
    const { container } = render(() => <Drawer />);
    const tabs = [...container.querySelectorAll(".drawer-tabs button")];
    expect(tabs.map((t) => t.getAttribute("aria-pressed")))
      .toEqual(["true", "false", "false"]);
    fireEvent.click(tabs[2]!);
    expect(tabs.map((t) => t.getAttribute("aria-pressed")))
      .toEqual(["false", "false", "true"]);
  });
});

describe("the data screen", () => {
  it("names the paste boxes, which had no label of any kind", () => {
    render(() => <Data />);
    expect(screen.getByLabelText("Rows copied from your portal")).toBeTruthy();
    expect(screen.getByLabelText("Grade card text")).toBeTruthy();
  });

  it("says which of the two paste modes is selected", () => {
    const { container } = render(() => <Data />);
    const seg = container.querySelector(".seg")!;
    expect(seg.getAttribute("aria-label")).toBe("What you are pasting");
    const [attendance, marks] = [...seg.querySelectorAll("button")];
    expect(attendance!.getAttribute("aria-pressed")).toBe("true");
    expect(marks!.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(marks!);
    expect(attendance!.getAttribute("aria-pressed")).toBe("false");
    expect(marks!.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps focus on the erase confirmation instead of dropping it on the body",
     async () => {
    const { container } = render(() => <Data />);
    const erase = [...container.querySelectorAll("button.danger")]
      .find((b) => b.textContent === "Erase everything")!;
    (erase as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(erase);

    fireEvent.click(erase);
    const confirm = container.querySelector(".notice.bad")!;
    expect(confirm.getAttribute("aria-label")).toBe("Confirm erasing everything");
    // A microtask, because the node has to exist before it can be focused.
    await Promise.resolve();
    expect(document.activeElement).toBe(confirm);
    // NOT the destructive button: a second Enter on the way past would have
    // taken every mark on the machine with it.
    expect(document.activeElement!.tagName).not.toBe("BUTTON");
  });
});

describe("the history table", () => {
  it("names each row by its semester and each box by what it holds", () => {
    const { container } = render(() => <History />);
    const rowHead = container.querySelector("tbody th")!;
    expect(rowHead.getAttribute("scope")).toBe("row");
    // S4 first: the table is ordered oldest semester down.
    expect(rowHead.textContent).toBe("S4");
    expect([...container.querySelectorAll("thead th")]
      .every((h) => h.getAttribute("scope") === "col")).toBe(true);
    expect(screen.getByLabelText("Published SGPA for S4")).toBeTruthy();
    expect(screen.getByLabelText("Registered credits for S4")).toBeTruthy();
    expect(screen.getByLabelText("Published SGPA for S5")).toBeTruthy();
    expect(screen.getByLabelText("Registered credits for S5")).toBeTruthy();
  });
});

describe("the banners that arrive on their own", () => {
  it("announces a save that is not landing, politely", () => {
    setSaveFault({ kind: "file", error: "Access is denied. (os error 5)" });
    const { container } = render(() => <SaveNotice />);
    const region = container.querySelector(".launch-notice")!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toContain("Your marks are not being saved");
  });

  it("announces an update once, and does not re-read the download percentage",
     () => {
    const { container } = render(() => (
      <UpdateNotice
        update={{ version: "1.4.0", notes: null, install: async () => {} }}
        onDismiss={() => {}}
      />
    ));
    const region = container.querySelector(".launch-notice")!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.textContent).toContain("TargetX 1.4.0 is available");
  });
});
