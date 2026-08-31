import { describe, expect, it } from "vitest";
import { courseLabel } from "../course";
import { summarise } from "../evaluate";
import { planForSgpa } from "../goals";
import type { Course } from "../types";

/**
 * How a course names itself everywhere a student reads about it.
 *
 * Issue #7: the app said "24 classes in a row in GAMAT401 buys 1 mark". The
 * code is the university's key, not the subject - a student who has not
 * memorised the scheme cannot tell which class that is. The name is what they
 * recognise, so the name wins wherever there is prose to put it in. The code
 * stays where it is the identifier being edited: the Ledger's own code column.
 *
 * The fallback order matters as much as the preference. A course seeded from a
 * pasted code has no name yet, and printing "?" for it would be worse than
 * printing the code the student typed.
 */
describe("courseLabel", () => {
  it("prefers the name a student would recognise", () => {
    expect(courseLabel({ code: "GAMAT401", name: "Mathematics for Information Science-4" }))
      .toBe("Mathematics for Information Science-4");
  });

  it("falls back to the code when nothing has named the course yet", () => {
    expect(courseLabel({ code: "GAMAT401" })).toBe("GAMAT401");
    expect(courseLabel({ code: "GAMAT401", name: "" })).toBe("GAMAT401");
    expect(courseLabel({ code: "GAMAT401", name: "   " })).toBe("GAMAT401");
  });

  it("says so rather than printing an empty string", () => {
    expect(courseLabel({})).toBe("?");
    expect(courseLabel({ code: "", name: "" })).toBe("?");
  });

  it("trims, because a scraped name arrives padded", () => {
    expect(courseLabel({ code: "X", name: "  Programming in C  " })).toBe("Programming in C");
  });
});

/**
 * The engine's own lists are read by a student, not by a machine - they are
 * printed verbatim on the Home and Route screens. They name courses the same
 * way the rest of the app does.
 */
describe("engine lists name the subject", () => {
  const named = (over: Partial<Course>): Course => ({
    code: "GAMAT401", name: "Mathematics for Information Science-4",
    credits: 4, type: "TH 40/60", s1: "", s2: "", other: "",
    attendance: "", attended: "", held: "", dl: "", ese: "",
    target: "B+", cie_override: "", portal_grade: null, ...over,
  });

  /**
   * The counterpart, and the reason `summarise` is not simply changed to match:
   * its lists are pinned in the frozen parity corpus, and the UI renders them
   * as COUNTS - "2 short of 75%" - never as names. So the identifier there
   * stays an identifier, and the corpus stays byte-identical.
   */
  it("leaves summarise naming courses by code, because nothing prints them", () => {
    const sum = summarise([named({ attendance: 40, attended: 40, held: 100 })]);
    expect(sum.lowAttendance).toEqual(["GAMAT401"]);
  });

  it("names the subject in a route exclusion", () => {
    const plan = planForSgpa(
      [named({}), named({ code: "PCCST402", name: "Discrete Mathematics", portal_grade: "W" })], 8);
    expect(plan.reason).toContain("Discrete Mathematics left out: withdrawn");
    expect(plan.reason).not.toContain("PCCST402");
  });
});
