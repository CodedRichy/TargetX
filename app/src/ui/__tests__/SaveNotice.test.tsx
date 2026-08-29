// @vitest-environment jsdom
/**
 * The banner that says the marks are not being saved.
 *
 * It exists because the old code caught a failed write and threw the error
 * away. A student whose semester is not being written down has to be told
 * while the numbers are still on the screen and there is still time to export
 * them - so the words are load-bearing, and every one of them is rendered
 * here rather than only asserted about.
 */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { SaveNotice } from "../App";
import { setSaveFault } from "../../state/store";
import { saveFindings } from "../../state/launch";

afterEach(() => {
  cleanup();
  setSaveFault(null);
});

describe("SaveNotice", () => {
  it("shows nothing while saves are landing", () => {
    setSaveFault(null);
    const { container } = render(() => <SaveNotice />);
    expect(container.textContent).toBe("");
  });

  it("names the loss and offers the export when the file cannot be written", () => {
    setSaveFault({ kind: "file", error: "Access is denied. (os error 5)" });
    render(() => <SaveNotice />);
    expect(screen.getByText("Your marks are not being saved")).toBeTruthy();
    expect(screen.getByText("Export a copy now")).toBeTruthy();
    // The reason travels with it. A student who cannot see the operating
    // system's own words has nothing to give anyone who could help.
    expect(screen.getByTitle(/Access is denied\. \(os error 5\)/)).toBeTruthy();
    expect(screen.getByTitle(/Export a copy before that happens/)).toBeTruthy();
  });

  it("says which storage is refusing when there is no file behind it", () => {
    setSaveFault({ kind: "browser", error: "QuotaExceededError" });
    render(() => <SaveNotice />);
    expect(screen.getByText("Your marks are not being saved")).toBeTruthy();
    expect(screen.getByTitle(/private mode, or the storage is full/)).toBeTruthy();
  });

  it("separates a lost backup from lost marks", () => {
    setSaveFault({ kind: "backup", error: "Access is denied. (os error 5)" });
    render(() => <SaveNotice />);
    expect(screen.getByText("TargetX is not keeping a backup copy")).toBeTruthy();
    expect(screen.getByTitle(/Your marks are being saved, but/)).toBeTruthy();
    expect(screen.getByText("Export a copy")).toBeTruthy();
    // Information, not a warning: nothing has been lost yet.
    expect(saveFindings()[0]!.severity).toBe("info");
    expect(document.querySelector(".notice.warn")).toBeNull();
  });

  it("is not dismissible, and clears itself when a save gets through", () => {
    setSaveFault({ kind: "file", error: "no space left on device" });
    render(() => <SaveNotice />);
    // One button, and it is the export - there is no way to close this away.
    // Every other launch banner has a Dismiss; this one must not, because what
    // it reports is still true after it is closed.
    expect(screen.getAllByRole("button").map((b) => b.textContent))
      .toEqual(["Export a copy now"]);

    setSaveFault(null);
    expect(screen.queryByText("Your marks are not being saved")).toBeNull();
  });
});
