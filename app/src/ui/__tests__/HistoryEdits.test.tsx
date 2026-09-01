// @vitest-environment jsdom
/**
 * What a hand edit on the History table is allowed to do.
 *
 * Two rules, both of which the screen previously broke, and both of which are
 * the same rule seen twice: the app must never hold a number it cannot account
 * for, and must never silently discard one the university published.
 *
 *   - An empty box means "I do not know this". It used to mean "delete the
 *     entire semester record", on blur, with no confirmation and no undo -
 *     select-all, Backspace, Tab was enough to drop an SGPA, both credit
 *     totals, the source and the recorded conflict, and to move the CGPA in
 *     the header with no explanation.
 *   - Typing over a figure changes whose figure it is. Keeping `gradecard` on
 *     a hand-typed number would have the app claim the university published
 *     something it never did, and hold that claim at the rank where a later
 *     real fetch of the correct figure ties with it and can lose.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { defaultTargets } from "../../engine";
import { edit, state } from "../../state/store";
import { History } from "../History";

const reset = () => {
  edit((s) => {
    s.activeSemester = "S5";
    s.semesters = { S5: { courses: [] } };
    s.history = {};
    s.goal = defaultTargets();
  });
};

/** A semester the university published, which is the case with something to lose. */
const seedCard = () => edit((s) => {
  s.history["S3"] = {
    sgpa: 8.42, creditsRegistered: 20, creditsEarned: 20,
    source: "gradecard", conflict: null,
  };
});

const sgpaBox = () =>
  screen.getByLabelText("Published SGPA for S3") as HTMLInputElement;
const creditBox = () =>
  screen.getByLabelText("Registered credits for S3") as HTMLInputElement;

/** Type a value and blur, which is what commits on this screen. */
const put = (box: HTMLInputElement, value: string) => {
  fireEvent.input(box, { target: { value } });
  fireEvent.blur(box);
};

beforeEach(reset);
afterEach(cleanup);

describe("an empty box is not a delete", () => {
  it("keeps the semester when the SGPA is cleared and blurred", () => {
    seedCard();
    render(() => <History />);
    put(sgpaBox(), "");

    // The record survives, whole - not just the row.
    expect(state.history["S3"]).toBeDefined();
    expect(state.history["S3"]!.sgpa).toBe(8.42);
    expect(state.history["S3"]!.source).toBe("gradecard");
    expect(state.history["S3"]!.creditsRegistered).toBe(20);
  });

  it("puts the stored figure back in the box, so the screen and the store agree", () => {
    seedCard();
    render(() => <History />);
    put(sgpaBox(), "");
    // A box left blank over a stored 8.42 would be the screen showing one
    // thing and the CGPA above being computed from another.
    expect(sgpaBox().value).toBe("8.42");
  });

  it("still writes nothing at all for a row that has no stored record", () => {
    edit((s) => { s.semesters = { S3: { courses: [] }, S5: { courses: [] } }; });
    render(() => <History />);
    put(sgpaBox(), "");
    expect(state.history["S3"]).toBeUndefined();
  });
});

describe("removing a semester is deliberate", () => {
  it("does not remove on the first press", () => {
    seedCard();
    render(() => <History />);
    fireEvent.click(screen.getByLabelText("Remove S3 from history"));
    expect(state.history["S3"]).toBeDefined();
  });

  it("names the figure being discarded before discarding it", () => {
    seedCard();
    render(() => <History />);
    fireEvent.click(screen.getByLabelText("Remove S3 from history"));
    // The SGPA, not just the semester name: it is the thing that took a
    // semester to earn and the thing the CGPA will move without.
    //
    // Scoped to the confirmation group rather than the whole screen - 8.42 is
    // also sitting in the input box, so a document-wide query would pass
    // without the confirmation naming anything at all.
    const group = screen.getByRole("group", { name: "Remove S3?" });
    expect(group.textContent).toMatch(/Discard S3/);
    expect(group.textContent).toMatch(/8\.42/);
  });

  it("removes only on the confirming press", () => {
    seedCard();
    render(() => <History />);
    fireEvent.click(screen.getByLabelText("Remove S3 from history"));
    fireEvent.click(screen.getByText("Remove"));
    expect(state.history["S3"]).toBeUndefined();
  });

  it("keeps the record when the student backs out", () => {
    seedCard();
    render(() => <History />);
    fireEvent.click(screen.getByLabelText("Remove S3 from history"));
    fireEvent.click(screen.getByText("Keep"));
    expect(state.history["S3"]).toBeDefined();
    expect(state.history["S3"]!.sgpa).toBe(8.42);
  });

  it("offers nothing to remove on a row with no record", () => {
    edit((s) => { s.semesters = { S3: { courses: [] }, S5: { courses: [] } }; });
    render(() => <History />);
    expect(screen.queryByLabelText("Remove S3 from history")).toBeNull();
  });
});

describe("editing a figure changes whose figure it is", () => {
  it("marks an overwritten grade-card SGPA as the student's own entry", () => {
    seedCard();
    render(() => <History />);
    put(sgpaBox(), "8.6");

    expect(state.history["S3"]!.sgpa).toBe(8.6);
    // Not `gradecard`. No grade card ever carried 8.6, and claiming one did
    // would hold the figure at the rank that beats a real KTU fetch.
    expect(state.history["S3"]!.source).toBe("manual");
  });

  it("keeps the displaced university figure so it can be seen and put back", () => {
    seedCard();
    render(() => <History />);
    put(sgpaBox(), "8.6");

    expect(state.history["S3"]!.conflict)
      .toEqual({ source: "gradecard", sgpa: 8.42 });
    // And it is on screen, not merely in the store.
    expect(screen.getByText(/KTU grade card said/i)).toBeTruthy();
  });

  it("leaves the source alone when only the credits box moved", () => {
    seedCard();
    render(() => <History />);
    put(creditBox(), "22");

    // The SGPA is still exactly what the card published, so the record is
    // still the card's - which is what lets it outrank a portal scrape.
    expect(state.history["S3"]!.creditsRegistered).toBe(22);
    expect(state.history["S3"]!.source).toBe("gradecard");
    expect(state.history["S3"]!.conflict).toBeNull();
  });

  it("does not re-tag the record when the SGPA is retyped identically", () => {
    seedCard();
    render(() => <History />);
    put(sgpaBox(), "8.42");
    expect(state.history["S3"]!.source).toBe("gradecard");
  });

  it("does not stack a conflict when a hand entry is edited again", () => {
    edit((s) => {
      s.history["S3"] = {
        sgpa: 7.5, creditsRegistered: 20, creditsEarned: 20,
        source: "manual", conflict: null,
      };
    });
    render(() => <History />);
    put(sgpaBox(), "7.9");
    // Replacing one of the student's own guesses with another displaces no
    // published figure, so there is no disagreement to record.
    expect(state.history["S3"]!.source).toBe("manual");
    expect(state.history["S3"]!.conflict).toBeNull();
  });
});
