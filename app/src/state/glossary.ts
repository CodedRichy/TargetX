import {
  ATTENDANCE_CONDONE, ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX,
  ATTENDANCE_MIN, DL_CAP_PCT, ESE_PASS_FRACTION, COURSE_TYPES, DEFAULT_TYPE,
} from "../engine";

/**
 * What the words mean, stated once.
 *
 * Two problems this fixes, which turned out to be the same problem.
 *
 * The ask box could not answer "what is condonation" and did something worse
 * than failing: "condonation" contains no explainer verb, so the topic detector
 * matched it as an eligibility question and replied with the student's own
 * attendance budget. A confident answer to a question nobody asked. Definitions
 * are now their own kind of answer rather than a question shape that has to be
 * guarded against.
 *
 * And the drawer's glossary hardcoded every figure it quoted - "85% earns 5,
 * then 4, 3, 2, 1 down to 60%", "at most 10% of classes held", "at least 40% of
 * the ESE paper". Those are the engine's constants written out as English, in
 * the one panel whose entire job is teaching the rules, with nothing failing if
 * they drift. Every number below is interpolated from the constant the
 * calculation itself uses, so a change to the regulation cannot leave this
 * screen confidently teaching the old one.
 */

export interface Term {
  /** What it is called on screen. */
  name: string;
  /** Everything a student might type to mean it. Lower case, matched whole. */
  aliases: string[];
  body: string;
}

/** The top band and its mark, read off the table rather than assumed. */
const TOP_BAND = ATTENDANCE_MARK_BANDS[0]!;
/** The lowest band that still earns anything. */
const LAST_BAND = ATTENDANCE_MARK_BANDS[ATTENDANCE_MARK_BANDS.length - 1]!;
/** The marks in the table, high to low, as "5, 4, 3, 2, 1". */
const BAND_MARKS = ATTENDANCE_MARK_BANDS.map(([, m]) => m).join(", ");
const DEFAULT_SPEC = COURSE_TYPES[DEFAULT_TYPE];
const ESE_PASS_PCT = Math.round(ESE_PASS_FRACTION * 100);

export const TERMS: Term[] = [
  {
    name: "CIE",
    aliases: ["cie", "internal", "internals", "continuous internal evaluation"],
    body: `Continuous Internal Evaluation — the marks your college gives during the semester: series exams, assignments, and attendance. Out of ${DEFAULT_SPEC.cieMax} for most theory courses.`,
  },
  {
    name: "ESE",
    aliases: ["ese", "end semester", "endsem", "end semester examination", "university exam"],
    body: `End Semester Examination — the university exam at the end. Out of ${DEFAULT_SPEC.eseMax} for most theory courses.`,
  },
  {
    name: `The ${ESE_PASS_PCT}% rule`,
    aliases: ["40 rule", "40% rule", "ese minimum", "separate minimum", "ese pass"],
    body: `You must score at least ${ESE_PASS_PCT}% of the ESE paper on its own, whatever your CIE is. A strong internal cannot buy a pass.`,
  },
  {
    name: "Attendance marks",
    aliases: ["att mk", "attendance mark", "attendance marks", "r7.5", "r 7.5"],
    body: `Attendance is worth up to ${ATTENDANCE_MARK_MAX} CIE marks under Regulations 2024, R 7.5.ii: ${TOP_BAND[0]}% earns ${TOP_BAND[1]}, then ${BAND_MARKS} down to ${LAST_BAND[0]}%. This is the part no other KTU calculator shows — being at ${ATTENDANCE_MIN + 1}% is not "fine", it is marks already gone.`,
  },
  {
    name: "Shortage",
    aliases: ["shortage", "short", "attendance shortage"],
    body: `Below ${ATTENDANCE_MIN}% attendance. Condonation may be possible down to ${ATTENDANCE_CONDONE}%, for at most two semesters, against a fee.`,
  },
  {
    name: "Condonation",
    aliases: ["condonation", "condone", "condoned"],
    body: `Paying to be allowed to sit an exam you are short of attendance for. Available between ${ATTENDANCE_CONDONE}% and ${ATTENDANCE_MIN}%, for at most two semesters across the programme, against a fee. Below ${ATTENDANCE_CONDONE}% there is no appeal path under R 6.2.`,
  },
  {
    name: "Debarred",
    aliases: ["debarred", "debar", "barred"],
    body: `Below ${ATTENDANCE_CONDONE}% attendance. You cannot sit the exam and there is no appeal path under R 6.2.`,
  },
  {
    name: "Duty leave",
    aliases: ["duty leave", "dl", "od", "on duty"],
    body: `Approved absence for NSS, sports, fests or placement drives. It counts as present, but only up to ${DL_CAP_PCT}% of classes held (R 6.3.ii) — anything beyond that is wasted, and this app says so.`,
  },
  {
    name: "Incomplete",
    aliases: ["incomplete", "withdrawn", "withdrawal", "grade i", "grade w"],
    body: "Published as I or W — withdrawn, or not completed. KTU leaves it out of the SGPA entirely, credits included, until you complete it. It is not a fail and is not scored as one.",
  },
  {
    name: "Unreachable",
    aliases: ["unreachable"],
    body: "Even a full ESE paper cannot get this course to a pass. Better to know now.",
  },
  {
    name: "SGPA and CGPA",
    aliases: ["sgpa", "cgpa", "gpa", "sgpa and cgpa", "difference between sgpa and cgpa"],
    body: "SGPA is one semester's grade point average, weighted by the credits you registered for that semester. CGPA is the same average across every semester published so far. A failed course still counts in the denominator; one marked I or W does not.",
  },
];

/**
 * Whether a question is asking what something IS.
 *
 * Deliberately narrow. A definitional phrasing plus a term the glossary holds
 * is a high bar, and anything short of it falls through to the topic detector -
 * because "what is my attendance" is a question about the student, not about
 * the word "attendance", and the two are one word apart.
 */
const DEFINITIONAL = [
  /\bwhat (?:is|are|does|do)\b/, /\bwhats\b/, /\bexplain\b/, /\bmeaning of\b/,
  /\bdefine\b/, /\bmeans?\b/, /\bdifference between\b/,
];

/** A question about the student, not about a word. One word decides it. */
const POSSESSIVE = /\b(my|mine|i|me|im)\b/;

/**
 * Find the term a question is asking about, or null.
 *
 * Longest alias first, so "duty leave" is not beaten by "dl" and "sgpa and
 * cgpa" is not beaten by "sgpa".
 */
const normalise = (query: string) =>
  ` ${query.toLowerCase().replace(/[^a-z0-9% ]+/g, " ").replace(/\s+/g, " ")} `;

export function lookupTerm(query: string): Term | null {
  const q = normalise(query);
  if (!DEFINITIONAL.some((re) => re.test(q))) return null;
  // "what is my attendance" is asking for a figure, not a definition.
  if (POSSESSIVE.test(q)) return null;

  return longestAlias(q, TERMS);
}

/** The longest alias any of `pool` matches in an already-normalised query. */
function longestAlias(q: string, pool: Term[]): Term | null {
  let best: { term: Term; length: number } | null = null;
  for (const term of pool) {
    for (const alias of term.aliases) {
      if (!q.includes(` ${alias} `)) continue;
      if (best === null || alias.length > best.length) {
        best = { term, length: alias.length };
      }
    }
  }
  return best?.term ?? null;
}

/**
 * A question about the APP, which needs its own matcher.
 *
 * "How do I import my grade card" is possessive and is not definitional, so
 * `lookupTerm` refuses it twice over - correctly, since those guards exist to
 * stop "what is my attendance" being answered with a dictionary entry. But a
 * question about the product is naturally phrased in the first person, and it
 * is still not a question about the student's record. Different question,
 * different test.
 */
const HOWTO = [
  /\bhow (?:do|can|does|often)\b/, /\bcan i\b/, /\bwhere (?:is|are|do|does)\b/,
  /\bwhat can\b/, /\bis my\b/, /\bare my\b/, /\bwhat (?:is|are|does|do)\b/,
  /\bwhats\b/,
];

export function lookupCapability(query: string): Term | null {
  const q = normalise(query);
  if (!HOWTO.some((re) => re.test(q))) return null;
  return longestAlias(q, CAPABILITIES);
}

/**
 * What the app itself does.
 *
 * Nothing anywhere described this. Not the app, and not the Worker's system
 * prompt - which lists five view names and nothing else - so "how do I import
 * my grade card", "where does this data come from" and "is my password stored"
 * could not be answered by either half. A student asking what the thing in
 * front of them does is asking the most reasonable question there is.
 *
 * Kept beside the regulation terms deliberately: they are the same kind of
 * claim. Neither is computed from the student's record, and both are things
 * TargetX can state because they are true of TargetX, not of them.
 */
export const CAPABILITIES: Term[] = [
  {
    name: "What TargetX does",
    aliases: ["targetx", "this app", "the app", "it do", "you do", "tex"],
    body: `Tracks your KTU marks and attendance so you do not have to open etlab or the KTU portal. It prices attendance in CIE marks (R 7.5.ii), says what each subject still needs in the final, and tracks your CGPA against a target you set. Every figure is computed on this machine from your own records.`,
  },
  {
    name: "Where the data comes from",
    aliases: ["data come from", "data comes from", "where the data", "source of the data",
              "sync", "syncing", "etlab", "ktu portal"],
    body: `Two sources. Your college's etlab portal supplies this semester's marks, attendance and timetable; the KTU portal supplies published grade cards for past semesters. Where the two disagree about a semester, the KTU grade card wins and the disagreement is shown rather than hidden.`,
  },
  {
    name: "Importing a grade card",
    aliases: ["import", "importing", "grade card", "gradecard", "import a grade card",
              "paste", "pdf"],
    body: `On the Data screen. You can fetch it from the KTU portal directly, paste the table from a grade card, or open the PDF. Any of the three fills in a past semester's SGPA and credits.`,
  },
  {
    name: "Whether your password is stored",
    aliases: ["password", "password stored", "passwords", "credentials", "secure", "safe"],
    body: `Your portal password is used to sign in and is not written to disk in readable form, is never included in an export, and is never written to a log. Signing in to TargetX itself is separate and optional - it unlocks the question box and nothing else.`,
  },
  {
    name: "Backing up",
    aliases: ["backup", "back up", "backing up", "export", "restore"],
    body: `Export backup on the Data screen writes a single file holding every semester, subject and published result. Restore replaces the whole record with a file, so export first if there is anything you want to keep.`,
  },
  {
    name: "How often it syncs",
    aliases: ["how often", "sync", "refresh", "refreshes", "automatic"],
    body: `On its own, at most once every 45 minutes, and only when the record is stale. The refresh button in the header pulls both portals immediately and ignores that gap.`,
  },
];

/** Both are facts about TargetX rather than about the student. */
export const ALL_FACTS: Term[] = [...TERMS, ...CAPABILITIES];
