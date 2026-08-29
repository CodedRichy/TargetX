// @vitest-environment jsdom
/**
 * Setup, driven without a mouse.
 *
 * Two controls carried no name. The subject picker draws each row as an `li`
 * with a click handler - unreachable from the keyboard - so the checkbox
 * inside it is the only real control, and it was an unlabelled tick box in a
 * list of twenty. The target-CGPA field on the last step is a bare `input`
 * whose caption sits in a sibling `span`, which names nothing.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultBranch, presetCourses } from "../../engine";
import { edit } from "../../state/store";
import { Setup } from "../Setup";

afterEach(cleanup);

beforeEach(() => {
  edit((d) => {
    d.semesters = { S3: { courses: [] } };
    d.activeSemester = "S3";
    d.student = { ...d.student, branch: defaultBranch() };
  });
});

/** Welcome -> "Pick from the KTU curriculum". */
function toPicker() {
  const view = render(() => <Setup onDone={() => {}} />);
  fireEvent.click(screen.getByText("Get started"));
  fireEvent.click(screen.getByText("Pick from the KTU curriculum"));
  return view.container;
}

describe("the subject picker", () => {
  it("names every tick box after the subject it selects", () => {
    const c = toPicker();
    const boxes = [...c.querySelectorAll<HTMLInputElement>('.picks input[type="checkbox"]')];
    const expected = presetCourses(defaultBranch(), "S3")
      .map((course) => `${course.code} ${course.name}`);
    expect(expected.length).toBeGreaterThan(0);
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(expected);
  });

  it("keeps the tick box operable, which is the only keyboard route in", () => {
    const c = toPicker();
    const first = c.querySelector<HTMLInputElement>('.picks input[type="checkbox"]')!;
    const before = first.checked;
    fireEvent.click(first);
    expect(first.checked).toBe(!before);
  });
});

describe("the goal step", () => {
  it("names the target-CGPA field, whose caption is a sibling span", () => {
    render(() => <Setup onDone={() => {}} />);
    fireEvent.click(screen.getByText("Get started"));
    fireEvent.click(screen.getByText("Start empty"));
    const box = screen.getByLabelText("Target CGPA");
    expect((box as HTMLInputElement).className).toContain("goal-huge");
  });
});
