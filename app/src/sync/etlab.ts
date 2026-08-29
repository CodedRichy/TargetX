/**
 * etlab client.
 *
 * A port of etlab_sync.py. Transport is a Rust command (cookie jar, redirects,
 * no CORS); everything here is parsing and flow, which is where the knowledge
 * about what an etlab page means lives.
 *
 * Every non-obvious line below was learned by probing a live portal. The
 * comments say which, because the next college will differ and the difference
 * has to be debuggable.
 */
import { invoke } from "@tauri-apps/api/core";
import { CODE_RE } from "../engine/parse";
import {
  COURSE_TYPES, blankCourse, inferCredits, isIncomplete, lookupCourse,
  normaliseGrade, toFloat, verifyCredits,
} from "../engine";
import type { Course, SemesterHistory, TypeKey } from "../engine";

export class EtlabError extends Error {}

interface Fetched { url: string; status: number; body: string }

/** True when running inside the desktop shell; sync cannot work in a browser. */
export const canSync = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const LOGIN_PATHS = ["/user/login", "/site/login", "/index.php/user/login", "/login", "/"];
const ACADEMICS_PATHS = ["/ktuacademics/student/studentacademics", "/student/results"];
const SUBJECT_PATHS = ["/student/subject"];

/** A page still calling itself a login page has not authenticated anyone. */
export const LOGIN_TITLE_RE = /\b(log\s?in|sign\s?in|logon)\b/i;

/** Names a real username box carries. A captcha input matches none of them. */
export const USER_FIELD_RE = /(user|login|admn|admission|reg|roll|uid|email|student)/i;

// --- URL -------------------------------------------------------------------

/**
 * Students copy the URL out of the address bar, so it usually arrives as the
 * login page itself. Keeping that path would make every later request
 * /user/login/user/login.
 */
export function normaliseBase(raw: string, allowInsecure = false): string {
  let url = (raw || "").trim();
  if (!url) throw new EtlabError("College portal URL is empty.");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EtlabError(`Cannot read a hostname out of "${raw}".`);
  }

  // The scheme is necessarily http: or https: by the test above, so there is
  // nothing else to reject here.
  //
  // The student's portal password is POSTed to this origin. Plain http puts it
  // on the wire in cleartext across campus wifi, so an explicit http:// is
  // UPGRADED rather than honoured. Only a deliberate confirmation keeps it.
  const protocol = allowInsecure ? parsed.protocol : "https:";

  let path = parsed.pathname.replace(/\/+$/, "");
  for (const suffix of ["/user/login", "/site/login", "/login", "/index.php",
                        "/user/logout", "/site/logout"]) {
    if (path.toLowerCase().endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }
  return `${protocol}//${parsed.host}${path.replace(/\/+$/, "")}`;
}

// --- transport -------------------------------------------------------------

const get = (path: string) => invoke<Fetched>("etlab_get", { path });
const post = (url: string, fields: Array<[string, string]>) =>
  invoke<Fetched>("etlab_post", { url, fields });

export const startSession = (base: string) => invoke<void>("etlab_start", { base });
export const endSession = () => invoke<void>("etlab_reset");
export const sessionActive = () => invoke<boolean>("etlab_active");

// --- HTML helpers ----------------------------------------------------------

const parseHtml = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

/**
 * Cells belonging to this row only.
 *
 * Direct children matter: etlab nests a detail table inside a row, and a
 * recursive search pulls every child row's text into its parent, so one
 * subject appears to carry the whole table.
 */
function rowCells(tr: Element): string[] {
  return Array.from(tr.children)
    .filter((c) => c.tagName === "TD" || c.tagName === "TH")
    .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const rowLine = (tr: Element) => rowCells(tr).join("  ");

// --- academic record -------------------------------------------------------

const ROMAN_SEM: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8,
};
const SEM_HEADER_RE = /\b(I|II|III|IV|V|VI|VII|VIII)(?:st|nd|rd|th)\s+Semester/i;
const ATT_RE = /(\d+)\s*\/\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%\)/;
const FIELD_RE =
  /SGPA\s*:\s*(?<sgpa>[\d.]+|-)[\s\S]*?Earned Credit\s*:\s*(?<earned>[\d.]+|-)[\s\S]*?Cumulative Credit\s*:\s*(?<cumulative>[\d.]+|-)[\s\S]*?CGPA\s*:\s*(?<cgpa>[\d.]+|-)/i;
const SERIES_RE = /Series\s*Exam\s*(\d+)/i;
const SERIES_RE_G = /Series\s*Exam\s*(\d+)/gi;
const MARK_RE_G = /(-|\d+(?:\.\d+)?)\s*\/\s*(\d+)/g;

/** "-" and "" mean not published yet, which is not the same as zero. */
function num(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  if (t === "" || t === "-" || t === "--" || t.toUpperCase() === "N/A") return null;
  const value = Number(t);
  return Number.isFinite(value) ? value : null;
}

export interface SeriesExam { exam: number; mark: number | null; max: number }

/**
 * Pull every "Series Exam N ... 22.5/40" out of one detail row.
 *
 * The row holds all of a subject's exams end to end, so it is split at each
 * "Series Exam N" and the FIRST mark pair inside each slice is taken - the
 * second pair on the line is the class average, not the student's mark.
 */
function parseSeries(line: string): SeriesExam[] {
  const hits = Array.from(line.matchAll(SERIES_RE_G));
  const series: SeriesExam[] = [];
  hits.forEach((hit, index) => {
    const from = hit.index! + hit[0].length;
    const to = index + 1 < hits.length ? hits[index + 1]!.index! : line.length;
    const marks = Array.from(line.slice(from, to).matchAll(MARK_RE_G));
    if (!marks.length) return;
    const [, scored, outOf] = marks[0]!;
    series.push({ exam: Number(hit[1]), mark: num(scored), max: num(outOf) ?? 40 });
  });
  return series.sort((a, b) => a.exam - b.exam);
}

export interface PortalCourse {
  code: string; name: string;
  attended: number | null; held: number | null; attendance: number | null;
  internal: number | null; grade: string | null; result: string | null;
  gpa: number | null; series: SeriesExam[];
}

export interface PortalSemester {
  label?: string;
  courses: PortalCourse[];
  attended?: number | null; held?: number | null; attendance?: number | null;
  sgpa?: number | null; earnedCredits?: number | null;
  cumulativeCredits?: number | null; cgpa?: number | null;
}

export interface Academics {
  semesters: Record<number, PortalSemester>;
  current: number | null;
}

/**
 * Parse the etlab academic record: every semester, every subject.
 *
 * This one page carries the whole picture - past grades and SGPA/CGPA plus the
 * current semester's attendance and series marks - which is why it is the
 * primary sync source rather than the internals page other deployments expose.
 *
 * Layout: a one-row summary strip per semester, then that semester's subject
 * table, with series exams either nested inside a subject row or in a sibling
 * detail row that follows it. Both shapes appear in the wild.
 */
export function parseAcademics(html: string): Academics {
  const doc = parseHtml(html);
  const semesters: Record<number, PortalSemester> = {};
  let pending: number | null = null;

  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const rows = Array.from(table.querySelectorAll("tr"));
    if (!rows.length) continue;

    const flat = rowCells(rows[0]!).join(" ");
    const header = SEM_HEADER_RE.exec(flat);

    // Case 1: the per-semester summary strip.
    if (header && flat.toUpperCase().includes("SGPA")) {
      const number = ROMAN_SEM[header[1]!.toUpperCase()]!;
      const att = ATT_RE.exec(flat);
      const fields = FIELD_RE.exec(flat);
      const entry = (semesters[number] ??= { courses: [] });
      entry.label = `S${number}`;
      entry.attended = att ? num(att[1]) : null;
      entry.held = att ? num(att[2]) : null;
      entry.attendance = att ? num(att[3]) : null;
      if (fields?.groups) {
        entry.sgpa = num(fields.groups["sgpa"]);
        entry.earnedCredits = num(fields.groups["earned"]);
        entry.cumulativeCredits = num(fields.groups["cumulative"]);
        entry.cgpa = num(fields.groups["cgpa"]);
      }
      pending = number;
      continue;
    }

    // Case 2: a subject table - belongs to the last summary strip seen.
    const head = rowCells(rows[0]!).join(" ").toUpperCase();
    if (!head.includes("SUBJECT") || !head.includes("GRADE")) continue;
    if (pending === null) continue;

    const entry = (semesters[pending] ??= { courses: [] });
    for (const tr of rows.slice(1)) {
      const cells = rowCells(tr);
      if (!cells.length) continue;
      const line = cells.join("  ");
      const codeMatch = CODE_RE.exec(line);
      const attMatch = ATT_RE.exec(line);

      // Series marks can arrive in a detail row that FOLLOWS its subject row
      // rather than sitting inside it, so they attach backwards.
      if (SERIES_RE.test(line) && entry.courses.length) {
        entry.courses[entry.courses.length - 1]!.series = parseSeries(line);
        continue;
      }
      // A subject row with no attendance cell is still a subject.
      //
      // It used to be dropped, and `applySync` then REPLACED the semester with
      // whatever had survived - so a course the portal had not yet posted
      // attendance for vanished from the record, taking its credits out of the
      // SGPA denominator with it. Nothing on screen said a row had gone
      // missing. Parsing it with an unknown attendance keeps the semester
      // whole, and unknown is a state the engine already handles: it shows a
      // dash and withholds the grade rather than inventing a number.
      if (!codeMatch) continue;

      const code = codeMatch[1]!;
      const nameEnd = attMatch ? attMatch.index : line.length;
      const name = line
        .slice(codeMatch.index + codeMatch[0].length, nameEnd)
        .replace(/^[\s\-⬆⬇⯆⯅]+|[\s\-⬆⬇⯆⯅]+$/g, "")
        .trim();

      const tail = attMatch
        ? line.slice(attMatch.index + attMatch[0].length).trim().split(/\s+/)
        : [];
      const internal = tail.length > 0 ? num(tail[0]) : null;
      const grade = tail.length > 1 && tail[1] !== "-" ? tail[1]! : null;
      const result = tail.length > 2 ? tail[2]! : null;
      const gpa = tail.length > 4 ? num(tail[4]) : null;

      // The nested shape, for deployments that use it.
      const series: SeriesExam[] = [];
      for (const nestedRow of Array.from(tr.querySelectorAll("table tr"))) {
        const nestedLine = rowLine(nestedRow);
        const exam = SERIES_RE.exec(nestedLine);
        if (!exam) continue;
        const marks = Array.from(nestedLine.matchAll(MARK_RE_G));
        if (!marks.length) continue;
        const [, scored, outOf] = marks[0]!;
        series.push({ exam: Number(exam[1]), mark: num(scored), max: num(outOf) ?? 40 });
      }

      entry.courses.push({
        code, name,
        attended: attMatch ? num(attMatch[1]) : null,
        held: attMatch ? num(attMatch[2]) : null,
        attendance: attMatch ? num(attMatch[3]) : null,
        internal, grade, result, gpa,
        series: series.sort((a, b) => a.exam - b.exam),
      });
    }
  }

  let current: number | null = null;
  for (const key of Object.keys(semesters).map(Number).sort((a, b) => a - b)) {
    if (semesters[key]!.courses.length) current = key;
  }
  return { semesters, current };
}

/**
 * Map course code -> Theory / Practical from /student/subject.
 *
 * Worth a second request: it decides whether a course is scored 40/60 or
 * 75/25, and guessing that from the code letters is only a heuristic.
 */
export function parseSubjectTypes(html: string): Record<string, TypeKey> {
  const doc = parseHtml(html);
  const types: Record<string, TypeKey> = {};
  for (const tr of Array.from(doc.querySelectorAll("table tr"))) {
    const cells = rowCells(tr);
    if (cells.length < 3) continue;
    const line = cells.join("  ");
    const code = CODE_RE.exec(line);
    if (!code) continue;
    const lowered = line.toLowerCase();
    if (lowered.includes("practical") || lowered.includes(" lab")) {
      types[code[1]!] = "LAB 75/25";
    } else if (lowered.includes("theory") || lowered.includes("elective")) {
      types[code[1]!] = "TH 40/60";
    }
  }
  return types;
}

// --- login -----------------------------------------------------------------

/** The password box's name, or null when the form has none. */
function passwordFieldName(form: HTMLFormElement): string | null {
  for (const input of Array.from(form.querySelectorAll("input"))) {
    const name = input.getAttribute("name");
    if (!name) continue;
    if ((input.getAttribute("type") || "").toLowerCase() === "password") return name;
  }
  return null;
}

/**
 * The username box's name, matched on the NAME rather than the input type.
 *
 * Type alone is not enough. A session-expired stub carries a password box plus
 * a captcha text input; by type that scores as a real login form and the
 * captcha then gets bound as the username, sending the register number into a
 * field the portal never reads. The name is what tells them apart.
 *
 * Yii wraps fields as LoginForm[username], so this matches on a substring.
 */
function usernameFieldName(form: HTMLFormElement): string | null {
  for (const input of Array.from(form.querySelectorAll("input"))) {
    const name = input.getAttribute("name");
    if (!name) continue;
    const type = (input.getAttribute("type") || "text").toLowerCase();
    if (type !== "text" && type !== "email") continue;
    if (USER_FIELD_RE.test(name)) return name;
  }
  return null;
}

/** 2 = a form with both fields identified by name. 0 = do not post to it. */
function scoreForm(form: HTMLFormElement): number {
  return usernameFieldName(form) && passwordFieldName(form) ? 2 : 0;
}

/**
 * Names to post under. Strict on purpose: guessing wrong here means putting a
 * real password somewhere it was not meant to go, and failing with a readable
 * error is the better trade. The candidates are listed in the message because
 * the next college is where this will need debugging.
 */
function fieldNames(form: HTMLFormElement): [string, string] {
  const user = usernameFieldName(form);
  const pass = passwordFieldName(form);
  if (!user || !pass) {
    const seen = Array.from(form.querySelectorAll("input"))
      .map((i) => i.getAttribute("name")).filter(Boolean).join(", ");
    throw new EtlabError(
      `Could not identify the username and password fields on the login form. ` +
      `Fields seen: ${seen || "none"}. Use paste import instead.`);
  }
  return [user, pass];
}

/**
 * Find the login form across the candidate paths.
 *
 * Two rules the previous version did not enforce, both about where a password
 * is allowed to go:
 *   - a form that does not identify BOTH fields is never posted to, so the
 *     password-only stub this function was always meant to reject is now
 *     actually rejected rather than kept as a fallback;
 *   - the form's action must be same-origin with the page it was read from. An
 *     injected or third-party action would otherwise receive the credentials.
 */
async function findLoginForm(): Promise<{ action: string; form: HTMLFormElement }> {
  const errors: string[] = [];

  for (const path of LOGIN_PATHS) {
    let response: Fetched;
    try {
      response = await get(path);
    } catch (exc) {
      errors.push(`${path}: ${String(exc)}`);
      continue;
    }
    if (response.status >= 400) {
      errors.push(`${path}: HTTP ${response.status}`);
      continue;
    }
    const doc = parseHtml(response.body);
    const landed = new URL(response.url);
    let found = false;
    for (const form of Array.from(doc.querySelectorAll("form"))) {
      if (scoreForm(form) < 2) continue;
      found = true;
      // Relative actions resolve against the URL landed on, not requested.
      const action = new URL(form.getAttribute("action") || response.url, response.url);
      // `origin` covers scheme, host and port, so this rejects an off-site
      // action and an https -> http downgrade in the same test.
      if (action.origin !== landed.origin) {
        errors.push(`${path}: form posts to ${action.origin}, not ${landed.origin}`);
        continue;
      }
      return { action: action.toString(), form };
    }
    errors.push(`${path}: ${found ? "no same-origin login form" : "no login form"}`);
  }
  throw new EtlabError(`No login form found. Tried: ${errors.join("; ")}`);
}

/**
 * Did the POST actually authenticate?
 *
 * Negative signals only, both read off the parsed DOM rather than the raw
 * HTML. etlab re-renders the login page on a bounced login and its <title>
 * still says so; rit-etlab-api relies on the same tell against a different
 * college's deployment, which is the only cross-college evidence available.
 *
 * What this replaces: a substring test that returned TRUE on "logout" appearing
 * anywhere in the document - a cached nav link or a script filename was enough
 * to report a failed login as a success - and that looked for exactly two
 * spellings of type="password", so any other attribute order read as signed in.
 */
function looksLoggedIn(html: string): boolean {
  const doc = parseHtml(html);
  if (LOGIN_TITLE_RE.test(doc.title || "")) return false;
  if (doc.querySelector('input[type="password"]')) return false;
  return true;
}

export async function login(base: string, username: string, password: string): Promise<void> {
  if (!username || !password) {
    throw new EtlabError("Username and password are both required.");
  }
  await startSession(normaliseBase(base));

  const { action, form } = await findLoginForm();
  const [userField, passField] = fieldNames(form);

  // Every hidden input, verbatim - this covers YII_CSRF_TOKEN, _csrf,
  // rememberMe, returnUrl and whatever the next version invents.
  const fields: Array<[string, string]> = [];
  for (const input of Array.from(form.querySelectorAll("input"))) {
    const name = input.getAttribute("name");
    if (name && (input.getAttribute("type") || "").toLowerCase() === "hidden") {
      fields.push([name, input.getAttribute("value") ?? ""]);
    }
  }
  fields.push([userField, username], [passField, password]);

  const response = await post(action, fields);
  if (response.status >= 400) {
    throw new EtlabError(`Login returned HTTP ${response.status}.`);
  }
  if (!looksLoggedIn(response.body)) {
    if (response.body.toLowerCase().includes("captcha")) {
      throw new EtlabError(
        "This portal shows a captcha. Automated sync cannot pass it - use the paste import instead.");
    }
    throw new EtlabError("Login rejected. Check the username and password.");
  }
}

// --- fetching --------------------------------------------------------------

/**
 * Read the real routes off the dashboard instead of guessing them.
 *
 * Guessed paths were wrong on the first real portal tested - the internals
 * route 404'd on all six candidates while the dashboard linked it plainly.
 */
export async function discoverLinks(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  let response: Fetched;
  try {
    response = await get("/");
  } catch {
    return found;
  }
  for (const anchor of Array.from(parseHtml(response.body).querySelectorAll("a"))) {
    const href = anchor.getAttribute("href") || "";
    if (!href.startsWith("/")) continue;
    const lowered = href.toLowerCase();
    if (lowered.includes("academic")) found["academics"] ??= href;
    else if (lowered.endsWith("/student/subject")) found["subjects"] ??= href;
    else if (lowered.includes("result")) found["results"] ??= href;
  }
  return found;
}

export async function fetchAcademics(): Promise<Academics> {
  const links = await discoverLinks();
  const paths = [...(links["academics"] ? [links["academics"]] : []), ...ACADEMICS_PATHS];
  const tried: string[] = [];
  for (const path of paths) {
    let response: Fetched;
    try {
      response = await get(path);
    } catch (exc) {
      tried.push(`${path}: ${String(exc)}`);
      continue;
    }
    if (response.status >= 400) {
      tried.push(`${path}: HTTP ${response.status}`);
      continue;
    }
    const parsed = parseAcademics(response.body);
    // Semesters without a single course is what a college whose subject tables
    // use different headers looks like: the summary strip parses, the subject
    // rows do not. That used to be reported as a successful sync, with a
    // written timestamp and no data - the worst possible answer, because it
    // tells the student to stop looking. It is a failure, and it says so.
    const courses = Object.values(parsed.semesters)
      .reduce((total, semester) => total + semester.courses.length, 0);
    if (courses > 0) return parsed;
    tried.push(Object.keys(parsed.semesters).length
      ? `${path}: semester headings, but no subject rows this parser could read`
      : `${path}: no semester tables`);
  }
  throw new EtlabError(`Could not read the academic record. Tried: ${tried.join("; ")}`);
}

export async function fetchSubjectTypes(): Promise<Record<string, TypeKey>> {
  for (const path of SUBJECT_PATHS) {
    try {
      const response = await get(path);
      if (response.status < 400) {
        const types = parseSubjectTypes(response.body);
        if (Object.keys(types).length) return types;
      }
    } catch { /* this page is optional; the record above is the real source */ }
  }
  return {};
}

// --- mapping onto app state -------------------------------------------------

const inferType = (code: string): TypeKey => {
  const letters = /^([A-Z]+)/.exec((code || "").toUpperCase())?.[1] ?? "";
  return letters.endsWith("L") ? "LAB 75/25" : "TH 40/60";
};

/**
 * A published internal above the pattern's CIE ceiling means the PATTERN is
 * wrong, not the mark. Colleges run 40- and 50-mark internals side by side, so
 * fit the pattern to the evidence rather than clamping a real score down.
 */
function fitType(typeKey: TypeKey, internal: number | null): TypeKey {
  if (internal === null) return typeKey;
  if (internal <= COURSE_TYPES[typeKey].cieMax) return typeKey;
  for (const candidate of ["TH 50/50", "LAB 75/25", "PRJ 100/0"] as TypeKey[]) {
    if (internal <= COURSE_TYPES[candidate].cieMax) return candidate;
  }
  return typeKey;
}

export interface SyncResult {
  semesters: Record<string, { courses: Course[]; creditCheck: ReturnType<typeof verifyCredits> }>;
  history: Record<string, SemesterHistory>;
  current: string | null;
}

/**
 * Turn a parsed portal record into TargetX semesters plus locked history.
 *
 * Rules that matter for correctness:
 *   - The portal's published internal total becomes cie_override, so the CIE
 *     shown always matches the college's own figure.
 *   - Series maxima come from the page (40 here, 50 elsewhere) rather than
 *     being assumed.
 *   - Credits are NOT published per course, only per semester, so they are
 *     seeded and then checked against the published total. A wrong credit
 *     silently corrupts SGPA, so it must not look settled.
 *   - Only semesters the portal marks with an SGPA get locked into history.
 *     An in-progress semester stays editable.
 */
export function academicsToState(
  academics: Academics, types: Record<string, TypeKey> = {},
): SyncResult {
  const semesters: SyncResult["semesters"] = {};
  const history: SyncResult["history"] = {};

  for (const [key, entry] of Object.entries(academics.semesters)) {
    const name = `S${key}`;
    const courses: Course[] = [];
    // Whether every course whose credits the semester total actually uses got
    // them from the published curriculum. One that did not means the total is
    // a guess. A course graded I or W is not one of them - its credits are not
    // an input to the sum below, so not knowing them cannot make the sum
    // wrong, and refusing the total over it would send `historyCredits` down
    // its `??` chain - to the EARNED total, a different set of courses, or
    // to 0 when there is no earned total either.
    let allCreditsListed = true;

    for (const item of entry.courses) {
      // The published curriculum is the authority on the CIA/ESE split; the
      // portal's Theory/Practical label is only a hint.
      const listed = lookupCourse(item.code);
      const incomplete = isIncomplete(normaliseGrade(item.grade));
      if (!listed?.credits && !incomplete) allCreditsListed = false;
      let typeKey = (listed?.type ?? types[item.code] ?? inferType(item.code)) as TypeKey;
      typeKey = fitType(typeKey, item.internal);

      const course = blankCourse(item.code, item.name || listed?.name || "",
                                 inferCredits(item.code), typeKey);
      if (item.attendance !== null) course.attendance = item.attendance;
      // Raw counts, not just the percentage: they are what makes
      // "you can skip 2 more" answerable at all.
      if (item.attended !== null) course.attended = item.attended;
      if (item.held !== null) course.held = item.held;
      if (item.internal !== null) course.cie_override = item.internal;

      (["s1", "s2"] as const).forEach((slot, i) => {
        const exam = item.series[i];
        if (exam && exam.mark !== null) {
          course[slot] = exam.mark;
          course[`${slot}_max`] = exam.max || 40;
        }
      });
      course.portal_grade = item.grade || "";

      courses.push(course);
    }

    if (!courses.length) continue;
    // Check the seeded credits against the published semester total, so a bad
    // inference is visible immediately instead of after results.
    semesters[name] = { courses, creditCheck: verifyCredits(courses, entry.earnedCredits) };

    if (entry.sgpa) {
      history[name] = {
        sgpa: entry.sgpa,
        // The portal publishes an earned total and nothing else, so a
        // registered total can only be added up from the courses. That is
        // only worth storing as fact when every one of them was priced by the
        // published curriculum: `inferCredits` never fails, it falls through
        // to 4, so a guessed total is indistinguishable from a known one once
        // it is a number. Nothing published can confirm this sum either -
        // `creditCheck` above compares it against the EARNED total, which a
        // semester with a backlog is supposed to differ from - so where any
        // course was priced by inference the total stays unknown and
        // `cgpaFromSemesters` reports the semester as unconfirmed rather than
        // weighting the CGPA by a guess.
        //
        // A course graded I or W is left out of the sum. `entry.sgpa` stored
        // beside it is the portal's own SGPA, computed without that course, so
        // keeping its credits here would weigh the semester by a set of
        // courses its SGPA never covered - and hand the withdrawn credits the
        // student's own average. An F stays: it is a result, and its credits
        // are in the denominator KTU used.
        creditsRegistered: allCreditsListed
          ? courses.reduce((sum, c) => (
              isIncomplete(normaliseGrade(c.portal_grade)) ? sum
                : sum + toFloat(c.credits, 0)), 0)
          : null,
        // A missing published total is unknown, not zero.
        creditsEarned: entry.earnedCredits ?? null,
      };
    }
  }

  return {
    semesters, history,
    current: academics.current ? `S${academics.current}` : null,
  };
}

/** Sign in and pull everything in one call. */
export async function fullSync(
  base: string, username: string, password: string,
): Promise<SyncResult> {
  await login(base, username, password);
  const academics = await fetchAcademics();
  const types = await fetchSubjectTypes();
  return academicsToState(academics, types);
}
