/**
 * etlab schedule parsers: day-wise attendance and the weekly timetable.
 *
 * These are the two pages the academic record does NOT carry - a grid of every
 * period a student sat, and the timetable that says what each period is meant
 * to be. Both are a bonus on top of a normal sync: useful, never load-bearing,
 * and never a reason a sync fails.
 *
 * Deliberately regex-only. `sync/etlab.ts` reaches for `DOMParser`, which the
 * browser hands it for free; these run in Node under vitest as well as in the
 * app, so they must not depend on a DOM. That is why the parsing below is a
 * pass over raw `<tr>`/`<td>` slices rather than a query over a tree - tolerant
 * of the whitespace etlab pours between every tag, and of a college that words
 * a heading differently, in the same spirit as `parseAcademics`.
 *
 * Kept pure and side-effect-free: html in, typed structure out, nothing else.
 */
import type {
  AttendanceStatus, DaywiseAttendance, DaywiseDay, DaywisePeriod,
  Timetable, TimetableDay, TimetablePeriod, TimetableSubstitution,
} from "../engine";

// --- html helpers ----------------------------------------------------------

/** The handful of entities etlab actually emits. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'");
}

/** Tags to spaces: use where two tags butt against separate words. */
function stripTagsSpace(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Tags to nothing: use for a label whose tags split ONE token, e.g. the day
 * cell `1<sup>st</sup>`, which must read "1st" and not "1 st".
 */
function stripTagsCompact(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/** Inner HTML of a single `<td>`/`<th>` slice. */
function cellInner(cell: string): string {
  return cell.replace(/^<t[dh][^>]*>/i, "").replace(/<\/t[dh]>\s*$/i, "");
}

const rowsOf = (html: string): string[] => html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
const cellsOf = (row: string): string[] => row.match(/<td[\s\S]*?<\/td>/gi) ?? [];

/** A table's tbody, or the whole table when it has no explicit tbody. */
function tbodyOf(table: string): string {
  const m = /<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(table);
  return m ? m[1]! : table;
}

// --- day-wise attendance ---------------------------------------------------

/**
 * td class -> status. The class carries the meaning; the text is only the
 * subject. "n-a" is a period with no class that day, which is not a miss and
 * not an absence, so it maps to "none". `onduty` and `od` are the same fact
 * under two spellings seen across deployments.
 */
const STATUS_MAP: Record<string, AttendanceStatus> = {
  present: "present",
  absent: "absent",
  "n-a": "none",
  na: "none",
  holiday: "holiday",
  dutyleave: "dutyleave",
  leave: "leave",
  od: "od",
  onduty: "od",
  duty: "duty",
};

function classToStatus(cls: string): AttendanceStatus {
  const tokens = cls.split(/\s+/).map((t) => t.toLowerCase()).filter((t) => t && t !== "span1");
  for (const t of tokens) if (t in STATUS_MAP) return STATUS_MAP[t]!;
  return "none";
}

/**
 * Subject text out of one attendance cell.
 *
 * The subject sits in the tool-tip anchor, immediately BEFORE the hover `<span>`
 * that carries the topic - so the text is cut at `<span` to keep the topic out
 * of the subject. An empty anchor (an "n-a" or holiday cell) yields null, which
 * is absence of a subject rather than an empty string.
 */
function attendanceSubject(cell: string): string | null {
  const anchor = /<a[^>]*>([\s\S]*?)(?:<span|<\/a>)/i.exec(cell);
  const raw = anchor ? anchor[1]! : cellInner(cell);
  return stripTagsSpace(raw) || null;
}

/** The attendance grid, by id when present, else the first period grid found. */
function selectAttendanceTable(html: string): string | null {
  const byId = /<table[^>]*id="itsthetable"[\s\S]*?<\/table>/i.exec(html);
  if (byId) return byId[0];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  return tables.find((t) => /Period\s*1/i.test(t) && /(span1|holiday|n-a)/i.test(t)) ?? null;
}

/**
 * Parse the day-wise attendance page into one entry per day.
 *
 * Each body row is a day: a `<th>` label (`1st`, `2nd`, ...) then its period
 * cells. A holiday row is a single `<td class="holiday" colspan="8">`, which is
 * expanded to eight holiday periods so every day has the same shape and the UI
 * grid never has to special-case a short row.
 */
export function parseDaywiseAttendance(html: string): DaywiseAttendance {
  const table = selectAttendanceTable(html);
  if (!table) return [];

  const days: DaywiseDay[] = [];
  for (const row of rowsOf(tbodyOf(table))) {
    const th = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(row);
    if (!th) continue;
    const label = stripTagsCompact(th[1]!);

    const periods: DaywisePeriod[] = [];
    for (const cell of cellsOf(row)) {
      const cls = /class="([^"]*)"/i.exec(cell)?.[1] ?? "";
      const status = classToStatus(cls);
      const span = Number(/colspan="?(\d+)"?/i.exec(cell)?.[1] ?? "1") || 1;
      // A colspanned holiday covers every period; its (empty) text is not a
      // per-period subject, so those cells carry none.
      const subject = span > 1 ? null : attendanceSubject(cell);
      for (let i = 0; i < span; i++) periods.push({ status, subject });
    }

    if (!periods.length) continue;
    days.push({ label, periods });
  }
  return days;
}

// --- weekly timetable ------------------------------------------------------

/** The main Day x Period grid: the one bordered table with the period header. */
function selectGridTable(html: string): string | null {
  const bordered = /<table[^>]*class="[^"]*table-bordered[^"]*"[\s\S]*?<\/table>/i.exec(html);
  if (bordered) return bordered[0];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  return tables.find((t) => /Period\s*1/i.test(t) && /Day/i.test(t)) ?? null;
}

/** The day name out of the first cell: text before the date `<small>`/`<br>`. */
function parseDayLabel(cell: string): string {
  const [head] = cellInner(cell).split(/<br\s*\/?>|<small/i);
  return stripTagsSpace(head ?? "");
}

/**
 * One timetable cell -> subject + teacher.
 *
 * The cell is subject, an optional `[ Theory ]`/`[ Practical ]` marker, then the
 * teacher, split by `<br>`. The marker line is dropped; the first surviving line
 * is the subject and the rest join as the teacher (some cells name two). An
 * elective or a free period is subject-only, so the teacher is null there, and
 * an empty cell (e.g. an honours slot) is null on both.
 */
function parseTimetableCell(cell: string): TimetablePeriod {
  const lines = cellInner(cell)
    .split(/<br\s*\/?>|<\/br>/i)
    .map(stripTagsSpace)
    .filter(Boolean)
    .filter((l) => !/^\[.*\]$/.test(l));
  if (!lines.length) return { subject: null, teacher: null };
  return {
    subject: lines[0]!,
    teacher: joinTeachers(lines.slice(1)),
  };
}

/**
 * Join the teacher line(s) of a cell into one clean string, or null.
 *
 * etlab's own data is dirty here in two ways seen on the live portal, and both
 * showed on screen verbatim before this: a teacher line arrives with a trailing
 * comma ("Ms. JISHA JAMES,"), so a plain `join(", ")` produced a double comma
 * ("JAMES,, Ms. ..."); and an honorific is sometimes glued onto the preceding
 * word with no space ("MENTORING HOURMs. JISHA JAMES"). Strip the stray
 * separators per line, then re-space a glued honorific. Nothing here invents a
 * name - it only undoes etlab's own run-together punctuation.
 */
function joinTeachers(lines: string[]): string | null {
  const parts = lines
    .map((l) => l.replace(/^[\s,;]+|[\s,;]+$/g, ""))
    .filter(Boolean);
  if (!parts.length) return null;
  return parts.join(", ")
    // A word run straight into an honorific: "HOURMs." -> "HOUR Ms."
    .replace(/([^\s])((?:Mrs?|Ms|Dr|Prof|Smt|Sri)\.)/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Substitutions out of the "Changes in timetable" grid.
 *
 * Columns are date, Teacher, In Place Of, Period. An empty grid renders one
 * `class="empty"` "No changes" row, which is skipped, so a week with no changes
 * yields an empty list rather than a bogus row.
 */
function parseSubstitutions(html: string): TimetableSubstitution[] {
  const subs: TimetableSubstitution[] = [];
  const at = html.search(/id="timetable-changes-grid"/i);
  if (at === -1) return subs;
  const table = /<table[\s\S]*?<\/table>/i.exec(html.slice(at))?.[0];
  if (!table) return subs;

  for (const row of rowsOf(tbodyOf(table))) {
    if (/class="empty"|No changes/i.test(row)) continue;
    const cells = cellsOf(row).map((c) => stripTagsSpace(cellInner(c)));
    if (cells.length < 4) continue;
    subs.push({
      date: cells[0] ?? "",
      teacher: cells[1] ?? "",
      inPlaceOf: cells[2] ?? "",
      period: cells[3] ?? "",
    });
  }
  return subs;
}

/** Parse the timetable page into a weekly grid plus any substitutions. */
export function parseTimetable(html: string): Timetable {
  const grid: TimetableDay[] = [];
  const table = selectGridTable(html);
  if (table) {
    for (const row of rowsOf(tbodyOf(table))) {
      const cells = cellsOf(row);
      if (cells.length < 2) continue;
      const day = parseDayLabel(cells[0]!);
      if (!day) continue;
      grid.push({ day, periods: cells.slice(1).map(parseTimetableCell) });
    }
  }
  return { grid, substitutions: parseSubstitutions(html) };
}
