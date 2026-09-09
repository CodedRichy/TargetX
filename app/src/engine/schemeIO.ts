import type { Component, Letter, TypeKey } from "./types";
import type { AuthoredSpec, Scheme } from "./scheme";
import { KTU_2024 } from "./scheme";
import { resolveDraft } from "./schemeDraft";

/**
 * Carrying a scheme profile between students.
 *
 * We ship exactly one verified profile, KTU 2024, and we will not ship a
 * second one for a university whose regulations nobody here has read. A
 * preset is a claim, `Scheme.source` is where that claim is written down, and
 * inventing "VTU 2022" from memory would put a fabricated pass mark behind
 * the same badge as a checked one. The student who plans a semester around it
 * finds out at results.
 *
 * So the library is not authored here, it is passed around. One student at an
 * autonomous college types their scheme in once and hands the file to
 * everyone else there. Provenance becomes the sender - a person the receiver
 * knows - instead of a stamp we were never entitled to apply.
 *
 * Which puts the whole weight on this file: an imported profile is untrusted
 * input that decides what grade the app reports. Two rules follow, and both
 * are absolute.
 *
 * 1. Nothing arrives verified. `builtIn` is never read off a file. There is
 *    no string a sender can write that makes their numbers ours.
 * 2. Nothing skips validation. Every scalar goes through `resolveDraft`, the
 *    same rules the editor enforces, because the failure this prevents is
 *    silent: `gradeForTotal` returns the FIRST band whose minimum a total
 *    clears, so grade bands listed out of order do not throw, they hand out
 *    the wrong letter. A file is far likelier to carry that than a form is.
 */

/** What `exportScheme` writes and `importScheme` accepts. */
export const TRANSFER_FORMAT = "targetx.scheme";
export const TRANSFER_VERSION = 1;

interface Transfer {
  format: string;
  version: number;
  scheme: unknown;
}

/** Every course-type key this build knows. A file may not invent one. */
const TYPE_KEYS: readonly TypeKey[] = [
  "TH 40/60", "TH 50/50", "LAB 50/50", "PBL 60/40", "LAB 75/25", "PRJ 100/0",
];

const LETTERS: readonly Letter[] = ["S", "A+", "A", "B+", "B", "C+", "C", "D", "P"];

const COMPONENT_KEYS: readonly Component["key"][] = ["s1", "s2", "other"];

/**
 * A profile, ready to be handed to someone else.
 *
 * `id` and `builtIn` are deliberately absent rather than exported as false.
 * They are facts about a profile's place in THIS installation - which row it
 * is, and whether we checked it - and neither survives the trip. The importer
 * mints its own id and sets `builtIn` itself; a field the receiver must
 * ignore is a field a sender will eventually try to use.
 */
export function exportScheme(scheme: Scheme): string {
  const { id: _id, builtIn: _builtIn, ...rest } = scheme;
  const body: Transfer = {
    format: TRANSFER_FORMAT,
    version: TRANSFER_VERSION,
    scheme: rest,
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Check one course type.
 *
 * `resolveDraft` covers the scalars a student edits on screen; course types
 * are not editable there yet, so nothing else would look at these numbers
 * before `resolveSpec` divides by them. The reachability guard is the one
 * worth naming: `resolveSpec` makes room for attendance by rescaling the
 * components into `cieMax - attMax`, so a file claiming more attendance marks
 * than the CIE is worth produces NEGATIVE component weights and a course
 * where scoring full marks lowers the total.
 */
function checkType(key: string, raw: unknown, schemeAttMax: number, errors: string[]): void {
  const where = `Course type "${key}"`;
  if (!TYPE_KEYS.includes(key as TypeKey)) {
    errors.push(
      `${where} is not a course type this version of TargetX knows. `
      + `Known types: ${TYPE_KEYS.join(", ")}.`,
    );
    return;
  }
  if (!isObject(raw)) { errors.push(`${where} is not filled in.`); return; }

  if (typeof raw.label !== "string" || !raw.label.trim()) {
    errors.push(`${where} needs a label.`);
  }
  const cieMax = num(raw.cieMax);
  const eseMax = num(raw.eseMax);
  if (cieMax === null || cieMax < 0) errors.push(`${where}: CIE maximum must be a number, zero or more.`);
  if (eseMax === null || eseMax < 0) errors.push(`${where}: ESE maximum must be a number, zero or more.`);

  const attMax = raw.attMax === undefined ? schemeAttMax : num(raw.attMax);
  if (attMax === null || attMax < 0) {
    errors.push(`${where}: attendance marks must be a number, zero or more.`);
  } else if (cieMax !== null && attMax > cieMax) {
    errors.push(
      `${where} reserves ${attMax} marks for attendance out of a CIE worth `
      + `${cieMax} - there would be nothing left for the rest of the internals.`,
    );
  }

  if (!Array.isArray(raw.components) || raw.components.length === 0) {
    errors.push(`${where} needs at least one internal component.`);
    return;
  }
  raw.components.forEach((c: unknown, i: number) => {
    const at = `${where}, component ${i + 1}`;
    if (!isObject(c)) { errors.push(`${at} is not filled in.`); return; }
    if (!COMPONENT_KEYS.includes(c.key as Component["key"])) {
      errors.push(`${at}: key must be one of ${COMPONENT_KEYS.join(", ")}.`);
    }
    if (typeof c.header !== "string" || !c.header.trim()) errors.push(`${at} needs a heading.`);
    const rawMax = num(c.rawMax);
    const weight = num(c.weight);
    if (rawMax === null || rawMax <= 0) errors.push(`${at}: the mark it is out of must be above zero.`);
    if (weight === null || weight < 0) errors.push(`${at}: weight must be zero or more.`);
  });
}

/**
 * Read a profile someone sent you.
 *
 * Returns the fields of a `Scheme` minus the two the receiver owns, or the
 * reasons it was refused. Refusal is always a list of sentences a student can
 * act on, never "invalid" - the file came from a classmate, and the useful
 * outcome is that they can go fix it.
 */
export function importScheme(text: string): {
  errors: string[];
  scheme?: Omit<Scheme, "id" | "builtIn">;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      errors: [
        "That is not a scheme file - it is not valid JSON. Paste the whole "
        + "file, from the first { to the last }.",
      ],
    };
  }

  if (!isObject(parsed)) return { errors: ["A scheme file holds one profile, written as an object."] };
  if (parsed.format !== TRANSFER_FORMAT) {
    return {
      errors: [
        "This does not look like a TargetX scheme file. An exported profile "
        + `starts with "format": "${TRANSFER_FORMAT}".`,
      ],
    };
  }
  const version = num(parsed.version);
  if (version === null || version > TRANSFER_VERSION) {
    return {
      errors: [
        `This file was written by a newer version of TargetX (format `
        + `${String(parsed.version)}, this build reads ${TRANSFER_VERSION}). Update, then import it.`,
      ],
    };
  }
  if (!isObject(parsed.scheme)) return { errors: ["The file has no profile in it."] };

  const raw = parsed.scheme;
  const errors: string[] = [];

  // Scalars, bands and name go through the editor's own rules. The draft is
  // built from strings because that is what `resolveDraft` reads; a missing
  // or non-numeric field becomes "" and is refused by the same check that
  // catches an empty box on screen.
  const str = (v: unknown): string => (typeof v === "number" || typeof v === "string" ? String(v) : "");
  const bands = Array.isArray(raw.gradeBands) ? raw.gradeBands : [];
  const attBands = Array.isArray(raw.attendanceMarkBands) ? raw.attendanceMarkBands : [];

  if (bands.length === 0) errors.push("The file has no grade bands, so nothing could be graded.");
  const badLetters = bands
    .map((b: unknown) => (isObject(b) ? b.letter : undefined))
    .filter((l: unknown) => !LETTERS.includes(l as Letter));
  if (badLetters.length > 0) {
    errors.push(
      `Grade letters must be one of ${LETTERS.join(", ")} - found `
      + `${badLetters.map((l) => JSON.stringify(l)).join(", ")}.`,
    );
  }

  const esePct = num(raw.esePassFraction);
  const draftLike = {
    name: typeof raw.name === "string" ? raw.name : "",
    gradeBands: bands.map((b: unknown) => ({
      letter: (isObject(b) ? b.letter : "") as Letter,
      minPct: str(isObject(b) ? b.minPct : undefined),
      points: str(isObject(b) ? b.points : undefined),
    })),
    totalPassMark: str(raw.totalPassMark),
    esePassPct: esePct === null ? "" : String(esePct * 100),
    attendanceMin: str(raw.attendanceMin),
    attendanceCondone: str(raw.attendanceCondone),
    dlCapPct: str(raw.dlCapPct),
    attendanceMarkBands: attBands.map((b: unknown) => ({
      minPct: str(isObject(b) ? b.minPct : undefined),
      marks: str(isObject(b) ? b.marks : undefined),
    })),
    attendanceMarkMax: str(raw.attendanceMarkMax),
  };
  // Letters were checked above; only run the band rules when they are sound,
  // since `resolveDraft` reports per letter and would name `undefined`.
  if (badLetters.length === 0) errors.push(...resolveDraft(draftLike).errors);

  if (typeof raw.source !== "string" || !raw.source.trim()) {
    errors.push("The file does not say where its numbers came from.");
  }

  const attendanceMarkMax = num(raw.attendanceMarkMax) ?? 0;
  if (!isObject(raw.courseTypes) || Object.keys(raw.courseTypes).length === 0) {
    errors.push("The file has no course types, so no marks could be totalled.");
  } else {
    for (const [key, spec] of Object.entries(raw.courseTypes)) {
      checkType(key, spec, attendanceMarkMax, errors);
    }
    if (typeof raw.defaultType !== "string" || !(raw.defaultType in raw.courseTypes)) {
      errors.push(
        `The default course type (${JSON.stringify(raw.defaultType)}) is not one of `
        + "the types the file defines.",
      );
    }
  }

  const targets = Array.isArray(raw.targetChoices) ? raw.targetChoices : [];
  if (targets.length === 0) {
    errors.push("The file offers no target grades to aim at.");
  } else {
    const unknownTargets = targets.filter((t: unknown) => !LETTERS.includes(t as Letter));
    if (unknownTargets.length > 0) {
      errors.push(`Target grades must be real letters - found ${unknownTargets.join(", ")}.`);
    } else if (badLetters.length === 0) {
      const defined = new Set(bands.map((b: unknown) => (isObject(b) ? b.letter : undefined)));
      const orphans = targets.filter((t: unknown) => !defined.has(t));
      if (orphans.length > 0) {
        errors.push(
          `${orphans.join(", ")} can be aimed at but has no grade band, so it `
          + "could never be reached.",
        );
      }
    }
  }

  if (errors.length > 0) return { errors };

  const patch = resolveDraft(draftLike).patch!;
  return {
    errors: [],
    scheme: {
      ...patch,
      name: patch.name!,
      source: (raw.source as string).trim(),
      gradeBands: patch.gradeBands!,
      totalPassMark: patch.totalPassMark!,
      esePassFraction: patch.esePassFraction!,
      attendanceMin: patch.attendanceMin!,
      attendanceCondone: patch.attendanceCondone!,
      dlCapPct: patch.dlCapPct!,
      attendanceMarkBands: patch.attendanceMarkBands!,
      attendanceMarkMax: patch.attendanceMarkMax!,
      courseTypes: raw.courseTypes as Record<TypeKey, AuthoredSpec>,
      defaultType: raw.defaultType as TypeKey,
      targetChoices: targets as Letter[],
    },
  };
}

/**
 * A profile with the structure filled in and the numbers left as KTU's.
 *
 * The one template worth shipping, and it is not a preset: a college whose
 * rules look nothing like KTU's should not begin by deleting KTU's
 * assumptions one box at a time, but it also must not be handed made-up
 * numbers wearing a plausible name. So the shape is real and the source line
 * says plainly that every figure is a placeholder someone has to replace.
 *
 * Course types come from KTU 2024 unchanged, because they are the one part
 * this screen cannot yet edit - handing over an empty set would produce a
 * profile that cannot total a mark at all.
 */
export function blankTemplate(): Omit<Scheme, "id" | "builtIn"> {
  const { id: _id, builtIn: _builtIn, ...shape } = KTU_2024;
  return {
    ...shape,
    name: "My college",
    source: "Not filled in yet - every number in this profile is still KTU's. "
      + "Replace them with your own college's rules before trusting anything "
      + "this app tells you.",
  };
}
