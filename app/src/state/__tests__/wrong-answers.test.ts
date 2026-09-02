/**
 * Four questions the box answered confidently and wrongly.
 *
 * Found by running the real palette over the questions a student actually
 * types (`src/ui/__evals__/ask.eval.tsx`) and reading the output, rather than
 * by asserting the behaviour the code was written to have. Each case here was
 * observed, not imagined, and each fails if its fix is reverted.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Course } from "../../engine";
import { answerFor, detectTopic } from "../answers";
import { addCourse, edit, rows, updateCourse } from "../store";

const ML: Partial<Course> = {
  code: "CST305", name: "Machine Learning", credits: 4, type: "TH 40/60",
  s1: 30, s2: 28, other: 8, held: 50, attended: 39, dl: 0,
};
const CN: Partial<Course> = {
  code: "CST303", name: "Computer Networks", credits: 4, type: "TH 40/60",
  s1: 32, s2: 30, other: 9, held: 50, attended: 44, dl: 0,
};

beforeEach(() => {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
    d.timetable = undefined;
    d.onboarded = true;
  });
  addCourse(); updateCourse(0, ML);
  addCourse(); updateCourse(1, CN);
});

describe("a subject named exactly outranks one matched by scattered letters", () => {
  it("answers 'cn attendance' about Computer Networks, not Machine Learning", () => {
    // "cn" is the initials of Computer Networks AND a subsequence of
    // Ma-c-hi-n-e Learning. Taking the first row that matched by any rule
    // answered about the wrong subject with full confidence - the worst
    // failure this box can have, because the number quoted is real.
    const answer = answerFor("attendance_now", "CST303");
    expect(answer?.headline).toContain("Computer Networks");
    // Guards the ranking itself: ML must still be reachable by its own name.
    expect(answerFor("attendance_now", "CST305")?.headline)
      .toContain("Machine Learning");
  });
});

describe("an exam is not a class", () => {
  it.each([
    "what happens if i miss the series exam",
    "what if i miss an exam",
    "what happens if i skip the test",
  ])("declines %j rather than pricing an absence", (q) => {
    expect(detectTopic(q)).toBeNull();
  });

  it("still answers the attendance questions it was gating", () => {
    expect(detectTopic("what happens if i miss a class")).toBe("skip_cost");
    expect(detectTopic("how many classes can i miss")).toBe("budget");
  });

  it("does not gate a question that merely names an exam", () => {
    // Narrowness is the point: gating on the exam word alone would trade two
    // misfires for a silence on the question the app exists to answer.
    expect(detectTopic("what do i need to pass the exam")).toBe("need_to_pass");
  });
});

describe("tomorrow says what it is missing instead of nothing", () => {
  it("names the timetable as the gap", () => {
    // The headline feature returned null for every student without a
    // timetable, so the box offered a screen and the app looked as though it
    // had never heard of its own advertised trick.
    const answer = answerFor("tomorrow");
    expect(answer).not.toBeNull();
    expect(answer!.isGap).toBe(true);
    expect(answer!.headline).toMatch(/timetable/i);
    // A gap asserts nothing about this student, so it must not be attributed
    // to their record.
    expect(answer!.lines).toEqual([]);
  });
});

describe("the plainest question there is", () => {
  it("reads 'ml marks' as a question about internal marks", () => {
    expect(detectTopic("ml marks")).toBe("marks_now");
    expect(detectTopic("what are my internals")).toBe("marks_now");
  });

  it("quotes the CIE the engine computed, to the ledger's precision", () => {
    const answer = answerFor("marks_now", "CST305");
    expect(answer?.headline).toContain("Machine Learning");
    // Re-derived, never copied from a run.
    const ev = rows().find((r) => r.course.code === "CST305")!.ev;
    const mk = (v: number) => v.toFixed(1).replace(/\.0$/, "");
    expect(answer!.headline).toContain(`${mk(ev.cie)} of ${mk(ev.cieMax)}`);
  });

  it("still lets the attendance question win when both words appear", () => {
    // "How many marks do i lose if i miss a class" says "marks", but it is a
    // question about skipping. The new topic sits AFTER every attendance
    // branch precisely so it cannot steal these.
    expect(detectTopic("how many marks do i lose if i miss a class"))
      .toBe("budget");
    expect(detectTopic("how many marks does one more absence cost"))
      .toBe("skip_cost");
  });
});

describe("a question about one paper is not a question about the whole internal", () => {
  it.each([
    ["how bad are my internal 1 marks", "series_1"],
    ["what did i get in series 1", "series_1"],
    ["series 2 marks", "series_2"],
    ["how was my second internal", "series_2"],
    ["s1 marks", "series_1"],
  ])("reads %j as %s", (q, topic) => {
    // Observed live: "how bad are my internal 1 marks" was answered with the
    // whole CIE. The number asked for was sitting in the record as `s1`, and
    // no question shape could reach it.
    expect(detectTopic(q)).toBe(topic);
  });

  it("still reads a plain marks question as the aggregate", () => {
    expect(detectTopic("ml marks")).toBe("marks_now");
    expect(detectTopic("what are my internals")).toBe("marks_now");
  });

  it("quotes the raw mark and what it is worth, both from the engine", () => {
    const answer = answerFor("series_1", "CST305");
    expect(answer?.headline).toContain("Machine Learning");
    // Re-derived, never copied from a run: the portal shows the raw mark and
    // the CIE is built from the scaled one, and a student comparing the two
    // otherwise concludes the app is wrong.
    expect(answer!.headline).toContain("30");
    expect(answer!.headline).toMatch(/worth .* in the CIE/);
  });

  it("says a paper is unpublished rather than calling it zero", () => {
    updateCourse(0, { s2: null });
    expect(answerFor("series_2", "CST305")?.headline).toMatch(/not published yet/);
  });
});
