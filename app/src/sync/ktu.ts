/**
 * KTU live grade-card client.
 *
 * The university's own result portal (app.ktu.edu.in) is the authoritative
 * source for published grades - the whole point of issue #5, where a student
 * watched the college etlab scrape disagree with it. This signs in, pulls every
 * published semester's grade card, and hands back the SAME text a student would
 * paste, so the already-audited `parseGradeCard` + `applyGradeCard` path does
 * the rest. That reuse is deliberate: the grade-card parser's column model, its
 * printed-vs-recomputed SGPA check, and the `source: "gradecard"` precedence
 * that outranks etlab all come for free, and the live path cannot drift from the
 * paste path because it IS the paste path.
 *
 * Transport is the native `ktu_*` Rust commands (own cookie jar, follows the
 * login redirect chain, no CORS) - a mirror of the etlab transport, because a
 * webview `fetch` to a different origin cannot carry the session cookie or the
 * redirect chain that login is.
 *
 * The endpoints and the exact form fields below were learned by driving the
 * live portal. The grade card is NOT AJAX: submitting the semester search form
 * returns a fully server-rendered results table, which is why plain GET/POST is
 * enough and no browser automation ships in the app.
 */
import { invoke } from "@tauri-apps/api/core";

const KTU_BASE = "https://app.ktu.edu.in";
const LOGIN_PATH = "/login.htm";
const LISTING_PATH = "/eu/res/semesterGradeCardListing.htm";

/** The hidden form the semester search posts under. Learned from the portal. */
const SEARCH_FORM = "semesterGradeCardListingSearchForm";

/** KTU numbers semesters 1..8 in the select; a card exists only once published. */
const SEMESTER_IDS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export class KtuError extends Error {}

interface Fetched { url: string; status: number; body: string }

/** True inside the desktop shell; the native transport is unavailable in a browser. */
export const canSyncKtu = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// --- transport -------------------------------------------------------------

const get = (path: string) => invoke<Fetched>("ktu_get", { path });
const post = (url: string, fields: Array<[string, string]>) =>
  invoke<Fetched>("ktu_post", { url, fields });

export const startKtuSession = () => invoke<void>("ktu_start", { base: KTU_BASE });
export const endKtuSession = () => invoke<void>("ktu_reset");
export const ktuSessionActive = () => invoke<boolean>("ktu_active");

// --- HTML helpers ----------------------------------------------------------

const parseHtml = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

/** Direct-child cells of a row, whitespace-collapsed. Mirrors the etlab reader. */
function rowCells(tr: Element): string[] {
  return Array.from(tr.children)
    .filter((c) => c.tagName === "TD" || c.tagName === "TH")
    .map((c) => (c.textContent ?? "").replace(/\s+/g, " ").trim());
}

/**
 * The session's CSRF token, off any of the hidden inputs that carry it.
 *
 * Every form on a KTU page repeats the same session token, so the first one is
 * as good as the form-specific one - and taking whichever is present avoids
 * depending on a particular form having rendered.
 */
function csrfToken(html: string): string | null {
  const doc = parseHtml(html);
  const input = doc.querySelector('input[name="CSRF_TOKEN"]');
  return input?.getAttribute("value") ?? null;
}

/** A page still showing a password box has not authenticated anyone. */
function looksLoggedIn(html: string): boolean {
  return !parseHtml(html).querySelector('input[type="password"]');
}

// --- login -----------------------------------------------------------------

export async function loginKtu(username: string, password: string): Promise<void> {
  if (!username || !password) {
    throw new KtuError("Register number and password are both required.");
  }
  await startKtuSession();

  const page = await get(LOGIN_PATH);
  if (page.status >= 400) {
    throw new KtuError(`The KTU portal returned HTTP ${page.status} for its login page.`);
  }
  const token = csrfToken(page.body);
  if (!token) {
    throw new KtuError("Could not read the KTU login form's security token.");
  }

  // The portal's login form: a CSRF hidden field plus username/password. The
  // token is posted verbatim; guessing field names is not needed here the way
  // it is for etlab, because this is one known portal, not many colleges.
  const response = await post(LOGIN_PATH, [
    ["CSRF_TOKEN", token],
    ["username", username],
    ["password", password],
  ]);
  if (response.status >= 400) {
    throw new KtuError(`KTU login returned HTTP ${response.status}.`);
  }
  // A bounced login re-renders the login page, password box and all, at the
  // same URL; a good one has been redirected to the dashboard by the time the
  // transport returns. The password box is the reliable tell either way.
  if (!looksLoggedIn(response.body)) {
    throw new KtuError("KTU login rejected. Check the register number and password.");
  }
}

// --- grade cards -----------------------------------------------------------

/**
 * The card table on a search result, as [code, name, credits, grade] rows plus
 * the printed SGPA - or null when this semester has no published card.
 *
 * The live table's columns are Course Name | Code | Grade | Credits Earned |
 * Month & Year, which is a different order from the paste format; reading them
 * by position here is what lets the canonical text below be emitted in the
 * order `parseGradeCard` expects. A semester the university has not published
 * yet answers with no such table (only an anti-ragging prompt), which is why a
 * missing card is null rather than an error.
 */
export interface CardRow { code: string; name: string; credits: string; grade: string }
export interface ParsedCard { rows: CardRow[]; sgpa: string | null }

export function parseCardTable(html: string): ParsedCard | null {
  const doc = parseHtml(html);
  for (const table of Array.from(doc.querySelectorAll("table"))) {
    const trs = Array.from(table.querySelectorAll("tr"));
    if (!trs.length) continue;
    const header = rowCells(trs[0]!).join(" | ").toLowerCase();
    if (!header.includes("course name") || !header.includes("grade")) continue;

    const rows: CardRow[] = [];
    let sgpa: string | null = null;
    for (const tr of trs.slice(1)) {
      const cells = rowCells(tr);
      // A footer row is a label in the first cell and a number in the second:
      // SGPA is the one we keep, the Totals ride along unused.
      if (cells.length >= 2 && /^SGPA$/i.test(cells[0] ?? "")) {
        sgpa = cells[1] ?? null;
        continue;
      }
      // A course row is Name | Code | Grade | Credits | Month&Year. Anything
      // shorter (a totals or note row) is not a course.
      if (cells.length < 4) continue;
      const [name, code, grade, credits] = cells;
      if (!code || !grade) continue;
      rows.push({ name: name ?? "", code, grade, credits: credits ?? "" });
    }
    if (rows.length) return { rows, sgpa };
  }
  return null;
}

/**
 * Emit one semester as the canonical grade-card text `parseGradeCard` reads.
 *
 * Format per the parser's column model: a bare `SEMESTER n` heading switches
 * context, then each course is `CODE  Name  Credits  Grade` - credits before
 * grade, because the parser anchors on the credits column and takes the first
 * grade token after it. The grade cell is emitted VERBATIM: a real `P` (5.5) is
 * a grade and must score, while an audit `PASS` is not a token the parser knows
 * and is dropped - which is correct, because KTU leaves audit courses out of
 * the SGPA the printed figure below is checked against.
 */
export function toCanonicalText(semester: string, card: ParsedCard): string {
  const lines = [`SEMESTER ${semester}`];
  for (const r of card.rows) {
    lines.push(`${r.code}  ${r.name}  ${r.credits}  ${r.grade}`.replace(/\s+/g, " ").trim());
  }
  if (card.sgpa) lines.push(`SGPA: ${card.sgpa}`);
  return lines.join("\n");
}

export interface KtuFetch {
  /** The canonical grade-card text, ready for `parseGradeCard`. */
  text: string;
  /** Which semesters had a published card, e.g. ["S1","S2","S3","S4"]. */
  semesters: string[];
}

/**
 * Sign in and pull every published semester's grade card.
 *
 * Walks all eight semester ids because the portal does not advertise which are
 * published - it simply returns no card table for the ones that are not. A
 * semester that fails to parse is skipped, not fatal: one unreadable card must
 * not cost the student the three that read cleanly.
 */
export async function fetchKtuGradeCard(
  username: string, password: string,
): Promise<KtuFetch> {
  await loginKtu(username, password);

  // A fresh CSRF token off the listing page for the search POSTs. The login
  // token would very likely work too, but reading it from the page that hosts
  // the form is what a browser does and removes a guess.
  const listing = await get(LISTING_PATH);
  const token = csrfToken(listing.body);
  if (!token) {
    throw new KtuError("Signed in, but the grade-card page did not load as expected.");
  }

  const blocks: string[] = [];
  const semesters: string[] = [];
  for (const id of SEMESTER_IDS) {
    let card: ParsedCard | null = null;
    try {
      const response = await post(LISTING_PATH, [
        ["CSRF_TOKEN", token],
        ["form_name", SEARCH_FORM],
        ["semesterId", id],
        ["stdId", ""],
        ["condition", ""],
        ["pageActionMethod", ""],
        ["path", ""],
        ["search", "Search"],
      ]);
      if (response.status < 400) card = parseCardTable(response.body);
    } catch { /* one semester's failure never sinks the others */ }
    if (!card) continue;
    const name = `S${id}`;
    blocks.push(toCanonicalText(id, card));
    semesters.push(name);
  }

  if (!semesters.length) {
    throw new KtuError(
      "Signed in, but no published grade cards were found. Results may not be released yet.");
  }
  return { text: blocks.join("\n"), semesters };
}
