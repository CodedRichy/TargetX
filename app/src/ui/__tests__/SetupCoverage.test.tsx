// @vitest-environment jsdom
/**
 * What the picker says about how far its curriculum reaches.
 *
 * The catalogue used to hold one branch table, so the branch dropdown listed
 * one option and said nothing about it: a student from any other branch met a
 * list their branch was missing from, and the move that screen invites is to
 * select the branch that IS on offer - somebody else's subjects at somebody
 * else's credits, a wrong SGPA denominator reached by following the UI.
 *
 * KTU sets the first year by GROUP rather than by branch, so S1 and S2 are now
 * on file for every branch in Groups A and B. What is per-branch is everything
 * after it, and the screen has to say which is which - both so a student who
 * reaches S3 knows nothing has been lost, and so one offered two semesters does
 * not read that as the whole curriculum.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branches, defaultBranch, semesterKeys } from "../../engine";
import { edit } from "../../state/store";
import { Setup } from "../Setup";

afterEach(cleanup);

beforeEach(() => {
  edit((d) => {
    d.semesters = { S1: { courses: [] } };
    d.activeSemester = "S1";
    d.student = { ...d.student, branch: defaultBranch() };
  });
});

function toPicker() {
  const view = render(() => <Setup onDone={() => {}} />);
  fireEvent.click(screen.getByText("Get started"));
  fireEvent.click(screen.getByText("Pick from the KTU curriculum"));
  return view.container;
}

const flat = (c: HTMLElement) => (c.textContent ?? "").replace(/\s+/g, " ");

describe("branch coverage", () => {
  it("offers every branch the catalogue can seed, not just the transcribed one", () => {
    const options = [...toPicker().querySelectorAll("select")]
      .flatMap((s) => [...s.options].map((o) => o.value));
    for (const branch of branches()) expect(options).toContain(branch);
    // The whole point of keying the first year by group: this is not a list of
    // one. If it ever collapses back to one, the notice below is wrong too.
    expect(branches().length).toBeGreaterThan(10);
  });

  it("starts on the branch whose whole curriculum is on file", () => {
    // Alphabetically first is arbitrary and now lands on a branch carrying only
    // a first year, which reads as an app that has lost six semesters.
    const select = toPicker().querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe(defaultBranch());
    expect(semesterKeys(defaultBranch()).length).toBeGreaterThan(2);
  });

  it("says a fully transcribed branch is complete", () => {
    const text = flat(toPicker());
    expect(text).toContain(`All ${semesterKeys(defaultBranch()).length} semesters`);
  });
});

describe("a branch with only the first year", () => {
  /** Any branch that leans on its group table rather than its own. */
  const firstYearOnly = branches().find((b) => semesterKeys(b).length === 2);

  it("exists — otherwise the rest of this block proves nothing", () => {
    expect(firstYearOnly).toBeDefined();
  });

  it("explains that the first year is KTU's, and later semesters are not here", () => {
    const container = toPicker();
    const select = container.querySelector<HTMLSelectElement>("select")!;
    fireEvent.change(select, { target: { value: firstYearOnly! } });
    const text = flat(container);
    expect(text).toContain("one first-year table for every branch in a group");
    expect(text).toContain("Other ways to start");
    // The reason has to be in the sentence. "Not transcribed yet" invites
    // picking the nearest branch instead; naming the cost does not.
    expect(text).toContain("wrong subjects at the wrong credits");
  });

  it("does not leave the semester select holding a semester it has no table for", () => {
    const container = toPicker();
    const [branchSelect, semesterSelect] =
      [...container.querySelectorAll<HTMLSelectElement>("select")];
    fireEvent.change(semesterSelect!, { target: { value: "S5" } });
    fireEvent.change(branchSelect!, { target: { value: firstYearOnly! } });
    expect(semesterKeys(firstYearOnly!)).toContain(semesterSelect!.value);
  });
});
