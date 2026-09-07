/**
 * A scheme file is untrusted input that decides what grade the app reports.
 *
 * Everywhere else in the engine the numbers arrived through a form that had
 * already refused the incoherent ones. A file has had nothing standing
 * between it and the store, and the failures that matter are the quiet ones:
 * `gradeForTotal` walks the bands top to bottom and returns the FIRST match,
 * so a file listing them out of order does not throw, it hands out the wrong
 * letter for the rest of the semester. So these tests are mostly about what
 * `importScheme` REFUSES, and each refusal names the damage it prevents.
 */
import { describe, expect, it } from "vitest";
import { KTU_2024 } from "../scheme";
import { resolveSpec } from "../scheme";
import { blankTemplate, exportScheme, importScheme } from "../schemeIO";

/** The exported form of KTU 2024, as an object a test can bend one field of. */
function file(mutate: (scheme: Record<string, unknown>) => void = () => {}): string {
  const parsed = JSON.parse(exportScheme(KTU_2024));
  mutate(parsed.scheme as Record<string, unknown>);
  return JSON.stringify(parsed);
}

describe("a profile survives the trip", () => {
  it("round-trips every number it was given", () => {
    const { errors, scheme } = importScheme(exportScheme(KTU_2024));
    expect(errors).toEqual([]);
    expect(scheme).toBeDefined();
    expect(scheme!.attendanceMin).toBe(KTU_2024.attendanceMin);
    expect(scheme!.esePassFraction).toBeCloseTo(KTU_2024.esePassFraction, 10);
    expect(scheme!.gradeBands).toEqual(KTU_2024.gradeBands);
    expect(scheme!.attendanceMarkBands).toEqual(KTU_2024.attendanceMarkBands);
    expect(scheme!.courseTypes).toEqual(KTU_2024.courseTypes);
    expect(scheme!.targetChoices).toEqual(KTU_2024.targetChoices);
  });

  it("carries no id and no verified flag, whatever the file claims", () => {
    // The whole point. A sender can write any JSON they like; there is no
    // string that makes their numbers ours.
    const forged = JSON.parse(exportScheme(KTU_2024));
    forged.scheme.id = "ktu-2024";
    forged.scheme.builtIn = true;
    const { errors, scheme } = importScheme(JSON.stringify(forged));
    expect(errors).toEqual([]);
    expect(scheme).not.toHaveProperty("id");
    expect(scheme).not.toHaveProperty("builtIn");
  });

  it("exports nothing about the student", () => {
    // A profile is rules, not records. Asserted as an exact key set rather
    // than by searching for suspicious words, because the field that would
    // leak a transcript is the one nobody thought to search for.
    const body = JSON.parse(exportScheme(KTU_2024));
    expect(Object.keys(body).sort()).toEqual(["format", "scheme", "version"]);
    expect(Object.keys(body.scheme).sort()).toEqual([
      "attendanceCondone", "attendanceMarkBands", "attendanceMarkMax",
      "attendanceMin", "courseTypes", "defaultType", "dlCapPct",
      "esePassFraction", "gradeBands", "name", "source", "targetChoices",
      "totalPassMark",
    ]);
  });
});

describe("what it refuses, and why", () => {
  it("refuses grade bands that are out of order", () => {
    // The silent one. B+ above A means `gradeForTotal` matches B+ first and
    // an 87% student is told they got a B+.
    const { errors, scheme } = importScheme(file((s) => {
      s.gradeBands = [
        { letter: "S", minPct: 90, points: 10 },
        { letter: "A", minPct: 80, points: 8.5 },
        { letter: "A+", minPct: 85, points: 9 },
        { letter: "P", minPct: 50, points: 5.5 },
      ];
    }));
    expect(scheme).toBeUndefined();
    expect(errors.join(" ")).toContain("must be lower than");
  });

  it("refuses a course type that reserves more for attendance than the CIE holds", () => {
    // `resolveSpec` rescales the components into `cieMax - attMax`. Let this
    // through and the weights go negative: scoring full internal marks would
    // lower the total.
    const { errors, scheme } = importScheme(file((s) => {
      const types = s.courseTypes as Record<string, Record<string, unknown>>;
      types["TH 40/60"]!.attMax = 50;
    }));
    expect(scheme).toBeUndefined();
    expect(errors.join(" ")).toContain("nothing left");

    // And confirm the damage is real, so the guard is not cargo-culted.
    const bad = resolveSpec(
      { ...KTU_2024.courseTypes["TH 40/60"], attMax: 50 }, 50,
    );
    expect(Math.min(...bad.components.map((c) => c.weight))).toBeLessThan(0);
  });

  it("refuses a course type this build has never heard of", () => {
    const { errors, scheme } = importScheme(file((s) => {
      (s.courseTypes as Record<string, unknown>)["SEMINAR 30/70"] = {
        label: "Seminar", cieMax: 30, eseMax: 70,
        components: [{ key: "other", header: "Report", rawMax: 30, weight: 30 }],
      };
    }));
    expect(scheme).toBeUndefined();
    expect(errors.join(" ")).toContain("not a course type this version");
  });

  it("refuses a default course type the file never defined", () => {
    const { errors } = importScheme(file((s) => { s.defaultType = "LAB 75/25"; }));
    // KTU 2024 does define LAB 75/25, so use one it does not.
    expect(errors).toEqual([]);
    const missing = importScheme(file((s) => {
      s.defaultType = "TH 50/50";
      const types = s.courseTypes as Record<string, unknown>;
      delete types["TH 50/50"];
    }));
    expect(missing.scheme).toBeUndefined();
    expect(missing.errors.join(" ")).toContain("not one of the types");
  });

  it("refuses a target grade with no band behind it", () => {
    // Otherwise the Targets screen offers a grade that can never be reached
    // and the solver looks broken rather than the scheme.
    const { errors, scheme } = importScheme(file((s) => {
      s.gradeBands = (s.gradeBands as unknown[]).filter(
        (b) => (b as { letter: string }).letter !== "S",
      );
    }));
    expect(scheme).toBeUndefined();
    expect(errors.join(" ")).toContain("no grade band");
  });

  it("refuses an invented grade letter rather than reporting it", () => {
    const { errors, scheme } = importScheme(file((s) => {
      s.gradeBands = [{ letter: "O", minPct: 95, points: 10 }, ...(s.gradeBands as unknown[])];
    }));
    expect(scheme).toBeUndefined();
    expect(errors.join(" ")).toContain("Grade letters must be one of");
  });

  it("refuses a file with no source line", () => {
    const { errors, scheme } = importScheme(file((s) => { s.source = "  "; }));
    expect(scheme).toBeUndefined();
    expect(errors.join(" ")).toContain("where its numbers came from");
  });

  it("names the problem for something that is not JSON at all", () => {
    const { errors, scheme } = importScheme("not a file");
    expect(scheme).toBeUndefined();
    expect(errors[0]).toContain("not valid JSON");
  });

  it("refuses JSON that is not a TargetX profile", () => {
    const { errors, scheme } = importScheme(JSON.stringify({ hello: "world" }));
    expect(scheme).toBeUndefined();
    expect(errors[0]).toContain("targetx.scheme");
  });

  it("refuses a file from a newer build rather than guessing at it", () => {
    const newer = JSON.parse(exportScheme(KTU_2024));
    newer.version = 99;
    const { errors, scheme } = importScheme(JSON.stringify(newer));
    expect(scheme).toBeUndefined();
    expect(errors[0]).toContain("newer version");
  });
});

describe("the blank template", () => {
  it("is importable by its own rules", () => {
    // It is offered as a starting point, so it must satisfy every check a
    // file from a stranger has to pass.
    const blank = blankTemplate();
    const wrapped = JSON.stringify({
      format: "targetx.scheme", version: 1, scheme: blank,
    });
    expect(importScheme(wrapped).errors).toEqual([]);
  });

  it("says out loud that its numbers are not the college's own", () => {
    // The one thing that must never happen is a placeholder profile that
    // reads as verified for some college it was never checked against.
    expect(blankTemplate().source.toLowerCase()).toContain("replace");
    expect(blankTemplate()).not.toHaveProperty("builtIn");
  });
});
