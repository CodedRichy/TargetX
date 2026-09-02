// @vitest-environment jsdom
/**
 * The nudge at the moment the assistant would have been used.
 *
 * The offer to press Enter was gated on `askConfigured() && signedIn()`, on the
 * reasoning that offering something you will then refuse is worse than offering
 * nothing. True as far as it went - but the else branch was silence. A student
 * who typed a real question, matched nothing locally, and had no account was
 * shown "Nothing here matches" and no reason and no way forward, at the exact
 * point they were reaching for the one feature an account unlocks.
 *
 * So: still never promise Enter to someone it would refuse, but say what the
 * account is for and put the button there. And still say nothing when there is
 * genuinely nothing to offer - no endpoint, or no Clerk to sign in against -
 * because a button that cannot work is the same bug wearing a coat.
 *
 * Signed IN, asking is a row in the results instead (see `Palette.tsx`) - it
 * had to be, because a local hit used to swallow Enter and make the router
 * unreachable. Signed OUT it stays exactly here, in the no-results branch,
 * which is the position these tests defend: the account is named at the moment
 * it would have been used and never as a standing row over a box that works
 * without one.
 */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";
import { ASSISTANT } from "../../state/answers";

const state = { configured: true, signed: false, authOk: true, busy: false };
const signIn = vi.fn();

vi.mock("../../state/ask", () => ({
  askConfigured: () => state.configured,
  askRemote: vi.fn(),
}));
vi.mock("../../state/auth", () => ({
  signedIn: () => state.signed,
  authConfigured: () => state.authOk,
  authBusy: () => state.busy,
  signIn: (...args: unknown[]) => signIn(...args),
}));

const { Palette } = await import("../Palette");

const ML: Partial<Course> = {
  code: "CST305", name: "Machine Learning", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 39, held: 50, dl: 0,
};

/** Matches no subject, no view and no local answer, so the box falls through. */
const UNMATCHED = "zzq qqz";

function open() {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
    d.timetable = undefined;
  });
  addCourse();
  updateCourse(0, ML);
  return render(() => <Palette open={true} onClose={() => {}} />);
}

const type = (value: string) => {
  const input = screen.getByLabelText("Search subjects and views") as HTMLInputElement;
  fireEvent.input(input, { target: { value } });
  return input;
};

afterEach(() => {
  cleanup();
  signIn.mockClear();
  Object.assign(state, { configured: true, signed: false, authOk: true, busy: false });
});

describe("a signed-out student is told what the account is for", () => {
  it("offers sign-in instead of the silence that was there", () => {
    open();
    type(UNMATCHED);
    // Not "sign in" in the abstract: named, so it is clear what is unlocked.
    expect(screen.getByRole("button", { name: `Sign in to ask ${ASSISTANT}` })).toBeTruthy();
  });

  it("says the rest of the app does not need an account, so it does not read as a wall", () => {
    open();
    type(UNMATCHED);
    expect(screen.getByText(/everything else in TargetX works without an account/)).toBeTruthy();
  });

  it("starts sign-in when pressed", () => {
    open();
    type(UNMATCHED);
    fireEvent.click(screen.getByRole("button", { name: `Sign in to ask ${ASSISTANT}` }));
    expect(signIn).toHaveBeenCalled();
  });

  it("does not promise Enter to someone it would refuse", () => {
    open();
    type(UNMATCHED);
    expect(screen.queryByText(/Press Enter/)).toBeNull();
  });

  it("says the browser is opening rather than looking dead while it is", () => {
    state.busy = true;
    open();
    type(UNMATCHED);
    expect(screen.getByRole("button", { name: /Opening your browser/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: /Opening your browser/ }) as HTMLButtonElement)
      .disabled).toBe(true);
  });
});

describe("nothing is offered that could not be honoured", () => {
  it("stays silent when there is no ask endpoint at all", () => {
    state.configured = false;
    open();
    type(UNMATCHED);
    expect(screen.queryByRole("button", { name: /Sign in to ask/ })).toBeNull();
    expect(screen.queryByText(/Press Enter/)).toBeNull();
  });

  it("stays silent when there is nothing to sign in against", () => {
    // No Clerk client id in the build. The button would open nothing.
    state.authOk = false;
    open();
    type(UNMATCHED);
    expect(screen.queryByRole("button", { name: /Sign in to ask/ })).toBeNull();
  });

  it("offers the ask row, not sign-in, once signed in", () => {
    // Signed in, asking is a row in the results rather than a line of
    // fineprint. It has to be: the fineprint only rendered when the list came
    // back empty, and a list that is never empty made it unreachable.
    state.signed = true;
    open();
    type(UNMATCHED);
    expect(screen.getByRole("option", { name: new RegExp(`Ask ${ASSISTANT}`) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sign in to ask/ })).toBeNull();
  });
});

describe("the nudge appears where the assistant was reached for, not before", () => {
  it("is absent while the box is still matching things locally", () => {
    open();
    type("machine");
    // A subject matched. Nothing was asked of the assistant, so nothing about
    // accounts belongs on screen.
    expect(screen.queryByRole("button", { name: /Sign in to ask/ })).toBeNull();
  });

  it("is absent for a question answered locally while signed out", () => {
    open();
    type("whats my attendance in machine learning");
    // The engine answered it on this machine. Being signed out cost nothing.
    expect(screen.queryByRole("button", { name: /Sign in to ask/ })).toBeNull();
  });
});
