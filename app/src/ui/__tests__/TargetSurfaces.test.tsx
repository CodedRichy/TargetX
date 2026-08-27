// @vitest-environment jsdom
/**
 * The two target surfaces that read the real store.
 *
 * `GoalBar` and `Drawer` cannot be handed props, so the store is seeded from
 * localStorage before either module is imported - `vi.hoisted` runs ahead of
 * the import graph, and `store.ts` reads localStorage once at module scope.
 * The seed is one semester with three attendance states chosen so the two
 * counts in the goal bar DISAGREE, which is the whole reason they are two
 * counts.
 *
 * Measured for this fixture, and asserted below rather than narrated:
 *   CST301 44/62 = 70.97%  - below 75 AND below 85
 *   CST303 48/60 = 80%     - eligible, below 85
 *   CST305 57/60 = 95%     - above both
 * so `lowAttendance` holds 1 and the personal list holds 2.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const state = {
    version: 1,
    scheme: "KTU 2024",
    student: { name: "", reg_no: "", branch: "", college: "" },
    activeSemester: "S5",
    etlab: {},
    semesters: {
      S5: {
        courses: [
          { code: "CST301", name: "Formal Languages", credits: 4, type: "TH 40/60",
            s1: 32, s2: 28, other: 8, attended: 44, held: 62, dl: 0, target: "A" },
          { code: "CST303", name: "Computer Networks", credits: 4, type: "TH 40/60",
            s1: 38, s2: 34, other: 9, attended: 48, held: 60, dl: 0, target: "A+" },
          { code: "CST305", name: "System Software", credits: 4, type: "TH 40/60",
            s1: 41, s2: 39, other: 9, attended: 57, held: 60, dl: 0, target: "S" },
        ],
      },
    },
    history: { S1: { sgpa: 7.8, creditsRegistered: 21, creditsEarned: 21 } },
    goal: { cgpa: 8.6, attendance: 85, sgpaBySemester: { S5: 8.2 }, sgpaDefault: 8 },
    onboarded: true,
  };
  globalThis.localStorage.setItem("targetx.state.v1", JSON.stringify(state));
});

const { GoalBar } = await import("../App");
const { Drawer } = await import("../Drawer");
const { attendanceGaps, summary } = await import("../../state/store");

afterEach(cleanup);

describe("the goal bar carries two attendance counts, not one", () => {
  it("counts the regulation shortage and the personal shortfall separately", () => {
    // The two lists are different sizes on this fixture, which is what makes
    // merging them a lie rather than a simplification.
    expect(summary().lowAttendance.length).toBe(1);
    expect(attendanceGaps().filter(
      (g) => g.toTarget !== null && g.toTarget.state === "deficit").length).toBe(2);

    const { container } = render(() => <GoalBar />);
    const out = container.textContent ?? "";
    expect(out).toContain("2 below your 85% target");
    expect(out).toContain("1 short of 75%");
  });

  it("gives the two counts different pills, so they do not read as one status", () => {
    const { container } = render(() => <GoalBar />);
    expect(container.querySelector(".pill.mine")).not.toBeNull();
    expect(container.querySelector(".pill.shortage")).not.toBeNull();
  });

  it("offers the attendance target beside the CGPA one", () => {
    const { container } = render(() => <GoalBar />);
    const out = container.textContent ?? "";
    expect(out).toContain("Target CGPA");
    expect(out).toContain("Target attendance");
    const att = container.querySelector("#att-target") as HTMLInputElement | null;
    expect(att).not.toBeNull();
    expect(att!.value).toBe("85");
  });
});

describe("the drawer's Targets tab", () => {
  it("is offered beside analytics and the glossary", () => {
    const { container } = render(() => <Drawer />);
    const labels = Array.from(container.querySelectorAll(".drawer-tabs button"))
      .map((b) => b.textContent);
    expect(labels).toEqual(["Analytics", "Targets", "What the columns mean"]);
  });

  it("does not render a route under the analytics heading any more", () => {
    // The two routes chase different numbers and now live together on the
    // Targets tab. Analytics keeps the readings and says where the routes went.
    const { container } = render(() => <Drawer />);
    const out = container.textContent ?? "";
    expect(out).toContain(
      "The route to this goal, and the route to this semester's own SGPA target,"
      + " are on the Targets tab — side by side, because they are different numbers.");
    expect(out).not.toContain("Cheapest route");
  });

  it("shows both routes, each naming its own target, when Targets is opened", () => {
    const { container, getByText } = render(() => <Drawer />);
    getByText("Targets").click();
    const out = container.textContent ?? "";
    expect(out).toContain("Route to your S5 target");
    expect(out).toContain("Route to your CGPA goal");
    // Two headings is not enough: the numbers under them must differ, or the
    // student is being shown one answer twice.
    expect(out).toContain("the SGPA you set for S5");
    expect(out).toContain("the average a 8.60 CGPA needs from S5 on");
  });

  it("edits every target the engine stores, and never a regulation", () => {
    const { container, getByText } = render(() => <Drawer />);
    getByText("Targets").click();
    for (const id of ["#t-cgpa", "#t-att", "#t-sem", "#t-sgpa-default"]) {
      expect(container.querySelector(id)).not.toBeNull();
    }
    // The regulation block is inside the same tab and holds no control.
    const floors = container.querySelector(".floors");
    expect(floors).not.toBeNull();
    expect(floors!.querySelector("input")).toBeNull();
  });

  it("lists the subjects under the personal target, with both answers", () => {
    const { container, getByText } = render(() => <Drawer />);
    getByText("Targets").click();
    expect(container.textContent).toContain("Below your own target");
    // Scoped to the list itself: CST305 is at 95% and belongs on neither
    // attendance list, but it is in both route panels and asserting over the
    // whole tab would only prove that.
    const codes = Array.from(container.querySelectorAll(".gap-row .gap-code"))
      .map((n) => n.textContent);
    expect(codes).toEqual(["CST301", "CST303"]);
    const answers = Array.from(container.querySelectorAll(".gap-row .gap-answer"))
      .map((n) => n.textContent);
    expect(answers).toEqual([
      "attend 58 in a row", "attend 10 in a row",
      "attend 20 in a row", "room to miss 4",
    ]);
  });
});
