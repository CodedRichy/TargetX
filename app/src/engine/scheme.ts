import type { Component, CourseSpec, Grade, Letter, TypeKey } from "./types";

/**
 * A scheme profile: every number the arithmetic depends on, in one object.
 *
 * These used to be module-level constants in `constants.ts`, which made them
 * right for KTU 2024 and unreachable for anyone else. An autonomous college
 * sets its own pass mark, its own attendance rules and its own internal
 * split, and none of that was expressible.
 *
 * The values are grouped rather than loose on purpose. A student who edits a
 * grade cutoff should be editing a named profile they can see the source of,
 * not a scattering of settings with no provenance - the point of the built-in
 * KTU profile is that it is checked, and that only survives if a profile is a
 * single auditable thing.
 */

export interface GradeBand {
  readonly letter: Letter;
  /** Lowest total percentage that earns this letter. */
  readonly minPct: number;
  readonly points: number;
}

export interface AttendanceMarkBand {
  /** Lowest attendance percentage that earns `marks`. */
  readonly minPct: number;
  readonly marks: number;
}

/**
 * A course type as authored, with component weights on the full `cieMax`
 * scale and no room yet made for attendance.
 *
 * This is the shape a person writes by hand. `resolveCourseTypes` turns it
 * into the `CourseSpec` the engine consumes, and it must stay authored this
 * way: the rescale depends on `attendanceMarkMax`, so a scheme that changes
 * how many marks attendance is worth has to be able to recompute the weights
 * from the original numbers rather than from an already-rescaled copy.
 */
export interface AuthoredSpec {
  readonly label: string;
  readonly cieMax: number;
  readonly eseMax: number;
  readonly components: readonly Component[];
  /**
   * Marks this type reserves for attendance, when it differs from the
   * scheme's own figure.
   *
   * Per type rather than per scheme because it genuinely varies: a college
   * can weight attendance differently in a lab than in a theory paper, and a
   * ledger quoting /5 while the CIE spends out of 10 is exactly the drift
   * this model exists to prevent. Omitted means "whatever the scheme says",
   * which is every type KTU 2024 ships.
   */
  readonly attMax?: number;
}

export interface Scheme {
  readonly id: string;
  readonly name: string;
  /** Where the numbers came from, shown to the student. */
  readonly source: string;
  /** Built-in profiles ship verified and cannot be edited in place. */
  readonly builtIn: boolean;

  readonly gradeBands: readonly GradeBand[];
  /** CIE + ESE must reach this out of 100. */
  readonly totalPassMark: number;
  /** Separate ESE minimum, as a fraction of the ESE maximum. */
  readonly esePassFraction: number;

  /** Eligibility threshold (%). */
  readonly attendanceMin: number;
  /** Lowest attendance that can still be condoned. */
  readonly attendanceCondone: number;
  /** Cap on duty-leave relaxation, in percentage points. */
  readonly dlCapPct: number;

  readonly attendanceMarkBands: readonly AttendanceMarkBand[];
  /** CIE marks reserved for attendance. */
  readonly attendanceMarkMax: number;

  readonly courseTypes: Readonly<Record<TypeKey, AuthoredSpec>>;
  readonly defaultType: TypeKey;
  readonly targetChoices: readonly Letter[];
}

const comp = (
  key: Component["key"], header: string, rawMax: number, weight: number,
): Component => ({ key, header, rawMax, weight });

/**
 * KTU B.Tech Regulations 2024.
 *
 * Every number here was checked against the Regulations 2024 PDF or a live
 * grade card. Where a value contradicts what older KTU calculators show, the
 * comment says why - those tools mostly still encode the 2019 scheme.
 */
export const KTU_2024: Scheme = {
  id: "ktu-2024",
  name: "KTU 2024",
  source: "APJ Abdul Kalam Technological University, B.Tech Regulations 2024",
  builtIn: true,

  gradeBands: [
    { letter: "S", minPct: 90, points: 10.0 },
    { letter: "A+", minPct: 85, points: 9.0 },
    { letter: "A", minPct: 80, points: 8.5 },
    { letter: "B+", minPct: 75, points: 8.0 },
    { letter: "B", minPct: 70, points: 7.5 },
    { letter: "C+", minPct: 65, points: 7.0 },
    { letter: "C", minPct: 60, points: 6.5 },
    { letter: "D", minPct: 55, points: 6.0 },
    { letter: "P", minPct: 50, points: 5.5 },
  ],
  totalPassMark: 50,
  esePassFraction: 0.4,

  attendanceMin: 75.0,
  // R 6.2: the Principal may condone attendance below 75% only down to 60%,
  // for at most two semesters and against a fee. Below 60% there is no appeal.
  attendanceCondone: 60.0,
  // R 6.3.ii: "Attendance relaxation is allowed up to a maximum of 10%".
  dlCapPct: 10.0,

  // R 7.5.ii - CIE Marks for Attendance. Attendance is not only an
  // eligibility gate, it is worth marks inside the internal total.
  attendanceMarkBands: [
    { minPct: 85.0, marks: 5 },
    { minPct: 80.0, marks: 4 },
    { minPct: 75.0, marks: 3 },
    { minPct: 70.0, marks: 2 },
    { minPct: 60.0, marks: 1 },
  ],
  attendanceMarkMax: 5,

  courseTypes: {
    "TH 40/60": {
      label: "Theory - CIE 40 / ESE 60",
      cieMax: 40,
      eseMax: 60,
      components: [comp("s1", "S1", 50, 15), comp("s2", "S2", 50, 15), comp("other", "Asg", 10, 10)],
    },
    "TH 50/50": {
      label: "Theory - CIE 50 / ESE 50",
      cieMax: 50,
      eseMax: 50,
      components: [comp("s1", "S1", 50, 20), comp("s2", "S2", 50, 20), comp("other", "Asg", 10, 10)],
    },
    // The 2024 scheme's real lab split. Earlier schemes used 75/25, which is
    // why so many calculators still show it - the pass mark differs.
    "LAB 50/50": {
      label: "Lab / Practical - CIE 50 / ESE 50",
      cieMax: 50,
      eseMax: 50,
      components: [comp("s1", "Cont", 50, 25), comp("s2", "Test", 50, 15), comp("other", "Rec", 10, 10)],
    },
    // Project-based-learning courses invert the split: more weight inside the
    // semester, a smaller final exam - but the 40% ESE rule still applies, so
    // the cutoff is 16/40.
    "PBL 60/40": {
      label: "Project-based course - CIE 60 / ESE 40",
      cieMax: 60,
      eseMax: 40,
      components: [comp("s1", "Eval1", 50, 25), comp("s2", "Eval2", 50, 25), comp("other", "Work", 10, 10)],
    },
    "LAB 75/25": {
      label: "Lab / Practical - CIE 75 / ESE 25",
      cieMax: 75,
      eseMax: 25,
      components: [comp("s1", "Cont", 50, 45), comp("s2", "Test", 50, 20), comp("other", "Rec", 10, 10)],
    },
    "PRJ 100/0": {
      label: "Project / Internal only - CIE 100",
      cieMax: 100,
      eseMax: 0,
      components: [comp("s1", "Eval1", 50, 50), comp("s2", "Eval2", 50, 40), comp("other", "Rep", 10, 10)],
    },
  },
  defaultType: "TH 40/60",
  targetChoices: ["S", "A+", "A", "B+", "B", "C+", "C", "D", "P"],
};

/**
 * Make room for the attendance marks inside a CIE bucket.
 *
 * Authored weights are on the full `cieMax` scale; this rescales them
 * proportionally into `cieMax - attMax` so that components + attendance total
 * `cieMax` exactly. Relative weights are preserved; only the room for
 * attendance comes out of them.
 *
 * This is a deliberate approximation, inherited from the constants this file
 * replaced. KTU's official per-course-type split of the remaining marks for
 * the 2024 scheme is not reproduced anywhere in this repo, and inventing one
 * would be a fabrication dressed as a regulation - so attendance takes the
 * regulation's own number and everything else keeps the proportions already
 * modelled. Whoever obtains the real split authors the weights post-rescale
 * and this function becomes the identity for that scheme.
 *
 * Worked example, TH 40/60 at attMax 5: 15/15/10 (= 40) becomes
 * 13.125/13.125/8.75 (= 35), plus attMax 5 = 40.
 *
 * A scheme with `attendanceMarkMax: 0` gets its authored weights back
 * untouched, which is what a college that does not award attendance marks
 * should see.
 */
export function resolveSpec(authored: AuthoredSpec, attMax: number): CourseSpec {
  const room = authored.cieMax - attMax;
  const total = authored.components.reduce((sum, c) => sum + c.weight, 0);
  return {
    label: authored.label,
    cieMax: authored.cieMax,
    eseMax: authored.eseMax,
    attMax,
    components: authored.components.map((c) => ({
      ...c,
      weight: total === 0 ? 0 : (c.weight / total) * room,
    })),
  };
}

/**
 * The scheme the engine is currently computing against.
 *
 * A plain module-level holder, deliberately not a Solid signal: the engine
 * has no reactive dependency and keeping it that way is what lets its tests
 * run as fast and as isolated as they do. The UI owns reactivity - it keeps
 * the chosen profile in a signal, calls `setActiveScheme` when that changes,
 * and its own memos re-run because they read the signal, not because the
 * engine told them to.
 *
 * Anything reading this is asking "what are the rules for THIS student",
 * which is the question a profile answers. Code that genuinely means the
 * published KTU numbers - a comparison, a migration, a default - should name
 * `KTU_2024` instead and not follow the student's edits.
 */
let active: Scheme = KTU_2024;

export const activeScheme = (): Scheme => active;

export function setActiveScheme(scheme: Scheme): void {
  active = scheme;
}

/** Restore the built-in profile. Tests must call this rather than leak state. */
export function resetActiveScheme(): void {
  active = KTU_2024;
}

/** Every course type in a scheme, resolved against its attendance reserve. */
export function resolveCourseTypes(scheme: Scheme): Record<TypeKey, CourseSpec> {
  const out = {} as Record<TypeKey, CourseSpec>;
  for (const key of Object.keys(scheme.courseTypes) as TypeKey[]) {
    const authored = scheme.courseTypes[key];
    out[key] = resolveSpec(authored, authored.attMax ?? scheme.attendanceMarkMax);
  }
  return out;
}

/**
 * Derived lookups for the active scheme, computed once per scheme object.
 *
 * `evaluate` runs per course on every render, so resolving the course types
 * or rebuilding a grade-point map inside it would allocate on a hot path for
 * numbers that only change when the student switches profile. The cache is
 * keyed on the scheme object's identity: profiles are treated as immutable,
 * so an edit produces a new object and a new entry rather than a stale hit.
 */
interface Derived {
  courseTypes: Record<TypeKey, CourseSpec>;
  gradePoints: Record<Grade, number>;
  gradeMin: Record<Letter, number>;
}

const derivedCache = new WeakMap<Scheme, Derived>();

function derived(scheme: Scheme): Derived {
  const hit = derivedCache.get(scheme);
  if (hit) return hit;
  const built: Derived = {
    courseTypes: resolveCourseTypes(scheme),
    gradePoints: {
      ...(Object.fromEntries(
        scheme.gradeBands.map((b) => [b.letter, b.points]),
      ) as Record<Letter, number>),
      // F is the absence of a band, not one of them, and always scores zero.
      F: 0.0,
    },
    gradeMin: Object.fromEntries(
      scheme.gradeBands.map((b) => [b.letter, b.minPct]),
    ) as Record<Letter, number>,
  };
  derivedCache.set(scheme, built);
  return built;
}

/**
 * The same three lookups against a NAMED scheme rather than the active one.
 *
 * The UI needs these. A screen cannot read `activeScheme()` and expect to
 * re-render when the student switches profile - that holder is a plain
 * variable, deliberately, so the engine stays free of Solid. The reactive
 * source is the store, so the UI resolves its own profile from there and asks
 * for that profile's lookups by name. Same cache, same objects; the only
 * difference is who chose the scheme.
 */
export const courseTypesOf = (scheme: Scheme): Record<TypeKey, CourseSpec> =>
  derived(scheme).courseTypes;

export const gradePointsOf = (scheme: Scheme): Record<Grade, number> =>
  derived(scheme).gradePoints;

export const gradeMinOf = (scheme: Scheme): Record<Letter, number> =>
  derived(scheme).gradeMin;

/** Course types of the active scheme, with attendance's marks taken out. */
export const courseTypes = (): Record<TypeKey, CourseSpec> =>
  courseTypesOf(activeScheme());

/** Grade point per letter for the active scheme, including F at zero. */
export const gradePoints = (): Record<Grade, number> =>
  gradePointsOf(activeScheme());

/** Lowest total percentage earning each letter, for the active scheme. */
export const gradeMin = (): Record<Letter, number> =>
  gradeMinOf(activeScheme());
