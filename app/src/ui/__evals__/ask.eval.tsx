// @vitest-environment jsdom
/**
 * The ask box, watched.
 *
 * NOT a test - it asserts almost nothing and is excluded from the normal run
 * (`*.eval.tsx` is outside vitest's default include). It renders the REAL
 * palette, types a list of questions into it, and prints what a student would
 * actually see: which topic the engine picked, what it said, and what rows it
 * offered in what order.
 *
 * It exists because the app answers most questions locally and never tells
 * anyone: a wrong local answer is invisible to the Worker's log, so the only
 * record of the assistant being wrong was someone saying so. Run it, read the
 * table, and the failure modes are in front of you.
 *
 *   npx vitest run --include "**\/*.eval.tsx" --reporter=basic
 *
 * Add questions to PROMPTS. Keep real phrasings - the ones people actually
 * type, misspellings included.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, it, vi } from "vitest";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";

vi.mock("../../state/ask", () => ({
  askConfigured: () => true,
  askRemote: vi.fn(async () => ({ ok: false, kind: "failed" })),
}));
vi.mock("../../state/auth", () => ({
  signedIn: () => true, authConfigured: () => true,
  authBusy: () => false, signIn: vi.fn(),
}));

const { Palette } = await import("../Palette");

const COURSES: Partial<Course>[] = [
  { code: "CST305", name: "Machine Learning", credits: 4, type: "TH 40/60",
    s1: 38, s2: 34, other: 9, attended: 39, held: 50, dl: 0 },
  { code: "CST303", name: "Computer Networks", credits: 4, type: "TH 40/60",
    s1: 30, s2: 28, other: 8, attended: 44, held: 50, dl: 0 },
  { code: "GAMAT401", name: "Engineering Mathematics", credits: 3, type: "TH 40/60",
    s1: 22, s2: 25, other: 7, attended: 30, held: 50, dl: 0 },
];

const PROMPTS = [
  // The ones the app is built to answer.
  "how many classes can i miss",
  "can i skip tomorrow",
  "what do i need to pass cn",
  "how many can i miss in ml",
  "am i failing anything",
  "where do i stand",
  "what is my cgpa",
  // Definitions, which should come from the glossary.
  "what is condonation",
  "what is cie",
  "how is sgpa calculated",
  // Questions about rules, not about this student.
  "how does attendance affect marks",
  "what is the pass mark",
  // The reported misfire and its neighbours.
  "what happens if i miss the series exam",
  "what happens if i fail the series exam",
  "when is the series exam",
  "what if i miss an exam",
  // Things TargetX genuinely does not hold.
  "what is the hostel fee",
  "when is my exam hall ticket out",
  "who is teaching ml",
  // Sloppy real typing.
  "cn attendance",
  "ml marks",
  "how badly would a leave tomorrow affect my attendance",
];

afterEach(cleanup);

function open() {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
  });
  COURSES.forEach((c, i) => { addCourse(); updateCourse(i, c); });
  return render(() => <Palette open={true} onClose={() => {}} />);
}

describe("ask box behaviour", () => {
  it("prints what each question actually produces", () => {
    const { container } = open();
    const input = screen.getByLabelText("Search subjects and views") as HTMLInputElement;

    const lines: string[] = [];
    for (const q of PROMPTS) {
      fireEvent.input(input, { target: { value: q } });

      const panel = container.querySelector(".palette-answer");
      const who = panel?.querySelector(".palette-answer-who")?.textContent?.trim() ?? "";
      const head = panel?.querySelector(".palette-answer-head")?.textContent?.trim() ?? "";
      const rows = [...container.querySelectorAll('[role="option"]')].map((el) => {
        const kind = el.querySelector(".palette-kind")?.textContent?.trim() ?? "?";
        const label = el.querySelector(".palette-label")?.textContent?.trim() ?? "";
        const sel = el.getAttribute("aria-selected") === "true" ? "*" : " ";
        return `${sel}${kind}:${label}`;
      });

      lines.push([
        `Q  ${q}`,
        `A  ${head === "" ? "(engine said nothing)" : head}`,
        `   ${who === "" ? "" : who}`,
        `R  ${rows.length === 0 ? "(no rows)" : rows.join(" | ")}`,
        "",
      ].join("\n"));
    }
    // eslint-disable-next-line no-console
    console.log("\n" + lines.join("\n"));
  });
});
