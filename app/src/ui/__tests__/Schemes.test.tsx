// @vitest-environment jsdom
/**
 * The Schemes screen: picking, duplicating, editing and dropping a profile
 * from the UI, and the validation that keeps a bad edit from ever reaching
 * `updateProfile` - see the comment on `resolveDraft` in `../Schemes.tsx` for
 * why that matters (`gradeForTotal` trusts band order without re-checking
 * it).
 */
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KTU_2024, activeScheme, resetActiveScheme } from "../../engine/scheme";
import { edit, state } from "../../state/store";
import { Schemes } from "../Schemes";

function reset() {
  edit((s) => {
    s.scheme = KTU_2024.id;
    s.customSchemes = [];
  });
  resetActiveScheme();
}

beforeEach(reset);
afterEach(() => { cleanup(); reset(); });

describe("the profile list", () => {
  it("shows KTU 2024 as verified and active", () => {
    render(() => <Schemes />);
    expect(screen.getAllByText("verified").length).toBeGreaterThan(0);
    expect(screen.getAllByText("active").length).toBe(1);
  });

  it("switches the active profile, and follows through to the engine", () => {
    render(() => <Schemes />);
    fireEvent.click(screen.getByText("Duplicate"));
    const nameBox = screen.getByLabelText("Name for the copy of KTU 2024");
    fireEvent.input(nameBox, { target: { value: "My College" } });
    fireEvent.click(screen.getByText("Make copy"));

    expect(screen.getAllByText("My College").length).toBeGreaterThan(0);
    expect(activeScheme().name).toBe("My College");

    fireEvent.click(screen.getByText("Back to KTU 2024"));
    expect(state.scheme).toBe(KTU_2024.id);
    expect(activeScheme()).toBe(KTU_2024);
  });
});

describe("duplicating then editing", () => {
  it("opens an editor on the copy and can change its pass mark", () => {
    render(() => <Schemes />);
    fireEvent.click(screen.getByText("Duplicate"));
    fireEvent.input(screen.getByLabelText("Name for the copy of KTU 2024"), {
      target: { value: "My College" },
    });
    fireEvent.click(screen.getByText("Make copy"));

    // Duplicating opens the editor directly - no separate "Edit" click needed.
    expect(screen.getByText("Editing My College")).toBeTruthy();

    const passMark = screen.getByLabelText("Total pass mark (/100)");
    fireEvent.input(passMark, { target: { value: "45" } });
    // The lowest grade band (P, 50) no longer matches - a deliberately
    // incoherent state that must block Save rather than write anything.
    expect(screen.getByRole("alert")).toBeTruthy();
    expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);

    // Bring the lowest band down to match, and it should save cleanly.
    fireEvent.input(screen.getByLabelText("P minimum percentage"), { target: { value: "45" } });
    expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("Save changes"));

    expect(activeScheme().totalPassMark).toBe(45);
    expect(activeScheme().gradeBands.find((b) => b.letter === "P")?.minPct).toBe(45);
  });
});

describe("validation", () => {
  it("refuses an out-of-order grade band rather than saving it silently", () => {
    render(() => <Schemes />);
    fireEvent.click(screen.getByText("Duplicate"));
    fireEvent.input(screen.getByLabelText("Name for the copy of KTU 2024"), {
      target: { value: "Bad Scheme" },
    });
    fireEvent.click(screen.getByText("Make copy"));

    // B's minimum (70) raised above B+'s (75) - the two rows would overlap
    // and `gradeForTotal`'s first-match walk would return the wrong letter.
    fireEvent.input(screen.getByLabelText("B minimum percentage"), { target: { value: "80" } });

    const before = activeScheme().gradeBands.find((b) => b.letter === "B")!.minPct;
    fireEvent.click(screen.getByText("Save changes"));
    expect(activeScheme().gradeBands.find((b) => b.letter === "B")!.minPct).toBe(before);
    expect(within(screen.getByRole("alert")).getByText(/must be lower than/)).toBeTruthy();
  });

  it("rejects an attendance mark exceeding the full total", () => {
    render(() => <Schemes />);
    fireEvent.click(screen.getByText("Duplicate"));
    fireEvent.input(screen.getByLabelText("Name for the copy of KTU 2024"), {
      target: { value: "Bad Attendance" },
    });
    fireEvent.click(screen.getByText("Make copy"));

    fireEvent.input(screen.getByLabelText("Attendance band 1 marks"), { target: { value: "50" } });
    expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);
    expect(within(screen.getByRole("alert")).getByText(/exceeds the full/)).toBeTruthy();
  });
});

describe("deleting the active profile", () => {
  it("falls back to KTU 2024 rather than leaving the app on a gone profile", () => {
    render(() => <Schemes />);
    fireEvent.click(screen.getByText("Duplicate"));
    fireEvent.input(screen.getByLabelText("Name for the copy of KTU 2024"), {
      target: { value: "Temporary" },
    });
    fireEvent.click(screen.getByText("Make copy"));
    expect(activeScheme().name).toBe("Temporary");

    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Delete"));

    expect(state.scheme).toBe(KTU_2024.id);
    expect(activeScheme()).toBe(KTU_2024);
    expect(screen.queryByText("Temporary")).toBeNull();
  });
});
