/**
 * Issue #5, the visible half. When a KTU grade card and the college portal name
 * a different SGPA for one semester, the trusted figure is what the row shows,
 * and the disagreement is stated beneath it rather than dropped. A student who
 * saw the portal be wrong should see TargetX side with KTU and say so, not
 * wonder why a number changed under them.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { defaultTargets } from "../../engine";
import { edit } from "../../state/store";
import { History } from "../History";

const reset = () => {
  edit((s) => {
    s.activeSemester = "S5";
    s.semesters = { S5: { courses: [] } };
    s.history = {};
    s.goal = defaultTargets();
  });
};

beforeEach(reset);
afterEach(cleanup);

describe("a source disagreement is shown, not hidden", () => {
  it("names the winning source's figure and the losing one", () => {
    edit((s) => {
      s.history["S3"] = {
        sgpa: 7.83, creditsRegistered: 20, creditsEarned: 20,
        source: "gradecard", conflict: { source: "etlab", sgpa: 7.2 },
      };
    });
    render(() => <History />);

    // The kept (KTU) figure and the losing (portal) figure both appear.
    expect(screen.getByText(/KTU grade card/i)).toBeTruthy();
    expect(screen.getByText(/college portal said/i)).toBeTruthy();
    expect(screen.getByText("7.20")).toBeTruthy();
  });

  it("says nothing when the sources agree", () => {
    edit((s) => {
      s.history["S3"] = {
        sgpa: 7.83, creditsRegistered: 20, creditsEarned: 20,
        source: "gradecard", conflict: null,
      };
    });
    render(() => <History />);
    expect(screen.queryByText(/college portal said/i)).toBeNull();
  });
});
