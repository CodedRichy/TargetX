import { unwrap } from "solid-js/store";
import {
  CATALOGUE_URL, blankCourse, catalogueVersion, courseFromCode, defaultState,
  defaultTargets, normaliseTargets, parseEtlab, requiredEseCell, setCatalogue,
} from "../engine";
import type { Course, PresetCourse, RequiredEse } from "../engine";
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

      // The card is authoritative for the courses it LISTS and silent about
      // every other one. A supplementary card carries one or two subjects, so
      // rebuilding the semester out of its contents deleted the rest of it -
      // attendance, series marks, targets and all - for precisely the students
      // most likely to import one. Merge by code instead: update what the card
      // names, keep what it does not, append what is new.
      const fromCard = new Map(entry.courses.map((c) => [c.code.toUpperCase(), c]));
      const merged: Course[] = existing.map((course) => {
        const key = (course.code || "").toUpperCase();
        const c = fromCard.get(key);
        if (!c) return course;
        fromCard.delete(key);
        // Attendance and series marks are never on a grade card, so only the
        // three columns it actually carries are written.
        return {
          ...course,
          name: c.name || course.name || "",
          credits: c.credits,
          portal_grade: c.grade,
        };
      });
      for (const c of fromCard.values()) {
        merged.push({
          ...courseFromCode(c.code),
          name: c.name,
          credits: c.credits,
          portal_grade: c.grade,
        });
      }
      s.semesters[name] = { ...s.semesters[name], courses: merged };
      courses += entry.courses.length;
      if (entry.sgpaPrinted !== undefined) {
        s.history[name] = {
          sgpa: entry.sgpaPrinted,
          // `entry.credits` is the registered total - the one KTU weights the
          // CGPA by. The card lists every course the student registered for,
          // and the parser keeps the failures, because an F is a result whose
          // credits KTU counts. It drops exactly one kind of row: an I or a W,
          // because `sgpaPrinted` stored beside it here is the university's
          // own figure and was computed without those courses. The earned
          // total rides along for display.
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
    "CODE       CR  CIE        ATT%   NEED-PASS  NEED-TARGET  GRADE  STATUS",
  ];
  for (const row of rows) {
    const ev = row.ev as Record<string, never>;
    // Two different questions, and conflating them is what put "Impossible"
    // in a required-mark column beside a status of TIGHT. `floor` asks whether
    // the CIE is unknown - a component or the attendance figure missing - and
    // it is what the ">=" on the CIE marks and what blanks the required-mark
    // columns, because on such a row both figures are guesses about marks that
    // are not the student's to earn. The columns themselves then ask the other
    // question through `requiredEseCell`: a fully marked CIE below 85%
    // attendance is exactly today's mark, but the requirement priced off it
    // can still fall, so the cell quotes the reachable end and marks it.
    //
    // The marker costs two characters, so both kinds of column are wide enough
    // to hold them: the CIE is printed to one decimal like the ledger cell,
    // which caps a settled cell at "100.0/100" (9) and a marked-but-unsettled
    // one at ">=95.0/100" (10), the floor being at most cieMax - attMax
    // whenever the marker shows; the widest required mark a course type can
    // produce is ">=60/60" (7) - 60 is the largest `eseMax` in
    // `COURSE_TYPES` - against columns of 10 and 12, and the word
    // "Impossible" (10) still fits both. A column that overflows shifts every column to
    // the right of it on that row alone, and this is a table meant to be
    // pasted whole.
    const req = (k: string) => ev[k] as unknown as RequiredEse;
    const pass = requiredEseCell(req("needPass"), req("needPassBest"));
    const target = requiredEseCell(req("needTarget"), req("needTargetBest"));
    const floor = Boolean(ev["cieFloor"]);
    const settled = Boolean(ev["assessed"]) && !floor;
    const cie = Number(ev["cie"]).toFixed(1);
    lines.push([
      (row.course.code || "?").padEnd(10),
      String(ev["credits"] ?? "").padStart(2),
      String(ev["assessed"] ? `${floor ? ">=" : ""}${cie}/${ev["cieMax"]}` : "-").padStart(10),
      String(ev["attendance"] == null ? "-" : Math.round(Number(ev["attendance"]))).padStart(5),
      String(settled ? `${pass.bound ? ">=" : ""}${pass.shown.text}` : "-").padStart(10),
      String(settled ? `${target.bound ? ">=" : ""}${target.shown.text}` : "-").padStart(12),
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
  // A file from a LATER build may carry fields this one does not understand
  // and would silently drop on the next save, so it is refused outright rather
  // than half-read.
  const here = defaultState().version;
  const there = Number(parsed.version ?? 1);
  if (Number.isFinite(there) && there > here) {
    // Points at a mechanism that exists: TargetX checks for a new build a
    // couple of seconds after launch and offers it in a banner (see
    // `sync/update.ts`). Before that existed this message sent a student to a
    // door with nothing behind it.
    throw new Error(
      `That backup was written by a newer version of TargetX (file v${there}, ` +
      `this build reads v${here}). Restart TargetX and take the update it ` +
      `offers, then try again.`);
  }

  // A restore REPLACES the document; it does not merge into it. Building on
  // defaultState() and then dropping any key the incoming file does not define
  // is what makes that true: merging left every field the backup omitted -
  // history above all - sitting there from the session being replaced, and the
  // result was a hybrid that belonged to neither.
  //
  // A backup written before the registered/earned credit split, or before the
  // goal widened from a lone CGPA into the full target set, is the same old
  // shape arriving later - so both migrations run here exactly as they do on a
  // load. `normaliseTargets` is applied AFTER the spread: `defaultState()`
  // seeds a valid target set, but the incoming file's own `goal` overwrites it
  // and is the one that has to be migrated.
  edit((s) => {
    const next = { ...defaultState(), ...parsed,
                   history: migrateHistory(parsed.history),
                   goal: normaliseTargets(parsed.goal) };
    for (const key of Object.keys(s)) {
      if (!(key in next)) delete (s as unknown as Record<string, unknown>)[key];
    }
    Object.assign(s, next);
  });
}

export function resetEverything() {
  edit((s) => {
    s.semesters = { S1: { courses: [] } };
    s.history = {};
    s.activeSemester = "S1";
    s.goal = defaultTargets();
    s.onboarded = false;
    s.lastSync = undefined;
  });
}
