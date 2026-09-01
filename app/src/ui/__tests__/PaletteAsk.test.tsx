// @vitest-environment jsdom
/**
 * When the ask box is allowed to leave the machine.
 *
 * The palette answers most questions locally: a stop list, a subsequence match,
 * and figures straight from the engine. That path is free, offline, instant and
 * cannot invent anything. The remote router is strictly a fallback, and the two
 * rules below are what keep it one:
 *
 *   - Enter runs the local hit when there is one, and only reaches the network
 *     when there is nothing to press. A palette that asked on every Enter would
 *     bill a metered API for answers the machine already had.
 *   - Nothing but the question and the course list is ever sent. Marks,
 *     attendance and CGPA stay here, which is what lets an academic tracker put
 *     a question box on top of a third-party model at all.
 *
 * `askRemote` is mocked rather than `fetch`, because the assertion is about
 * WHETHER the palette calls out and with what - not about how the client
 * serialises it. That is `ask.test.ts`'s job and it is tested there.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";

const askRemote = vi.fn();
vi.mock("../../state/ask", () => ({
  askConfigured: () => true,
  askRemote: (...args: unknown[]) => askRemote(...args),
}));
vi.mock("../../state/auth", () => ({ signedIn: () => true }));

const { Palette } = await import("../Palette");

const ML: Partial<Course> = {
  code: "CST305", name: "Machine Learning", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 39, held: 50, dl: 0,
};

function open() {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
  });
  addCourse();
  updateCourse(0, ML);
  return render(() => <Palette open={true} onClose={() => {}} />);
}

const type = (value: string) => {
  const input = screen.getByLabelText("Search subjects and views") as HTMLInputElement;
  fireEvent.input(input, { target: { value } });
  return input;
};

afterEach(() => { cleanup(); askRemote.mockReset(); });
beforeEach(() => {
  askRemote.mockResolvedValue({
    ok: true, action: { kind: "view", view: "attendance" }, remaining: 39,
  });
});

describe("the engine answers first", () => {
  it("does not call out when a subject matched locally", async () => {
    open();
    type("machine learning");
    // There is a row to press, so Enter presses it.
    fireEvent.keyDown(screen.getByLabelText("Search subjects and views"), { key: "Enter" });
    await Promise.resolve();
    expect(askRemote).not.toHaveBeenCalled();
  });

  it("does not call out for a question with no nameable term, which every subject answers", async () => {
    open();
    // "how many classes can i miss" is all stop words, so the palette treats it
    // as a question about every subject and lists them. Nothing to ask.
    type("how many classes can i miss");
    fireEvent.keyDown(screen.getByLabelText("Search subjects and views"), { key: "Enter" });
    await Promise.resolve();
    expect(askRemote).not.toHaveBeenCalled();
  });

  it("does not call out on an empty box", async () => {
    open();
    fireEvent.keyDown(screen.getByLabelText("Search subjects and views"), { key: "Enter" });
    await Promise.resolve();
    expect(askRemote).not.toHaveBeenCalled();
  });
});

describe("the router is the fallback", () => {
  it("asks only once local matching found nothing", async () => {
    open();
    const input = type("zzzqqq");
    expect(screen.getByText(/Nothing here matches/)).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(askRemote).toHaveBeenCalledTimes(1));
  });

  it("sends the question and the course list, and no figure of any kind", async () => {
    open();
    fireEvent.keyDown(type("zzzqqq"), { key: "Enter" });
    await vi.waitFor(() => expect(askRemote).toHaveBeenCalled());

    const [question, subjects] = askRemote.mock.calls[0] as [string, unknown[]];
    expect(question).toBe("zzzqqq");
    // Asserted as an exact payload rather than as "no digits appear": a course
    // code has digits in it, so a regex over the JSON would fail on every real
    // subject while proving nothing. What matters is that the seeded course's
    // 39 of 50 classes and its 38/34/9 marks are not in here, and an equality
    // check on the whole array says that and nothing weaker.
    expect(subjects).toEqual([{ code: "CST305", name: "Machine Learning" }]);
  });

  it("tells the student what happened when the router declines", async () => {
    askRemote.mockResolvedValue({
      ok: true, action: { kind: "none", reason: "off_topic" }, remaining: 39,
    });
    open();
    fireEvent.keyDown(type("zzzqqq"), { key: "Enter" });
    await vi.waitFor(() =>
      expect(screen.getByText(/outside what TargetX knows about/)).toBeTruthy());
  });

  it("says the app still works when there is no connection, rather than only reporting failure", async () => {
    askRemote.mockResolvedValue({ ok: false, kind: "offline" });
    open();
    fireEvent.keyDown(type("zzzqqq"), { key: "Enter" });
    await vi.waitFor(() => expect(screen.getByText(/still works offline/)).toBeTruthy());
  });

  it("refuses to navigate to a subject this student does not have", async () => {
    askRemote.mockResolvedValue({
      ok: true, action: { kind: "subject", code: "NOPE999", view: "attendance" }, remaining: 39,
    });
    open();
    fireEvent.keyDown(type("zzzqqq"), { key: "Enter" });
    await vi.waitFor(() =>
      expect(screen.getByText(/not in this semester/)).toBeTruthy());
  });

  it("clears a stale verdict as soon as the question changes under it", async () => {
    askRemote.mockResolvedValue({ ok: false, kind: "offline" });
    open();
    fireEvent.keyDown(type("zzzqqq"), { key: "Enter" });
    await vi.waitFor(() => expect(screen.getByText(/still works offline/)).toBeTruthy());
    type("zzzqqqw");
    expect(screen.queryByText(/still works offline/)).toBeNull();
  });
});
