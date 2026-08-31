import { courseLabel } from "./course";
import { toOptionalFloat } from "./util";
import type { Course, MarkInput, SemesterHistory } from "./types";

/**
 * What moved between two syncs.
 *
 * A sync replaces the whole record, so on its own it is silent: a student who
 * opens TargetX after a fortnight sees today's numbers with no way to tell
 * which of them is new. This is the diff that answers "what changed" - and it
 * is deliberately narrow. It reports only the four facts a student is waiting
 * on and can act on: a series mark posted, an attendance figure moved, a grade
 * published, a semester's SGPA finalised. It does NOT report derived quantities
 * (a CIE total, a projected grade), because those move as a consequence of the
 * four above and reporting both says the same news twice.
 *
 * Everything here is pure and works on plain records, so it is the same diff
 * whether the two sides come from a live sync, a restored backup, or a test.
 */

export type ChangeKind = "attendance" | "series" | "grade" | "sgpa";

/**
 * One fact that changed, phrased for a student, not for a table.
 *
 * `before` is null when the fact is new - a first series mark, a grade that had
 * not been published, a subject that was not on the record last time. That is a
 * different event from a mark that moved, and the UI says so ("posted" versus
 * "48% -> 61%"), which is why null is kept rather than rendered as "0".
 */
export interface Change {
  semester: string;
  /** The subject's display label (name, falling back to code) at sync time. */
  course: string;
  kind: ChangeKind;
  /** The specific field, already named for a student: "Series 1", "Grade". */
  field: string;
  before: string | null;
  after: string;
}

/** A snapshot of exactly what the diff reads - nothing more travels into it. */
export interface ChangeSide {
  semesters: Record<string, { courses: Course[] }>;
  history: Record<string, SemesterHistory>;
}

/** Below this two marks or percentages are the same number, not a change. */
const EPS = 0.005;

/** A percentage/mark field, formatted the way the ledger shows it, or null. */
const num = (v: MarkInput, suffix = ""): string | null => {
  const n = toOptionalFloat(v);
  return n === null ? null : `${Math.round(n)}${suffix}`;
};

/** Whether two optional numbers differ by enough to be a real change. */
const moved = (a: MarkInput, b: MarkInput): boolean => {
  const x = toOptionalFloat(a);
  const y = toOptionalFloat(b);
  if (x === null && y === null) return false;
  if (x === null || y === null) return true;
  return Math.abs(x - y) >= EPS;
};

/** A grade string, trimmed to null when absent, so "" and null read alike. */
const grade = (g: string | null | undefined): string | null => {
  const t = (g || "").trim();
  return t || null;
};

/** The three CIE component fields, each with the name a student would use. */
const SERIES: Array<{ key: "s1" | "s2" | "other"; field: string }> = [
  { key: "s1", field: "Series 1" },
  { key: "s2", field: "Series 2" },
  { key: "other", field: "Other mark" },
];

/**
 * Every fact that moved from `before` to `after`, newest-relevant first.
 *
 * Courses are matched by code within a semester, the same key sync itself
 * merges on. A subject with no match in `before` is new, and its filled fields
 * are reported as posts (before null) rather than as changes from zero. A
 * subject that vanished is NOT reported: a portal dropping a row is far more
 * often a transient scrape gap than a real withdrawal, and crying "removed" on
 * a flaky sync would train the student to ignore the panel.
 */
export function diffSync(before: ChangeSide, after: ChangeSide): Change[] {
  const out: Change[] = [];

  for (const [semester, sem] of Object.entries(after.semesters)) {
    const prior = before.semesters[semester]?.courses ?? [];
    const byCode = new Map(prior.map((c) => [(c.code || "").toUpperCase(), c]));

    for (const course of sem.courses) {
      const label = courseLabel(course);
      const was = byCode.get((course.code || "").toUpperCase());

      // Attendance percentage.
      if (moved(was?.attendance, course.attendance)) {
        out.push({
          semester, course: label, kind: "attendance", field: "Attendance",
          before: was ? num(was.attendance, "%") : null,
          after: num(course.attendance, "%") ?? "-",
        });
      }

      // Series and other CIE components.
      for (const { key, field } of SERIES) {
        if (moved(was?.[key], course[key])) {
          out.push({
            semester, course: label, kind: "series", field,
            before: was ? num(was[key]) : null,
            after: num(course[key]) ?? "-",
          });
        }
      }

      // Published grade.
      const gBefore = grade(was?.portal_grade);
      const gAfter = grade(course.portal_grade);
      if (gAfter !== null && gAfter !== gBefore) {
        out.push({
          semester, course: label, kind: "grade", field: "Grade",
          before: gBefore, after: gAfter,
        });
      }
    }
  }

  // Published SGPA per semester. Read from the merged history, so a lower-trust
  // scrape that precedence rejected does not register as a change - what the
  // student sees moving is only what actually won a place in the record.
  for (const [semester, h] of Object.entries(after.history)) {
    const was = before.history[semester];
    if (moved(was?.sgpa, h.sgpa)) {
      out.push({
        semester, course: semester, kind: "sgpa", field: "SGPA",
        before: was ? was.sgpa.toFixed(2) : null,
        after: h.sgpa.toFixed(2),
      });
    }
  }

  return out;
}
