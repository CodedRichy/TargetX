/**
 * What the router was asked, and what it did about it.
 *
 * The point of this log is one specific blind spot. Local matching in the app
 * now answers almost every question - the keyword list routes attendance,
 * marks, results and sync questions without ever calling out - so the requests
 * that reach this Worker are, by construction, the phrasings the keyword list
 * MISSED. That set is the only evidence there is about what to add to it, and
 * without a log it is discarded the instant a response is returned.
 *
 * Refusals are logged as carefully as successes, and are the more valuable
 * half: a question the model declined is a student who wanted something the app
 * would not give them, and nothing else in the system records that.
 *
 * WHAT IS DELIBERATELY NOT LOGGED
 *
 * No `sub`, no token, no name, no email. The caller's identity is verified on
 * every request and used to count quota - it just never reaches this file, and
 * the quota counter needs no content to do its job. Keeping the two apart is
 * the whole design: with both, this is a profile of a named student's questions
 * over time, and holding that carries obligations under the DPDP Act that a
 * routing corpus does not.
 *
 * No course codes or names either. A course list is not sensitive on its own,
 * but a distinctive question plus a specific semester's course list re-identifies
 * a student inside a small cohort. The COUNT is kept, because the only thing the
 * router's behaviour depends on is whether it had a course list to work with.
 *
 * The question text itself IS kept, because it is the thing being studied and
 * there is no useful anonymised form of it. It is free text a student typed, so
 * it is treated as the sensitive field it is: nothing is joined to it.
 */

/** Every way a request can end. The refusals are the interesting rows. */
export type Outcome =
  | "routed_view"
  | "routed_subject"
  | "declined_off_topic"
  | "declined_unclear"
  | "declined_no_match"
  /** The model returned something outside its own schema. */
  | "unparseable"
  /** Gemini failed, timed out, or was aborted. */
  | "upstream_error";

export interface AskLog {
  outcome: Outcome;
  question: string;
  /** How many courses the client sent. Never which ones. */
  subjectCount: number;
  /** Milliseconds spent in the model call. */
  latencyMs: number;
}

/**
 * A stable id for a question, so repeats can be counted without grouping by the
 * raw string in every query. Truncated: this identifies a phrasing, and a
 * full-width digest would invite treating it as a key for something else.
 */
async function digest(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.toLowerCase().trim());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Write one point, or quietly do nothing.
 *
 * Never throws and never awaits into the response path. A logging failure -
 * an unbound dataset, a quota, a malformed point - must not turn a working
 * answer into an error for the student. The binding is optional for the same
 * reason: a deployment without it should serve questions, not refuse them.
 */
export async function logAsk(
  dataset: AnalyticsEngineDataset | undefined, entry: AskLog,
): Promise<void> {
  if (!dataset) return;
  try {
    dataset.writeDataPoint({
      // `indexes` is what the dataset is sampled and grouped by, so it carries
      // the outcome - the dimension every question about this log starts from.
      indexes: [entry.outcome],
      blobs: [entry.outcome, entry.question, await digest(entry.question)],
      doubles: [entry.subjectCount, entry.latencyMs],
    });
  } catch {
    // Nothing to do and nobody to tell. The request has already been answered.
  }
}

/** The outcome an Action maps to, so the caller does not spell it out twice. */
export function outcomeOf(
  action: { kind: string; reason?: string } | null,
): Outcome {
  if (!action) return "unparseable";
  if (action.kind === "view") return "routed_view";
  if (action.kind === "subject") return "routed_subject";
  if (action.reason === "off_topic") return "declined_off_topic";
  if (action.reason === "no_match") return "declined_no_match";
  return "declined_unclear";
}
