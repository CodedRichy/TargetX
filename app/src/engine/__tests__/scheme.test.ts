/**
 * Scheme profiles: the numbers the arithmetic depends on, made settable.
 *
 * Two things are being pinned here. First, that lifting the KTU 2024 values
 * out of `constants.ts` into a profile did not move any of them - a silent
 * drift there is a wrong grade shown to a student with no error anywhere.
 * Second, that a profile which is NOT KTU 2024 actually resolves differently,
 * because a settings screen that quietly keeps using 5 attendance marks would
 * pass every test above and be useless.
 */
import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX, ATTENDANCE_MIN,
  COURSE_TYPES, DEFAULT_TYPE, DL_CAP_PCT, ESE_PASS_FRACTION, GRADE_BANDS, GRADE_MIN,
  GRADE_POINTS, TARGET_CHOICES, TOTAL_PASS_MARK, TYPE_KEYS,
} from "../constants";
import { attendanceMarks } from "../attendance";
import { gradeForTotal } from "../grade";
import {
  KTU_2024, resetActiveScheme, resolveCourseTypes, resolveSpec, setActiveScheme,
  type Scheme,
} from "../scheme";

describe("the built-in KTU 2024 profile still holds the published numbers", () => {
  it("keeps the pass conditions", () => {
    expect(TOTAL_PASS_MARK).toBe(50);
    expect(ESE_PASS_FRACTION).toBe(0.4);
  });

  it("keeps the attendance rules", () => {
    expect(ATTENDANCE_MIN).toBe(75.0);
    expect(ATTENDANCE_CONDONE).toBe(60.0);
    expect(DL_CAP_PCT).toBe(10.0);
    expect(ATTENDANCE_MARK_MAX).toBe(5);
    expect(ATTENDANCE_MARK_BANDS).toEqual([
      [85.0, 5], [80.0, 4], [75.0, 3], [70.0, 2], [60.0, 1],
    ]);
  });

  it("keeps the grade bands, in order, with their points", () => {
    expect(GRADE_BANDS).toEqual([
      ["S", 90, 10.0], ["A+", 85, 9.0], ["A", 80, 8.5], ["B+", 75, 8.0],
      ["B", 70, 7.5], ["C+", 65, 7.0], ["C", 60, 6.5], ["D", 55, 6.0],
      ["P", 50, 5.5],
    ]);
    expect(GRADE_MIN.S).toBe(90);
    expect(GRADE_POINTS.S).toBe(10.0);
    // F is not a band - it is the absence of one, and must still score zero.
    expect(GRADE_POINTS.F).toBe(0.0);
  });

  it("keeps the six course types and the default", () => {
    expect(TYPE_KEYS).toEqual([
      "TH 40/60", "TH 50/50", "LAB 50/50", "PBL 60/40", "LAB 75/25", "PRJ 100/0",
    ]);
    expect(DEFAULT_TYPE).toBe("TH 40/60");
    expect(TARGET_CHOICES).toEqual(["S", "A+", "A", "B+", "B", "C+", "C", "D", "P"]);
  });

  it("still rescales TH 40/60 to the documented worked example", () => {
    // 15/15/10 authored on the full 40, rescaled into 35 once attendance
    // takes its 5: 13.125 / 13.125 / 8.75.
    const spec = COURSE_TYPES["TH 40/60"];
    expect(spec.attMax).toBe(5);
    expect(spec.components.map((c) => c.weight)).toEqual([13.125, 13.125, 8.75]);
  });

  it("makes every course type's components plus attendance total its cieMax", () => {
    for (const key of TYPE_KEYS) {
      const spec = COURSE_TYPES[key];
      const sum = spec.components.reduce((t, c) => t + c.weight, 0) + spec.attMax;
      expect(sum).toBeCloseTo(spec.cieMax, 10);
    }
  });
});

describe("a profile that is not KTU 2024 resolves to different arithmetic", () => {
  it("gives the authored weights back untouched when attendance is worth nothing", () => {
    // A college that awards no marks for attendance should see its own
    // split, not one with a hole rescaled into it.
    const spec = resolveSpec(KTU_2024.courseTypes["TH 40/60"], 0);
    expect(spec.attMax).toBe(0);
    expect(spec.components.map((c) => c.weight)).toEqual([15, 15, 10]);
  });

  it("reserves a different number of marks when the scheme says so", () => {
    const spec = resolveSpec(KTU_2024.courseTypes["TH 40/60"], 10);
    // 15/15/10 rescaled into 30, keeping the 3:3:2 proportions.
    expect(spec.attMax).toBe(10);
    expect(spec.components.map((c) => c.weight)).toEqual([11.25, 11.25, 7.5]);
    const sum = spec.components.reduce((t, c) => t + c.weight, 0) + spec.attMax;
    expect(sum).toBeCloseTo(40, 10);
  });

  it("resolves a whole custom scheme without touching the built-in one", () => {
    const autonomous: Scheme = {
      ...KTU_2024,
      id: "example-autonomous",
      name: "Example Autonomous College",
      source: "college regulations",
      builtIn: false,
      attendanceMarkMax: 0,
      attendanceMin: 80.0,
    };
    const types = resolveCourseTypes(autonomous);
    expect(types["TH 40/60"].components.map((c) => c.weight)).toEqual([15, 15, 10]);
    expect(autonomous.attendanceMin).toBe(80.0);

    // The built-in profile is not mutated by resolving another one.
    expect(KTU_2024.attendanceMarkMax).toBe(5);
    expect(KTU_2024.attendanceMin).toBe(75.0);
    expect(COURSE_TYPES["TH 40/60"].components.map((c) => c.weight))
      .toEqual([13.125, 13.125, 8.75]);
  });

  it("changes the grade a total earns, once activated", () => {
    // The point of the whole exercise: a college with a stricter S band
    // should see a stricter S, not KTU's.
    expect(gradeForTotal(92)).toBe("S");
    setActiveScheme({
      ...KTU_2024,
      id: "strict", name: "Strict College", builtIn: false,
      gradeBands: [
        { letter: "S", minPct: 95, points: 10.0 },
        { letter: "A+", minPct: 85, points: 9.0 },
        { letter: "P", minPct: 50, points: 5.5 },
      ],
    });
    try {
      expect(gradeForTotal(92)).toBe("A+");
      expect(gradeForTotal(40)).toBe("F");
    } finally {
      resetActiveScheme();
    }
    expect(gradeForTotal(92)).toBe("S");
  });

  it("changes what attendance is worth, once activated", () => {
    // KTU pays 5 marks from 85%. A college paying 2 from 90% should get its
    // own answer out of the same function, and its own answer back.
    expect(attendanceMarks(90)).toBe(5);
    setActiveScheme({
      ...KTU_2024,
      id: "att", name: "Other College", builtIn: false,
      attendanceMarkBands: [{ minPct: 90, marks: 2 }, { minPct: 75, marks: 1 }],
      attendanceMarkMax: 2,
    });
    try {
      expect(attendanceMarks(90)).toBe(2);
      expect(attendanceMarks(76)).toBe(1);
      expect(attendanceMarks(50)).toBe(0);
    } finally {
      resetActiveScheme();
    }
    expect(attendanceMarks(90)).toBe(5);
  });

  it("awards nothing for attendance when the scheme reserves no marks", () => {
    setActiveScheme({
      ...KTU_2024, id: "none", name: "No Attendance Marks", builtIn: false,
      attendanceMarkMax: 0,
    });
    try {
      // Not NaN, not Infinity - the rescale has no scale to divide by.
      expect(attendanceMarks(100)).toBe(0);
      expect(attendanceMarks(50)).toBe(0);
    } finally {
      resetActiveScheme();
    }
  });

  it("does not divide by zero when a type has no weighted components", () => {
    const spec = resolveSpec(
      { label: "Attendance only", cieMax: 20, eseMax: 80, components: [] },
      5,
    );
    expect(spec.components).toEqual([]);
    expect(spec.attMax).toBe(5);
  });
});
