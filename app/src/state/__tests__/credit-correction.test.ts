/**
 * A credit the student corrected by hand.
 *
 * etlab never publishes a per-course credit, so TargetX infers one from the
 * catalogue, and the sync panel explicitly asks the student to fix it when the
 * inference is wrong. `applySync` has always known to keep a corrected credit —
 * it reads `creditsConfirmed` — but nothing in the app ever set that flag. The
 * correction therefore survived exactly until the next sync and then silently
 * reverted, on the one number that weights everything else.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { blankCourse } from "../../engine";
import type { Course } from "../../engine";
import { applySync } from "../actions";
import { edit, state, updateCourse } from "../store";

const course = () => state.semesters["S5"]!.courses[0]!;

/** What the portal would hand back: the catalogue's inferred 4, not the real 3. */
const incoming = (credits: number): Parameters<typeof applySync>[0] => ({
  semesters: {
    S5: {
      courses: [{ ...blankCourse("PCCST501", "Computer Networks", credits, "TH 40/60") } as Course],
      creditCheck: undefined as never,
    },
  },
  history: {},
  current: "S5",
  inferredTypes: [],
});

beforeEach(() => {
  edit((s) => {
    s.activeSemester = "S5";
    s.semesters = {
      S5: { courses: [{ ...blankCourse("PCCST501", "Computer Networks", 4, "TH 40/60") }] },
    };
  });
});

describe("a corrected credit", () => {
  it("is kept when the portal syncs again", () => {
    updateCourse(0, { credits: 3, creditsConfirmed: true });
    applySync(incoming(4));
    expect(course().credits).toBe(3);
    expect(course().creditsConfirmed).toBe(true);
  });

  it("is overwritten when it was never corrected", () => {
    // The default has to stay: an inference the student has not disputed is
    // worth less than a fresh one.
    applySync(incoming(2));
    expect(course().credits).toBe(2);
  });

  it("stops being protected when the box is cleared", () => {
    // Clearing is not a correction. Leaving the flag set would freeze an empty
    // credit against every future sync, which is worse than the bug it fixes.
    updateCourse(0, { credits: 3, creditsConfirmed: true });
    updateCourse(0, { credits: "", creditsConfirmed: false });
    applySync(incoming(4));
    expect(course().credits).toBe(4);
  });
});
