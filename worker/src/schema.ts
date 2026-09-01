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

export type Action =
  | { kind: "view"; view: ViewId }
  | { kind: "subject"; code: string; view: ViewId }
  /**
   * The refusal is a first-class action rather than an error, because the
   * honest answer to "what is the capital of France" from an academic tracker
   * is a shrug, not a 400. `reason` is one of a fixed set - it is not free text
   * the model wrote, for the same reason nothing else here is.
   */
  | { kind: "none"; reason: "off_topic" | "unclear" | "no_match" };

const REASONS = ["off_topic", "unclear", "no_match"] as const;

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

  if (o.kind === "view" && isView(o.view)) {
    return { kind: "view", view: o.view };
  }

  if (o.kind === "subject" && typeof o.code === "string" && knownCodes.has(o.code)) {
    // The view defaults rather than failing: a model that names the right
    // subject and forgets where to show it has still done the useful half.
    return { kind: "subject", code: o.code, view: isView(o.view) ? o.view : "attendance" };
  }

  if (o.kind === "none" && typeof o.reason === "string"
      && (REASONS as readonly string[]).includes(o.reason)) {
    return { kind: "none", reason: o.reason as (typeof REASONS)[number] };
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
