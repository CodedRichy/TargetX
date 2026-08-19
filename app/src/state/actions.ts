import { unwrap } from "solid-js/store";
import {
  CATALOGUE_URL, blankCourse, catalogueVersion, courseFromCode, parseEtlab,
  setCatalogue,
} from "../engine";
import type { Course, PresetCourse } from "../engine";
import type { SyncResult } from "../sync/etlab";
import type { GradeCard } from "../sync/gradecard";
import { edit, migrateHistory, state } from "./store";

/**
 * Everything that changes the document as a whole: bringing data in, taking it
 * out, and replacing it. Kept apart from the per-cell editing in store.ts
 * because these are the operations that can destroy work, and they should be
 * easy to find and audit in one file.
 */

// --- sync ------------------------------------------------------------------

/**
 * Apply a full portal sync.
 *
 * Replaces every synced semester wholesale rather than merging field by field.
 * The portal is the system of record for attendance, internals and grades; a
 * clever merge would preserve a stale local value and there would be no way for
 * the student to tell which number came from where.
 *
 * What survives: locally chosen targets and credits the student has corrected,
 * because the portal publishes neither.
 */
export function applySync(result: SyncResult) {
  edit((s) => {
    for (const [name, incoming] of Object.entries(result.semesters)) {
      const existing = s.semesters[name]?.courses ?? [];
      const byCode = new Map(existing.map((c) => [(c.code || "").toUpperCase(), c]));

      s.semesters[name] = {
        courses: incoming.courses.map((course) => {
          const previous = byCode.get((course.code || "").toUpperCase());
          if (!previous) return course;
          return {
            ...course,
            target: previous.target ?? course.target,
            // Credits are inferred, never published per course. If the student
            // has corrected one, that correction is better evidence than our
            // inference and must not be overwritten by a re-sync.
            credits: previous.creditsConfirmed ? previous.credits : course.credits,
            creditsConfirmed: previous.creditsConfirmed,
          } as Course;
        }),
        creditCheck: incoming.creditCheck,
      };
    }
    // Published SGPA is the university's number and outranks anything derived.
    Object.assign(s.history, result.history);
    if (result.current) s.activeSemester = result.current;
    s.lastSync = new Date().toISOString();
  });
}

// --- presets ---------------------------------------------------------------

/** Seed a semester from the branch curriculum. Replaces whatever is there. */
export function applyPreset(semester: string, picks: PresetCourse[]) {
  edit((s) => {
    s.semesters[semester] = {
      courses: picks.map((p) => blankCourse(p.code, p.name, p.credits, p.type)),
    };
    s.activeSemester = semester;
  });
}

// --- paste import ----------------------------------------------------------

export interface ImportOutcome { matched: number; added: number; skipped: number }

/**
 * Fold pasted portal text into the active semester.
 *
 * Merges by course code instead of replacing, because a paste is usually one
 * page - attendance OR marks - and wiping the other half would be a data loss
 * the student did not ask for.
 */
export function importPaste(text: string, mode: "attendance" | "marks"): ImportOutcome {
  const rows = parseEtlab(text, mode);
  let matched = 0, added = 0;

  edit((s) => {
    const sem = s.semesters[s.activeSemester] ?? (s.semesters[s.activeSemester] = { courses: [] });
    const byCode = new Map(sem.courses.map((c, i) => [(c.code || "").toUpperCase(), i]));

    for (const row of rows) {
      const key = row.code.toUpperCase();
      let index = byCode.get(key);
      if (index === undefined) {
        sem.courses.push(courseFromCode(row.code));
        index = sem.courses.length - 1;
        byCode.set(key, index);
        added += 1;
      } else {
        matched += 1;
      }
      const course = sem.courses[index]!;
      if (row.name && !course.name) course.name = row.name;
      if (mode === "attendance") {
        if (row.attendance !== undefined) course.attendance = row.attendance;
      } else {
        if (row.s1 !== undefined) course.s1 = row.s1;
        if (row.s2 !== undefined) course.s2 = row.s2;
        if (row.other !== undefined) course.other = row.other;
      }
    }
  });

  return { matched, added, skipped: 0 };
}

// --- grade card ------------------------------------------------------------

export interface CardOutcome { semesters: number; courses: number; mismatched: string[] }

/**
 * Apply a parsed KTU grade card.
 *
 * Writes two different kinds of fact to two different places: the per-course
 * grades become semester rows, and the printed SGPA becomes history. History is
 * only ever written from the number the university printed - never from our own
 * recomputation, which exists purely to check it.
 *
 * Semesters whose recomputed SGPA disagrees with the printed one are still
 * imported, but reported back, because a parse that ate a row should be visible
 * rather than silently believed.
 */
export function applyGradeCard(card: GradeCard): CardOutcome {
  const mismatched: string[] = [];
  let courses = 0;

  edit((s) => {
    for (const [name, entry] of Object.entries(card.semesters)) {
      if (!entry.courses.length) continue;
      const existing = s.semesters[name]?.courses ?? [];
      const byCode = new Map(existing.map((c) => [(c.code || "").toUpperCase(), c]));

      s.semesters[name] = {
        courses: entry.courses.map((c) => {
          const previous = byCode.get(c.code.toUpperCase());
          // Attendance and series marks are never on a grade card. Dropping a
          // synced semester's working data because its final grades arrived
          // would be a loss the student never asked for, so the card writes
          // only the three columns it actually carries.
          return {
            ...(previous ?? courseFromCode(c.code)),
            name: c.name || previous?.name || "",
            credits: c.credits,
            portal_grade: c.grade,
          };
        }),
      };
      courses += entry.courses.length;
      if (entry.sgpaPrinted !== undefined) {
        s.history[name] = {
          sgpa: entry.sgpaPrinted,
          // The card lists every course the student registered for, failures
          // included, so `entry.credits` IS the registered total - the one KTU
          // weights the CGPA by. It is the one exception the parser already
          // makes for it: an I or a W is out of that total, because
          // `sgpaPrinted` stored beside it here is the university's own figure
          // and was computed without them. The earned total rides along for
          // display.
          creditsRegistered: entry.credits,
          creditsEarned: entry.creditsEarned,
        };
      }
      if (entry.mismatch) mismatched.push(name);
    }
  });

  return { semesters: Object.keys(card.semesters).length, courses, mismatched };
}

// --- catalogue -------------------------------------------------------------

/**
 * Refresh the course catalogue from the repo.
 *
 * KTU revises the curriculum between batches and every branch is a separate
 * PDF, so the catalogue has to move without shipping a new binary. The bundled
 * copy is the fallback; this is the update path.
 */
export async function updateCatalogue(): Promise<string> {
  const before = catalogueVersion();
  let payload: unknown;
  try {
    const response = await fetch(CATALOGUE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch (exc) {
    throw new Error(`Could not reach the catalogue: ${String(exc)}`);
  }
  if (!setCatalogue(payload as never)) {
    return `Already on the newest catalogue (version ${before}).`;
  }
  return `Updated catalogue: version ${before} to ${catalogueVersion()}.`;
}

// --- backup ----------------------------------------------------------------

/** The student's data, as a file they own. No account, no server, no lock-in. */
export function exportJson(): string {
  return JSON.stringify(unwrap(state), null, 2);
}

export function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * A plain-text report of the current semester.
 *
 * Kept from the Python build because it is what gets pasted into a message to a
 * parent or a tutor, and a screenshot of a dark table is not that.
 */
export function reportText(rows: Array<{ course: Course; ev: Record<string, unknown>; status: string }>,
                           semester: string, summary: Record<string, unknown>): string {
  const lines: string[] = [
    `TargetX - ${semester}`,
    new Date().toISOString().slice(0, 10),
    "",
    "CODE       CR  CIE     ATT%   NEED-PASS  NEED-TARGET  GRADE  STATUS",
  ];
  for (const row of rows) {
    const ev = row.ev as Record<string, never>;
    const need = ev["needPass"] as unknown as { text: string };
    const target = ev["needTarget"] as unknown as { text: string };
    lines.push([
      (row.course.code || "?").padEnd(10),
      String(ev["credits"] ?? "").padStart(2),
      String(ev["assessed"] ? `${ev["cie"]}/${ev["cieMax"]}` : "-").padStart(7),
      String(ev["attendance"] == null ? "-" : Math.round(Number(ev["attendance"]))).padStart(5),
      String(ev["assessed"] ? need.text : "-").padStart(10),
      String(ev["assessed"] ? target.text : "-").padStart(12),
      String(ev["grade"] ?? "-").padStart(6),
      "  " + row.status,
    ].join(" "));
  }
  lines.push("",
    `Confirmed SGPA ${summary["sgpaConfirmed"]}   Projected ${summary["sgpaProjected"]}`,
    `Credits ${summary["creditsConfirmed"]} of ${summary["credits"]}`);
  return lines.join("\n");
}

export function importJson(text: string) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.semesters) {
    throw new Error("That file is not a TargetX backup.");
  }
  // A backup written before the registered/earned credit split is the same
  // old shape arriving later, so it goes through the same migration as a load.
  edit((s) => Object.assign(s, parsed, { history: migrateHistory(parsed.history) }));
}

export function resetEverything() {
  edit((s) => {
    s.semesters = { S1: { courses: [] } };
    s.history = {};
    s.activeSemester = "S1";
    s.goal = { cgpa: null };
    s.onboarded = false;
    s.lastSync = undefined;
  });
}
