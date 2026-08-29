// @vitest-environment jsdom
/**
 * The ledger, used without a mouse and without sight.
 *
 * This is the surface the app exists for - a grid of subjects with a row that
 * expands - and it was the surface that failed hardest: the expander was a
 * `span` claiming `role="button"` that handled Enter and not Space and
 * advertised no state, every mark box was an unnamed `input` in a cell, the
 * remove button's accessible name was the multiplication sign, and the
 * attendance figure carried its verdict in a colour.
 *
 * Every number asserted here is re-derived from the engine in this file -
 * column maxima from `COURSE_TYPES`, the two attendance lines from
 * `ATTENDANCE_MIN` and `ATTENDANCE_CONDONE` - so a rule change fails this
 * file rather than leaving a label quoting a threshold KTU no longer has.
 */
import { cleanup, fireEvent, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATTENDANCE_CONDONE, ATTENDANCE_MIN, COURSE_TYPES } from "../../engine";
import type { Course } from "../../engine";
import { addCourse, edit, updateCourse } from "../../state/store";
import { Ledger } from "../Ledger";

afterEach(cleanup);

const TH = COURSE_TYPES["TH 40/60"];

/** 70%: eligible under condonation, short of the 75% line. */
const SHORT: Partial<Course> = {
  code: "CST303", name: "Compiler Design", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 35, held: 50, dl: 0,
};
/** 50%: under the condonation floor as well. */
const DEBARRED: Partial<Course> = {
  code: "CST305", name: "Computer Networks", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 25, held: 50, dl: 0,
};
/** 90%: neither line applies, so neither sentence may appear. */
const CLEAR: Partial<Course> = {
  code: "CST307", name: "Data Mining", credits: 4, type: "TH 40/60",
  s1: 38, s2: 34, other: 9, attended: 45, held: 50, dl: 0,
};

function seed(...courses: Partial<Course>[]) {
  edit((d) => {
    d.semesters = { S5: { courses: [] } };
    d.activeSemester = "S5";
    d.history = {};
  });
  courses.forEach((c, i) => { addCourse(); updateCourse(i, c); });
  return render(() => <Ledger />).container;
}

beforeEach(() => {
  edit((d) => { d.semesters = { S5: { courses: [] } }; d.activeSemester = "S5"; });
});

describe("the ledger is a real table", () => {
  it("scopes every column header, including the one drawn empty", () => {
    const c = seed(SHORT);
    const heads = [...c.querySelectorAll("thead th")];
    // 14 columns, which is the number `Detail` spans - a mismatch is how an
    // expanded row silently stops lining up with the grid above it.
    expect(heads).toHaveLength(14);
    expect(heads.every((h) => h.getAttribute("scope") === "col")).toBe(true);
    // The last one has no visible text, so it is named for assistive
    // technology alone rather than left as an anonymous column.
    expect(heads[13]!.textContent).toBe("Remove");
    expect(heads[13]!.querySelector(".sr-only")).not.toBeNull();
  });

  it("spans the detail row across exactly the columns the header declares", () => {
    const c = seed(SHORT);
    fireEvent.click(c.querySelector("button.code")!);
    const detail = c.querySelector("tr.detail td")!;
    expect(Number(detail.getAttribute("colspan")))
      .toBe(c.querySelectorAll("thead th").length);
  });
});

describe("the row expander", () => {
  it("is a button, not a span wearing a button's role", () => {
    const c = seed(SHORT);
    const expander = c.querySelector("button.code")!;
    expect(expander.tagName).toBe("BUTTON");
    expect(expander.getAttribute("type")).toBe("button");
    expect(expander.textContent).toBe("CST303");
    // Nothing anywhere in the ledger is still faking a control.
    expect(c.querySelectorAll('span[role="button"]')).toHaveLength(0);
  });

  it("reports its state, and points at the row it opens", () => {
    const c = seed(SHORT);
    const expander = c.querySelector("button.code")!;
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(c.querySelector("tr.detail")).toBeNull();

    fireEvent.click(expander);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
    const detail = c.querySelector("tr.detail")!;
    expect(detail.id).toBe(expander.getAttribute("aria-controls"));
    expect(detail.id).not.toBe("");

    fireEvent.click(expander);
    expect(expander.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("every control in a row is named", () => {
  it("names the mark box after the mark and its maximum", () => {
    const c = seed(SHORT);
    const ese = c.querySelector("tbody input.cell-input")!;
    expect(ese.getAttribute("aria-label")).toBe(`ESE mark, out of ${TH.eseMax}`);
    expect(TH.eseMax).toBe(60);
  });

  it("names the target picker", () => {
    const c = seed(SHORT);
    expect(c.querySelector("tbody select")!.getAttribute("aria-label"))
      .toBe("Target grade");
  });

  it("names the remove button after the subject, not after its glyph", () => {
    const c = seed(SHORT);
    const del = c.querySelector("button.del")!;
    expect(del.textContent).toBe("\u00d7");
    expect(del.getAttribute("aria-label")).toBe("Remove CST303");
  });

  it("leaves no input or select in the expanded row without a name", () => {
    const c = seed(SHORT);
    fireEvent.click(c.querySelector("button.code")!);
    const controls = [...c.querySelectorAll("tr.detail input, tr.detail select")];
    // Three components, published CIE, three attendance fields, type,
    // credits, published grade.
    expect(controls).toHaveLength(TH.components.length + 7);
    expect(controls.filter((el) => !el.getAttribute("aria-label"))).toEqual([]);
    const names = controls.map((el) => el.getAttribute("aria-label"));
    expect(names).toContain(`${TH.components[0]!.header}, out of ${TH.components[0]!.rawMax}`);
    expect(names).toContain(`Published CIE, out of ${TH.cieMax}`);
    expect(names).toContain("Classes attended");
    expect(names).toContain("Classes held");
    expect(names).toContain("Duty leave classes");
    expect(names).toContain("Course type");
    expect(names).toContain("Credits");
    expect(names).toContain("Published grade");
  });
});

describe("nothing is said in colour alone", () => {
  it("says in words which side of each attendance line a subject falls", () => {
    const c = seed(SHORT, DEBARRED, CLEAR);
    const said = [...c.querySelectorAll("tbody .sr-only")].map((n) => n.textContent!.trim());
    expect(said).toEqual([
      `below the ${ATTENDANCE_MIN.toFixed(0)}% eligibility line`,
      `below the ${ATTENDANCE_CONDONE.toFixed(0)}% condonation floor`,
    ]);
    // Re-derived, so a regulation change breaks this rather than the string.
    expect(ATTENDANCE_MIN).toBe(75);
    expect(ATTENDANCE_CONDONE).toBe(60);
  });

  it("gives every bound marker the sentence its hover carried", () => {
    // One series exam marked and the other not: the internal is a floor, so
    // the CIE cell wears the bound marker.
    const c = seed({
      code: "CST309", name: "Operating Systems", credits: 4, type: "TH 40/60",
      s1: 38, attended: 35, held: 50, dl: 0,
    });
    const bounds = [...c.querySelectorAll(".bound")];
    expect(bounds.length).toBeGreaterThan(0);
    for (const b of bounds) {
      expect(b.getAttribute("role")).toBe("img");
      expect(b.getAttribute("aria-label")).toBe(b.getAttribute("title"));
      expect(b.getAttribute("aria-label")!.length).toBeGreaterThan(0);
    }
  });
});
