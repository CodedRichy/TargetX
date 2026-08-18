import bundled from "../data/curriculum.json";
import type { Course, MarkInput, TypeKey } from "./types";
import { toFloat, toOptionalFloat } from "./util";

export interface CatalogueEntry {
  credits: number;
  type: TypeKey;
  name: string;
}

interface Curriculum {
  version?: number;
  credits?: Record<string, CatalogueEntry>;
  branches?: Record<string, Record<string, Array<[string, string, number, string]>>>;
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
