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
export interface AskRequest {
  question: string;
  subjects: Array<{ code: string; name: string }>;
}

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

/** Long enough for two sentences. Anything longer is not an aside. */
const SAY_MAX = 240;

/**
 * Numbers, spelled out.
 *
 * Banning digits alone would be a rule about typography rather than about
 * claims: "you are at seventy five percent" asserts a figure exactly as much
 * as "75%" does, and a model asked not to use digits will reach for it. The
 * engine's own line, rendered directly beneath this sentence, is where every
 * figure belongs - so the assistant refers to a quantity ("your attendance")
 * and never names one.
 */
const NUMBER_WORD =
  /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter|percent|percentage)\b/i;

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
  if (/\d/.test(text)) return undefined;
  if (NUMBER_WORD.test(text)) return undefined;
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
    const { code, name } = s as Record<string, unknown>;
    if (typeof code !== "string" || typeof name !== "string") return null;
    if (code.length > 24 || name.length > 120) return null;
    subjects.push({ code, name });
  }

  return { question, subjects };
}
