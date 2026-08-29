/**
 * The first-year preset, which was wrong by a quarter of a semester.
 *
 * The S1 CSE table listed 15 credits against a curriculum that registers 20.
 * It was missing GXEST104 outright and both of KTU's first-year SLOTS - Slot B
 * (Physics or Chemistry, 4 credits) and Slot I (Health and Wellness or Life
 * Skills, 1 credit) - which are choices rather than named subjects, taken one
 * way round in S1 and the other in S2. A first year seeding from that preset
 * had every SGPA divided by 15 instead of 20 from the day they installed it.
 *
 * Transcribed from the KTU B.Tech Curriculum 2024, Group A tables. These
 * assertions are the university's numbers, so they are stated as such: if a
 * future catalogue edit breaks one, the edit is wrong until the PDF says
 * otherwise.
 */
import { describe, expect, it } from "vitest";
import { defaultSlotChoice, expectedCredits, lookupCourse, presetCourses } from "..";

const preset = (semester: string) => presetCourses("CSE", semester);

/** What the picker actually seeds: every non-elective, one row per slot. */
const seeded = (semester: string) => {
  const list = preset(semester);
  const slots = defaultSlotChoice(list);
  return list.filter((c) => (c.slot ? slots.has(c.code) : !c.elective));
};

describe("what KTU registers for first year", () => {
  it("is 20 credits in S1 and 24 in S2", () => {
    expect(expectedCredits("CSE", "S1")).toBe(20);
    expect(expectedCredits("CSE", "S2")).toBe(24);
  });

  it("says nothing rather than guessing for a semester with no published total", () => {
    expect(expectedCredits("CSE", "S5")).toBeNull();
  });

  it("is exactly what the preset seeds, in both semesters", () => {
    for (const semester of ["S1", "S2"] as const) {
      const total = seeded(semester).reduce((sum, c) => sum + c.credits, 0);
      expect(total).toBe(expectedCredits("CSE", semester));
    }
  });
});

describe("the two first-year slots", () => {
  it("offer both alternatives and default to exactly one of each", () => {
    for (const semester of ["S1", "S2"] as const) {
      const list = preset(semester);
      const bySlot = new Map<string, string[]>();
      for (const course of list) {
        if (course.slot) bySlot.set(course.slot, [...(bySlot.get(course.slot) ?? []), course.code]);
      }
      expect([...bySlot.keys()].sort()).toEqual(["B", "I"]);
      for (const codes of bySlot.values()) expect(codes.length).toBe(2);
      expect(defaultSlotChoice(list).size).toBe(2);
    }
  });

  it("puts the same four codes in both semesters, because the student swaps them", () => {
    const slotCodes = (semester: string) =>
      preset(semester).filter((c) => c.slot).map((c) => c.code).sort();
    expect(slotCodes("S1")).toEqual(slotCodes("S2"));
    expect(slotCodes("S1")).toEqual(["GAPHT121", "GXCYT122", "UCHUT128", "UCPWT127"]);
  });

  it("prices the alternatives within a slot identically", () => {
    // If they ever differ, "one of these two" stops being a safe default and
    // the picker would be choosing a credit total on the student's behalf.
    for (const semester of ["S1", "S2"] as const) {
      const bySlot = new Map<string, Set<number>>();
      for (const course of preset(semester)) {
        if (!course.slot) continue;
        bySlot.set(course.slot, (bySlot.get(course.slot) ?? new Set()).add(course.credits));
      }
      for (const credits of bySlot.values()) expect(credits.size).toBe(1);
    }
  });
});

describe("the codes that had no table row", () => {
  it("are in S1 now, at the credits the curriculum prints", () => {
    const codes = preset("S1").map((c) => c.code);
    expect(codes).toContain("GXEST104");
    expect(lookupCourse("GXEST104")!.credits).toBe(4);
  });

  it("include the Digital 101 MOOC, whose credit lands in S2", () => {
    expect(preset("S2").map((c) => c.code)).toContain("UCSEM129");
    expect(preset("S1").map((c) => c.code)).not.toContain("UCSEM129");
  });

  it("do not include UCHUT347, which is a third-year course", () => {
    for (const semester of ["S1", "S2"] as const) {
      expect(preset(semester).map((c) => c.code)).not.toContain("UCHUT347");
    }
  });
});
