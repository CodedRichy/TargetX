// @vitest-environment jsdom
/**
 * Issue #13's open half, on screen: can a past month be asked for?
 *
 * The card exists to turn an unknown into an answer from a real portal. Two
 * things have to hold or it is worse than nothing: it must state the negative
 * as plainly as the positive - "the portal only serves this month" is a real
 * finding and the one that would close the question - and what it shows must
 * carry no record, because the whole point is that it can be pasted to someone
 * helping.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Data } from "../Data";
import { edit } from "../../state/store";

afterEach(cleanup);

beforeEach(() => {
  edit((s) => {
    s.semesters = { S5: { courses: [] } };
    s.activeSemester = "S5";
    s.history = {};
    s.onboarded = true;
    delete s.monthControls;
  });
});

const card = (c: Element) =>
  [...c.querySelectorAll("section.card")]
    .find((s) => s.querySelector("h3")?.textContent?.includes("past months"));

describe("the past-months card", () => {
  it("is absent until a sync has actually looked", () => {
    // Nothing to report yet, and a card saying so is noise on a busy screen.
    const { container } = render(() => <Data />);
    expect(card(container)).toBeUndefined();
  });

  it("says the portal serves only this month when nothing was found", () => {
    // The negative is a finding, not a failure - it is what would close the
    // question and stop the issue implying backfill is coming.
    edit((s) => {
      s.monthControls = [{ kind: "none", detail: "no select, link or field on the page names a month or a year" }];
    });
    const { container } = render(() => <Data />);
    expect(card(container)!.textContent).toMatch(/cannot reach back/);
  });

  it("says backfill looks possible when a control was found", () => {
    edit((s) => {
      s.monthControls = [{ kind: "link", detail: "/student/attendance?month=8&year=2026" }];
    });
    const { container } = render(() => <Data />);
    const text = card(container)!.textContent!;
    expect(text).toMatch(/likely possible/);
    // The finding itself is quoted, because that is the thing worth sending.
    expect(text).toContain("/student/attendance?month=8&year=2026");
  });
});
