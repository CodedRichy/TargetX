// @vitest-environment jsdom
/**
 * Tex's face against the record it claims to read.
 *
 * The reason this file exists: a mascot is the easiest thing in an app to
 * ship broken, because nothing fails when it is wrong. A spinner that never
 * spins gets reported; a face stuck on one expression looks like a design
 * choice. It was in fact stuck on one expression - `overallMood` returns
 * `neutral` whenever no credits are on record, which is every fresh install -
 * and the only way to know whether the other three ever appear is to put a
 * real semester in front of it and read what comes back.
 *
 * So each case seeds courses whose attendance the engine will judge, then
 * asserts BOTH halves: the mood, and that the mood reaches the DOM as
 * different geometry. Asserting the mood alone would pass with a renderer
 * that draws the same face every time, which is the failure being guarded.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Course } from "../../../engine";
import { activeProfile } from "../../../state/schemes";
import { addCourse, edit, updateCourse } from "../../../state/store";
import { Face } from "../Face";
import { overallMood } from "../mood";

afterEach(cleanup);

/** Every mark full, so nothing but attendance can move the verdict. */
const base: Partial<Course> = {
  credits: 4, type: "TH 40/60", s1: 38, s2: 34, other: 9, held: 50, dl: 0,
};

/** 92%: past the full-marks line, nothing being lost. */
const CLEAR: Partial<Course> = { ...base, code: "CST305", attended: 46 };
/** 78%: eligible, and quietly two attendance marks down every week. */
const BLEEDING: Partial<Course> = { ...base, code: "CST303", attended: 39 };
/** 70%: under the eligibility line. */
const SHORT: Partial<Course> = { ...base, code: "CST307", attended: 35 };

function seed(...courses: Partial<Course>[]) {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
  });
  courses.forEach((c, i) => { addCourse(); updateCourse(i, c); });
}

beforeEach(() => seed());

/** The drawn eye, as the renderer actually emitted it. */
function eye(mood: ReturnType<typeof overallMood>) {
  const { container } = render(() => <Face mood={mood} blink={false} track={false} />);
  const rect = container.querySelector("rect")!;
  return {
    width: rect.style.getPropertyValue("width"),
    height: rect.style.getPropertyValue("height"),
    y: rect.style.getPropertyValue("y"),
  };
}

describe("the mood is read off the record, not invented", () => {
  it("has nothing to say about an empty record", () => {
    expect(overallMood()).toBe("neutral");
  });

  it("is pleased when every subject is past the full-marks line", () => {
    seed(CLEAR, { ...CLEAR, code: "CST309" });
    expect(overallMood()).toBe("pleased");
  });

  it("is concerned for a subject that is eligible and still losing marks", () => {
    // The verdict the product exists for. 78% is fine by every other system
    // and is two attendance marks down here, so a face that only reacted to
    // the eligibility line would be as silent about it as the portal is.
    seed(CLEAR, BLEEDING);
    expect(activeProfile().attendanceMin).toBeLessThan(78);
    expect(overallMood()).toBe("concerned");
  });

  it("is alarmed once a subject is under the eligibility line", () => {
    seed(CLEAR, SHORT);
    expect(overallMood()).toBe("alarmed");
  });

  it("lets the worst subject decide, not the average", () => {
    // Three fine and one debarred is not three quarters of a good semester.
    seed(CLEAR, CLEAR, CLEAR, SHORT);
    expect(overallMood()).toBe("alarmed");
  });
});

describe("the face on screen differs per mood", () => {
  it("draws all four record moods as different eyes", () => {
    const drawn = (["neutral", "pleased", "concerned", "alarmed"] as const)
      .map((m) => JSON.stringify(eye(m)));
    expect(new Set(drawn).size).toBe(4);
  });

  it("draws the conversation states differently again", () => {
    // `attentive` and `thinking` are what the assistant shows; if either
    // collapsed onto neutral the palette would look inert while working.
    const drawn = (["neutral", "attentive", "thinking"] as const)
      .map((m) => JSON.stringify(eye(m)));
    expect(new Set(drawn).size).toBe(3);
  });

  it("closes the eye to blink rather than shrinking it", () => {
    // The capsule argument, pinned: a blink is a short eye of ordinary
    // width. If a future edit narrows it too, it has become a dot again.
    const open = eye("neutral");
    const shut = eye("blink" as ReturnType<typeof overallMood>);
    expect(parseFloat(shut.height)).toBeLessThan(parseFloat(open.height) / 5);
    expect(parseFloat(shut.width)).toBeGreaterThan(parseFloat(open.width) * 0.8);
  });
});
