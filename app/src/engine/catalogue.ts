import bundled from "../data/curriculum.json";
import type { Course, MarkInput, TypeKey } from "./types";
import { toFloat, toOptionalFloat } from "./util";

export interface CatalogueEntry {
  credits: number;
  type: TypeKey;
  name: string;
}

/**
 * A row in a branch table: code, name, credits, type, and optionally a SLOT.
 *
 * KTU's first year does not name every subject. Two positions are choices -
 * Slot B is Physics or Chemistry, Slot I is Health and Wellness or Life Skills
 * - and a student takes one of each in S1 and the other in S2. Which way round
 * is set by the institution, not by KTU, so it cannot be derived from the
 * branch and must not be guessed: seeding the wrong one is a wrong subject in
 * the record, and seeding both is 4 phantom credits in the SGPA denominator.
 * Rows sharing a slot id are alternatives, exactly one of which is real.
 */
type BranchRow = [string, string, number, string] | [string, string, number, string, string];

interface Curriculum {
  version?: number;
  credits?: Record<string, CatalogueEntry>;
  branches?: Record<string, Record<string, BranchRow[]>>;
  /**
   * Credits KTU registers for a semester, as the curriculum itself prints them.
   *
   * Held separately from the tables because it is the university's number, not
   * a sum of ours - which is the point: when a preset does not add up to it,
   * the preset is incomplete and the app can say so instead of seeding a wrong
   * SGPA denominator in silence.
   */
  expected?: Record<string, Record<string, number>>;
  /**
   * First-year tables, keyed by KTU's own GROUP rather than by branch.
   *
   * Page 1 of the 2024 curriculum sorts every B.Tech branch into four groups -
   * A computer and information science, B electrical science, C physical
   * science, D life science - and prints ONE first-year table per group. So S1
   * and S2 are not per-branch data at all, and holding them as if they were is
   * what left every non-CSE student with no preset: thirty-odd branches whose
   * first year we already had, keyed under a name none of them would pick.
   *
   * A branch's own table still wins where it has one, because the programme
   * core in S2 is printed generically (PCXXT205, XX being the branch) and a
   * branch that has been transcribed properly names its instantiation.
   */
  groups?: Record<string, Record<string, BranchRow[]>>;
  /** Branch name -> group id. The only place branch names are enumerated. */
  branch_group?: Record<string, string>;
  /** `expected`, per group, for the first-year semesters the groups carry. */
  expected_group?: Record<string, Record<string, number>>;
  /**
   * Other names for a branch, mapped to the one the tables are keyed by.
   *
   * The tables were keyed by "CSE" before they were keyed by the name KTU
   * prints, and a student's saved record still holds whatever it was keyed by
   * when they set up. Without this, an upgrade quietly turns their branch into
   * one the catalogue has never heard of and their presets vanish.
   */
  aliases?: Record<string, string>;
}

/**
 * The course catalogue must be updatable without shipping a new binary. KTU
 * revises the curriculum between batches, adds electives mid-scheme, and every
 * branch is a separate PDF - so the app carries a snapshot as a fallback while
 * a live copy is fetched from the repo and cached beside the student's data.
 */
export const CATALOGUE_URL =
  "https://raw.githubusercontent.com/CodedRichy/TargetX/main/curriculum.json";

// The bundled JSON is widened by TypeScript (tuples become arrays), so it
// is admitted through `unknown`. Only `credits` is read at runtime and
// `setCatalogue` validates that field before swapping anything in.
let active: Curriculum = bundled as unknown as Curriculum;

/** Replace the in-memory catalogue, but only with a strictly newer version. */
export function setCatalogue(next: Curriculum): boolean {
  const here = active.version ?? 0;
  const there = next?.version ?? 0;
  if (!next?.credits || there <= here) return false;
  active = next;
  return true;
}

export const catalogueVersion = (): number => active.version ?? 0;
export const courseCatalogue = (): Record<string, CatalogueEntry> => active.credits ?? {};

/** Catalogue entry for a code, or undefined when it is not listed. */
export const lookupCourse = (code: string | undefined): CatalogueEntry | undefined =>
  courseCatalogue()[(code || "").toUpperCase()];

/**
 * Best estimate of a course's credits from its KTU 2024 code.
 *
 * Portals publish credits per SEMESTER, never per course, so this has to be
 * inferred - and a wrong credit silently distorts SGPA, which is the one
 * number the whole app exists to get right. The rule below reproduces the
 * published earned-credit totals exactly for the S3 and S4 patterns it was
 * checked against, and is deliberately paired with verifyCredits() so a
 * semester it gets wrong says so out loud instead of quietly lying.
 *
 * First-year semesters use a different structure and are NOT matched by this
 * rule; they are expected to fail the check and be corrected by hand.
 */
export function inferCredits(code: string | undefined): number {
  const listed = lookupCourse(code)?.credits;
  if (listed) return listed;
  const letters = /^([A-Z]+)/.exec((code || "").toUpperCase())?.[1] ?? "";
  if (letters.endsWith("L")) return 2;               // any lab / practical
  if (letters.startsWith("PCC")) return 4;           // programme core theory
  if (letters.startsWith("PBC") || letters.startsWith("PEC")) return 3;
  if (letters.startsWith("UCH")) return 2;           // humanities
  if (letters.startsWith("UCE")) return 3;
  return 4;
}

export interface CreditCheck {
  matched: boolean | null;
  current: number;
  published: number | null;
  delta: number | null;
}

/**
 * Compare the credits in hand against the total the portal published.
 *
 * Returns matched=null when there is nothing to check against. This is the
 * honesty valve on inferCredits: the student is told when the seeded numbers
 * cannot be right, rather than discovering it after results.
 */
export function verifyCredits(courses: Course[], publishedTotal: MarkInput): CreditCheck {
  const published = toOptionalFloat(publishedTotal);
  const current = courses.reduce((sum, c) => sum + toFloat(c.credits, 0), 0);
  if (published === null || published <= 0) {
    return { matched: null, current, published: null, delta: null };
  }
  const delta = Math.round((current - published) * 100) / 100;
  return { matched: Math.abs(delta) < 0.01, current, published, delta };
}

// --- branch presets --------------------------------------------------------

/**
 * A semester's course list as published in the curriculum.
 *
 * These tables list every elective on offer, not the six or seven courses any
 * one student registered - S7 CSE has 24 entries. So this is a pick list, not
 * something to seed blindly: electives come back unticked and the student says
 * which ones are theirs. Getting that wrong would silently corrupt SGPA with
 * credits nobody is taking.
 */
export interface PresetCourse {
  code: string;
  name: string;
  credits: number;
  type: TypeKey;
  elective: boolean;
  /** Position in the curriculum table, which is the order KTU prints. */
  index: number;
  /** Set when this row is one of a slot's alternatives; see `BranchRow`. */
  slot?: string;
}

/** PEC/OEC are chosen; everything else is compulsory for the branch. */
const ELECTIVE_PREFIXES = ["PEC", "OEC", "MEC", "HEC"];

/** The name the tables are keyed by, for a name the student may have saved. */
export const resolveBranch = (branch: string): string =>
  active.aliases?.[branch] ?? branch;

/** The group table standing behind a branch, if the catalogue names one. */
const groupTable = (branch: string): Record<string, BranchRow[]> => {
  const id = active.branch_group?.[resolveBranch(branch)];
  return (id && active.groups?.[id]) || {};
};

export const branches = (): string[] =>
  [...new Set([
    ...Object.keys(active.branches ?? {}),
    ...Object.keys(active.branch_group ?? {}),
  ])].sort();

/**
 * What to select when the student has not chosen yet.
 *
 * Alphabetically first is arbitrary and, now that thirty-one branches are
 * listed, lands on one that carries only a first year. The branch with its own
 * transcribed table is the one where every semester works.
 */
export const defaultBranch = (): string =>
  Object.keys(active.branches ?? {}).sort()[0] ?? branches()[0] ?? "";

export function semesterKeys(branch: string): string[] {
  const own = active.branches?.[resolveBranch(branch)] ?? {};
  return [...new Set([...Object.keys(own), ...Object.keys(groupTable(branch))])]
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

export function presetCourses(branch: string, semester: string): PresetCourse[] {
  // The branch's own table first. A group table is the first year as KTU
  // prints it for every branch in the group; a branch table is that branch
  // actually transcribed, down to which subject its generic PCXXT205 is.
  const rows = active.branches?.[resolveBranch(branch)]?.[semester]
    ?? groupTable(branch)[semester]
    ?? [];
  return rows.map(([code, name, credits, type, slot], index) => ({
    code, name, credits, index,
    type: type as TypeKey,
    elective: ELECTIVE_PREFIXES.some((p) => code.toUpperCase().startsWith(p)),
    ...(slot ? { slot } : {}),
  })).sort((a, b) =>
    // Compulsory first, then each slot's alternatives TOGETHER, then
    // electives. Alphabetical order alone scattered "choose one" rows down the
    // list - Physics second, Chemistry fourth - so the pair read as two
    // unrelated tick boxes that happened to share a tag rather than as one
    // choice with two answers.
    Number(a.elective) - Number(b.elective)
    || (a.slot ?? "").localeCompare(b.slot ?? "")
    // Inside a slot, the order the CURRICULUM lists them in, not alphabetical.
    // The default tick is the first alternative, and alphabetical made that
    // GBEST213 Engineering Mechanics - a row KTU offers to four branches only -
    // ahead of GXEST203, which is the one every other branch in the group
    // takes. Sorting by code pre-ticked the wrong subject for most of them.
    || (a.slot ? a.index - b.index : a.code.localeCompare(b.code)));
}

/**
 * Credits KTU registers for this semester, or null when nothing says.
 *
 * The S1 CSE preset used to list 15 credits against a curriculum that
 * registers 20 - it was missing an entire 4-credit subject and both slot
 * choices - so a first year seeding from it started with an SGPA divided by
 * three quarters of the right number, on the day they installed the app, with
 * nothing on screen to suggest anything was missing. The fix is not only the
 * five rows that were added: it is that the app now holds the university's own
 * total and can tell the student what a preset does not cover.
 */
export const expectedCredits = (branch: string, semester: string): number | null => {
  const own = active.expected?.[resolveBranch(branch)]?.[semester];
  if (own != null) return own;
  const id = active.branch_group?.[resolveBranch(branch)];
  return (id ? active.expected_group?.[id]?.[semester] : undefined) ?? null;
};

/**
 * One code per slot, defaulting to the first alternative listed.
 *
 * A default has to be picked or the preset is short by 5 credits out of the
 * box, and there is no way to be right: the Physics-or-Chemistry order is the
 * institution's choice. So the picker offers them as a choice rather than
 * hiding one, and this is only where the tick starts.
 */
export function defaultSlotChoice(courses: PresetCourse[]): Set<string> {
  const chosen = new Set<string>();
  const taken = new Set<string>();
  for (const course of courses) {
    if (!course.slot || taken.has(course.slot)) continue;
    taken.add(course.slot);
    chosen.add(course.code);
  }
  return chosen;
}
