/**
 * First year is set by GROUP, not by branch.
 *
 * Page 1 of the KTU 2024 curriculum sorts every B.Tech branch into four groups
 * and prints one first-year table per group. Holding S1 and S2 as per-branch
 * data therefore did not merely under-serve the branches we had not
 * transcribed - it mis-modelled the university. Thirty branches had no preset
 * at all while their first year was already sitting in the file under a name
 * none of them would ever pick.
 */
import { describe, expect, it } from "vitest";
import {
  branches, defaultBranch, defaultSlotChoice, expectedCredits, presetCourses,
  resolveBranch, semesterKeys,
} from "../catalogue";

const total = (branch: string, semester: string) => {
  const rows = presetCourses(branch, semester);
  const fixed = rows.filter((c) => !c.slot).reduce((sum, c) => sum + c.credits, 0);
  // One alternative per slot, and KTU's totals assume exactly one.
  const slots = new Map<string, number>();
  for (const row of rows.filter((c) => c.slot)) {
    slots.set(row.slot!, Math.max(slots.get(row.slot!) ?? 0, row.credits));
  }
  return fixed + [...slots.values()].reduce((sum, c) => sum + c, 0);
};

describe("group tables", () => {
  it("give every listed branch a first year", () => {
    for (const branch of branches()) {
      expect(semesterKeys(branch), branch).toEqual(expect.arrayContaining(["S1", "S2"]));
      expect(presetCourses(branch, "S1").length, branch).toBeGreaterThan(0);
      expect(presetCourses(branch, "S2").length, branch).toBeGreaterThan(0);
    }
  });

  it("add up to the credits KTU registers, for every branch", () => {
    // The defect this whole mechanism exists to stop is a preset that quietly
    // sums to less than the semester the university registered, because that
    // number is an SGPA denominator.
    for (const branch of branches()) {
      expect(total(branch, "S1"), `${branch} S1`).toBe(expectedCredits(branch, "S1"));
      expect(total(branch, "S2"), `${branch} S2`).toBe(expectedCredits(branch, "S2"));
      expect(expectedCredits(branch, "S1"), branch).toBe(20);
      expect(expectedCredits(branch, "S2"), branch).toBe(24);
    }
  });

  it("carry a slot's alternatives as a choice, never as two rows to tick", () => {
    for (const branch of branches()) {
      for (const semester of ["S1", "S2"]) {
        const slots = new Map<string, number>();
        for (const row of presetCourses(branch, semester)) {
          if (row.slot) slots.set(row.slot, (slots.get(row.slot) ?? 0) + 1);
        }
        expect(slots.size, `${branch} ${semester}`).toBeGreaterThan(0);
        for (const [slot, count] of slots) {
          expect(count, `${branch} ${semester} slot ${slot}`).toBeGreaterThan(1);
        }
      }
    }
  });

  it("are overridden by a branch that has its own table", () => {
    // The programme core is printed generically - PCXXT205, XX being the
    // branch - so a transcribed branch names its real subject and the group
    // table must not overwrite it.
    const generic = presetCourses(branches().find((b) => semesterKeys(b).length === 2)!, "S2");
    const own = presetCourses(defaultBranch(), "S2");
    expect(generic.map((c) => c.code)).toContain("PCXXT205");
    expect(own.map((c) => c.code)).not.toContain("PCXXT205");
    expect(own.map((c) => c.code)).toContain("PCCST205");
  });
});

describe("branch aliases", () => {
  it("keep a record written under the old key working", () => {
    // Records set up before the tables were keyed by KTU's printed names hold
    // "CSE". Without the alias an upgrade silently empties their picker.
    expect(resolveBranch("CSE")).toBe(defaultBranch());
    expect(presetCourses("CSE", "S3")).toEqual(presetCourses(defaultBranch(), "S3"));
    expect(semesterKeys("CSE")).toEqual(semesterKeys(defaultBranch()));
    expect(expectedCredits("CSE", "S1")).toBe(20);
  });

  it("leave a name that is already a branch alone", () => {
    for (const branch of branches()) expect(resolveBranch(branch)).toBe(branch);
  });
});

describe("which alternative arrives ticked", () => {
  it("follows the order the curriculum prints, not the alphabet", () => {
    // Group B S2 offers GXEST203 Foundations of Computing or GBEST213
    // Engineering Mechanics, and KTU offers the second to four branches only.
    // Sorting a slot by code put GBEST213 first, so every other branch in the
    // group opened on a subject it does not take.
    const b = branches().find((x) => x.startsWith("Electronics and Communication Engineering"))!;
    const slotC = presetCourses(b, "S2").filter((c) => c.slot === "C");
    expect(slotC.map((c) => c.code)).toEqual(["GXEST203", "GBEST213"]);
    expect([...defaultSlotChoice(presetCourses(b, "S2"))]).toContain("GXEST203");
  });

  it("puts the OTHER alternative first in S2, which is the whole point of a slot", () => {
    // A student takes Physics in one semester and Chemistry in the other. The
    // tables encode that by listing them the opposite way round, and sorting
    // by code threw it away - both semesters opened on Physics.
    for (const branch of branches()) {
      const s1 = [...defaultSlotChoice(presetCourses(branch, "S1"))];
      const s2 = [...defaultSlotChoice(presetCourses(branch, "S2"))];
      const science = (codes: string[]) => codes.find((c) => /PHT|CYT/.test(c));
      const wellness = (codes: string[]) => codes.find((c) => /UCPWT|UCHUT/.test(c));
      expect(science(s1), branch).not.toBe(science(s2));
      expect(wellness(s1), branch).not.toBe(wellness(s2));
    }
  });
});
