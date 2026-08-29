// @vitest-environment jsdom
/**
 * What the picker says about branches it does not have.
 *
 * The catalogue carries one branch table. The dropdown therefore listed one
 * option and said nothing about it, so a student from any other branch met a
 * list their branch was missing from with no explanation - and the obvious
 * move from there is to select the branch that IS on offer. That registers
 * somebody else's subjects at somebody else's credits, which is a wrong SGPA
 * denominator arrived at by following the UI rather than by misusing it.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { branches } from "../../engine";
import { edit } from "../../state/store";
import { Setup } from "../Setup";

afterEach(cleanup);

beforeEach(() => {
  edit((d) => {
    d.semesters = { S3: { courses: [] } };
    d.activeSemester = "S3";
    d.student = { ...d.student, branch: branches()[0]! };
  });
});

function toPicker() {
  const view = render(() => <Setup onDone={() => {}} />);
  fireEvent.click(screen.getByText("Get started"));
  fireEvent.click(screen.getByText("Pick from the KTU curriculum"));
  return view.container;
}

describe("branch coverage", () => {
  it("names every branch the catalogue actually carries", () => {
    const text = toPicker().textContent ?? "";
    for (const branch of branches()) expect(text).toContain(branch);
  });

  it("tells a student whose branch is missing what to do instead", () => {
    const text = toPicker().textContent ?? "";
    expect(text).toContain("on file so far");
    expect(text).toContain("Other ways to start");
    // The reason has to be in the sentence. "Your branch is missing" invites
    // picking the nearest one; "wrong credits" does not.
    expect(text).toMatch(/wrong subjects at the wrong credits/);
  });

  it("says how many branches there are without hardcoding one", () => {
    // Pinned to the catalogue rather than to CSE: when a second branch table
    // lands, this test should keep passing and the wording should follow it.
    const text = toPicker().textContent ?? "";
    const expected = branches().length === 1
      ? `Only ${branches()[0]} is on file so far.`
      : `Branches on file so far: ${branches().join(", ")}.`;
    expect(text.replace(/\s+/g, " ")).toContain(expected);
  });
});
