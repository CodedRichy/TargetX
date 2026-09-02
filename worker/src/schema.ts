/**
 * The contract between the app and the model.
 *
 * This file is the enforcement point for "the assistant may not answer anything
 * outside the app". That rule is NOT implemented as a sentence in a prompt.
 * A prompt is a request, and a request can be talked out of; every published
 * jailbreak is a demonstration of exactly that. It is implemented as a type the
 * response has to parse into before it is allowed back to the client.
 *
 * The model's entire vocabulary is below. It can name a view, it can name a
 * subject, or it can decline. There is no shape here that carries prose, and
 * none that carries a number - so the model structurally cannot state a figure
 * about a student's marks, correct or otherwise. Every number the student sees
 * is still computed on their own machine by the engine, exactly as it is today.
 *
 * The model routes. The engine answers. That separation is the whole design.
 */

/** The views the app actually has. Anything else is a hallucinated route. */
export const VIEWS = ["home", "ledger", "attendance", "history", "data"] as const;
export type ViewId = (typeof VIEWS)[number];

/**
 * What the app asks a question about.
 *
 * Note what is NOT in here: no marks, no attendance percentages, no CGPA, no
 * name, no register number. The model is routing a question to a subject, and
 * it needs the subject's code and title to do that - it does not need to know
 * how the student is doing, and sending that would be handing an academic
 * record to a third party for no gain. What leaves the machine is a question
 * and a course list. The answer is computed at home.
 */
/**
 * The engine's verdict per subject, and the only thing about a student's
 * standing that ever leaves the machine.
 *
 * Mirrors `Status` in the app's engine, which computes it from marks and
 * attendance the model never sees. It is deliberately a verdict rather than a
 * measurement: "SHORTAGE" says a subject needs attention, and says nothing
 * about how far short it is, what the percentage is, or what was scored.
 *
 * It is here because an assistant that cannot see which subject is the
 * problem can only give advice that fits any student, and advice that fits
 * any student is what makes it read as a lookup table. The cost is real and
 * is stated in PRIVACY.md rather than glossed: a verdict IS information about
 * this student, and it is sent.
 */
export const STATUSES = [
  "SAFE", "TIGHT", "PENDING", "INCOMPLETE",
  "SHORTAGE", "DEBARRED", "FAILED", "UNREACHABLE",
] as const;
export type SubjectStatus = (typeof STATUSES)[number];

/**
 * The last few exchanges, so a follow-up means something.
 *
 * Without this every question is the student's first: "what about ML?" after
 * a question about DAA lands on a model that has never heard of DAA. Capped
 * hard and never persisted - it is conversation, not a record.
 */
export interface AskTurn {
  question: string;
  answer?: string;
}

export interface AskRequest {
  question: string;
  subjects: Array<{ code: string; name: string; status?: SubjectStatus }>;
  history?: AskTurn[];
}

/** How many prior exchanges are worth the tokens. */
const MAX_HISTORY = 3;

/**
 * What the assistant says, as opposed to where it sends you.
 *
 * Added because the app had no field a sentence could travel in, and the
 * consequence was not a missing feature - it was an assistant that could not
 * say what it was. "Who are you" was routed to a screen; "what are you?" came
 * back off_topic. Everything it appeared to say was a hardcoded glossary entry
 * or an engine line, which is exactly how it read.
 *
 * The rule this has to survive is the one the whole design rests on: the model
 * never states a figure. That rule was implemented by giving it nowhere to
 * write one. This gives it somewhere to write prose and takes the numbers away
 * separately - `cleanSay` rejects any sentence containing a digit or a number
 * word, and it runs on the way out, on code we control, on whatever the model
 * actually returned rather than what it was asked for.
 *
 * So: the assistant may have a voice. It may never have a number. A figure in
 * this field is a bug one regex catches, not a promise a prompt makes.
 */
export type Action = (
  | { kind: "view"; view: ViewId }
  | { kind: "subject"; code: string; view: ViewId }
  /**
   * The refusal is a first-class action rather than an error, because the
   * honest answer to "what is the capital of France" from an academic tracker
   * is a shrug, not a 400. `reason` is one of a fixed set - it is not free text
   * the model wrote, for the same reason nothing else here is.
   */
  | { kind: "none"; reason: "off_topic" | "unclear" | "no_match" }
) & { say?: string };

const REASONS = ["off_topic", "unclear", "no_match"] as const;

/**
 * Room for advice, not just for an aside.
 *
 * This was 240 - two sentences, set when `say` was a remark beside a route.
 * The assistant is now asked for advice, for how to use the week before an
 * exam, for what to do about being behind. That job does not fit in a remark,
 * and a cap set for the old one silently truncated the new one into
 * uselessness.
 */
const SAY_MAX = 600;

const NUMBER_WORDS = "zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter|dozen";
/**
 * Vocabulary that means "this student's record" rather than "the world".
 *
 * The distinction this file has to make is not between prose with numbers and
 * prose without. It is between a quantity that is advice - "aim for two passes
 * over the syllabus" - and a quantity that is a CLAIM ABOUT THIS STUDENT -
 * "you are at seventy percent". The first is the assistant being useful. The
 * second is the app stating a figure it did not compute, which is the one
 * thing TargetX must never do.
 *
 * Banning every number caught both, and that was the easy rule rather than the
 * right one: it left the assistant unable to give ordinary advice without
 * sounding like it was dodging something.
 */
const RECORD_TERMS = "attendance|attended|absent|absence|absences|present|bunk|bunked|skip|skipped|cie|internal|internals|marks|mark|scored|scoring|score|sgpa|cgpa|gpa|grade|grades|credits|credit|percent|percentage|class|classes|lecture|lectures|period|periods|subject|subjects|short|semester|sem|series|ese|endsem|exam|exams|target|condonation|eligible|eligibility|shortage|debarred";

const ONE_NUMBER = new RegExp("^[^a-z0-9]*(?:" + NUMBER_WORDS + "|\\d+)[^a-z0-9]*$", "i");
const RECORD_NEAR = new RegExp("\\b(?:" + RECORD_TERMS + ")\\b", "i");

/**
 * "One" is usually a pronoun, and pronouns are not figures.
 *
 * Observed: an answer naming which subject to focus on was thrown away by the
 * rule below, because "Microcontrollers is THE ONE to focus on, it is the only
 * subject showing a SHORTAGE" puts a number word and a record word in one
 * sentence. It states no figure whatsoever. English uses "one" as a pronoun
 * far more often than as a count, and treating every instance as a quantity
 * silently cost the assistant its most useful sentences.
 *
 * So "one" counts only where it is actually counting: in front of a thing, or
 * in front of the comparatives that only ever follow a number.
 */
const ONE_AS_QUANTITY = new RegExp(
  "\\bone \\s*(?:more|less|fewer|extra|further|additional|other|of)\\b"
  + "|\\bone \\s*(?:" + RECORD_TERMS + ")\\b", "i");

/**
 * Does this text state a figure about the student?
 *
 * The unit is the SENTENCE, and a sentence is rejected when it contains both
 * a quantity and a word from the student's record. Proximity was tried first
 * and measured too narrow - "two of your subjects are short on attendance"
 * puts seven words between the number and the record word, and it is plainly
 * a claim. Co-occurrence inside one sentence catches it, while still allowing
 * "aim for two passes over the syllabus - your attendance is the other thing
 * to watch", where the quantity and the record word are in different
 * sentences and the advice is not about a figure at all.
 *
 * Deliberately errs towards rejecting. A wrongly dropped sentence costs the
 * student some warmth; a wrongly kept one costs them a figure that
 * contradicts the engine's, printed directly underneath it.
 */
export function statesAFigure(text: string): boolean {
  // Always: a percent sign, and any decimal. Neither appears in advice, and
  // both are the shape of something that was computed.
  if (text.includes("%")) return true;
  if (new RegExp("\\d+\\.\\d").test(text)) return true;

  for (const sentence of text.split(new RegExp("[.!?]+"))) {
    if (!RECORD_NEAR.test(sentence)) continue;
    if (ONE_AS_QUANTITY.test(sentence)) return true;
    if (sentence.split(new RegExp("\\s+")).some((w) => ONE_NUMBER.test(w))) {
      return true;
    }
  }
  return false;
}

/**
 * Accept a sentence from the model, or drop it.
 *
 * Drops the sentence rather than the whole action: a model that routes
 * correctly and then says something it should not has still done the useful
 * half, and the student gets the route without the commentary.
 */
export function cleanSay(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  // Control characters would let a response break the layout it is rendered
  // into; collapsing whitespace also removes the newlines a model uses to
  // pad a short answer into something that looks longer.
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text === "" || text.length > SAY_MAX) return undefined;
  if (statesAFigure(text)) return undefined;
  // A link is a place to send a student that nobody here has vetted.
  if (/:\/\/|www\./i.test(text)) return undefined;
  return text;
}

function isView(v: unknown): v is ViewId {
  return typeof v === "string" && (VIEWS as readonly string[]).includes(v);
}

/**
 * Parse a model response into an Action, or reject it.
 *
 * Deliberately hostile to its input. This runs on whatever the model returned,
 * which is untrusted text no matter how well the prompt was written, and the
 * only thing standing between it and the client is this function. Unknown
 * fields are dropped rather than passed through; a subject code the client
 * never sent is rejected rather than trusted, because a model that invents a
 * course code would otherwise have the app navigate to a subject that does not
 * exist.
 */
export function parseAction(raw: unknown, knownCodes: Set<string>): Action | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const say = cleanSay(o.say);

  if (o.kind === "view" && isView(o.view)) {
    return { kind: "view", view: o.view, say };
  }

  if (o.kind === "subject" && typeof o.code === "string" && knownCodes.has(o.code)) {
    // The view defaults rather than failing: a model that names the right
    // subject and forgets where to show it has still done the useful half.
    return {
      kind: "subject", code: o.code,
      view: isView(o.view) ? o.view : "attendance", say,
    };
  }

  if (o.kind === "none" && typeof o.reason === "string"
      && (REASONS as readonly string[]).includes(o.reason)) {
    return { kind: "none", reason: o.reason as (typeof REASONS)[number], say };
  }

  return null;
}

/** Shape check on what the CLIENT sent, before any of it reaches the model. */
export function parseAskRequest(raw: unknown): AskRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;

  if (typeof o.question !== "string") return null;
  const question = o.question.trim();
  // A cap, because the question is forwarded to a metered API and an unbounded
  // string is an unbounded bill. Long enough for any real question.
  if (question.length === 0 || question.length > 400) return null;

  if (!Array.isArray(o.subjects) || o.subjects.length > 60) return null;
  const subjects: AskRequest["subjects"] = [];
  for (const s of o.subjects) {
    if (typeof s !== "object" || s === null) return null;
    const { code, name, status } = s as Record<string, unknown>;
    if (typeof code !== "string" || typeof name !== "string") return null;
    if (code.length > 24 || name.length > 120) return null;
    // An unrecognised status is dropped rather than rejected: a client from a
    // future build sending a verdict this worker has not heard of should get
    // an answer without one, not an error.
    const known = typeof status === "string"
      && (STATUSES as readonly string[]).includes(status);
    subjects.push(known ? { code, name, status: status as SubjectStatus }
                        : { code, name });
  }

  const history: AskTurn[] = [];
  if (o.history !== undefined) {
    if (!Array.isArray(o.history)) return null;
    // Trimmed rather than refused: an over-long history is a client being
    // generous, not a client being wrong.
    for (const t of o.history.slice(-MAX_HISTORY)) {
      if (typeof t !== "object" || t === null) return null;
      const { question: q, answer: a } = t as Record<string, unknown>;
      if (typeof q !== "string" || q.trim() === "" || q.length > 400) return null;
      if (a !== undefined && (typeof a !== "string" || a.length > 600)) return null;
      history.push(a === undefined ? { question: q } : { question: q, answer: a });
    }
  }

  // Only when the client sent one. A request without history parses to
  // exactly what it did before this field existed.
  return history.length > 0
    ? { question, subjects, history }
    : { question, subjects };
}
