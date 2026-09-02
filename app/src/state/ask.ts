import { accessToken } from "./auth";
import { trace } from "./trace";
import type { View } from "./nav";
import type { Status } from "../engine";

/**
 * The remote half of the ask box.
 *
 * The palette already answers most questions on its own: a stop list, a
 * subsequence match, and every figure straight out of the engine. That path is
 * free, instant, works offline and cannot invent anything, so it stays first
 * and this is only ever reached when it finds nothing.
 *
 * What crosses the wire is a question and a course list - no marks, no
 * attendance, no CGPA, no name, no register number (see the worker's
 * `AskRequest`). The reply is a route, never prose and never a number. The
 * student's figures are still computed on their own machine by the engine,
 * which is the only reason a question box can sit on top of an app whose whole
 * position is that it never states a number it cannot show its working for.
 */

/** Mirrors the worker's `Action`. Kept in sync by the tests, not by import. */
export type AskAction = (
  | { kind: "view"; view: View }
  | { kind: "subject"; code: string; view: View }
  | { kind: "none"; reason: "off_topic" | "unclear" | "no_match" }
) & { say?: string };

/** Room for advice, not just an aside. Matches the worker's own cap. */
const SAY_MAX = 600;
const NUMBER_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|quarter|dozen";
const RECORD_TERMS = "attendance|attended|absent|present|bunk|bunked|skip|skipped|cie|internal|internals|marks|mark|scored|scoring|score|sgpa|cgpa|gpa|grade|grades|credits|credit|percent|percentage|class|classes|lecture|lectures|period|periods|semester|sem|series|ese|endsem|exam|exams|target|condonation|eligible|eligibility|shortage|debarred";
const ONE_NUMBER = new RegExp("^[^a-z0-9]*(?:" + NUMBER_WORDS + "|\\d+)[^a-z0-9]*$", "i");
const RECORD_NEAR = new RegExp("\\b(?:" + RECORD_TERMS + ")\\b", "i");

/**
 * A quantity about this student, as opposed to a quantity in advice.
 *
 * Same rule as the worker's `statesAFigure`, and the duplication is the
 * point - see `cleanSay` below. Rejected per sentence: a sentence carrying
 * both a number and a word from the student's record is making a claim about
 * their record, and every such claim belongs to the engine.
 */
function statesAFigure(text: string): boolean {
  if (text.includes("%")) return true;
  if (new RegExp("\\d+\\.\\d").test(text)) return true;
  for (const sentence of text.split(new RegExp("[.!?]+"))) {
    if (!RECORD_NEAR.test(sentence)) continue;
    if (sentence.split(new RegExp("\\s+")).some((w) => ONE_NUMBER.test(w))) return true;
  }
  return false;
}

export function cleanSay(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text === "" || text.length > SAY_MAX) return undefined;
  if (statesAFigure(text)) return undefined;
  if (/:\/\/|www\./i.test(text)) return undefined;
  return text;
}

export type AskOutcome =
  | { ok: true; action: AskAction; remaining: number }
  /**
   * Failures the student can do something about are separated from the ones
   * they cannot. `signin` and `limit` are states of their account; `offline`
   * and `failed` are ours, and the palette says so rather than blaming them.
   */
  | { ok: false; kind: "unconfigured" | "signin" | "limit" | "offline" | "failed" };

const ENDPOINT = String(import.meta.env.VITE_ASK_ENDPOINT ?? "").trim();

const VIEW_IDS = ["home", "ledger", "attendance", "history", "data"] as const;
const isView = (v: unknown): v is View =>
  typeof v === "string" && (VIEW_IDS as readonly string[]).includes(v);

/** Whether this build has somewhere to send a question at all. */
export const askConfigured = (): boolean => ENDPOINT !== "";

/**
 * Parse the worker's reply.
 *
 * Hostile to its input for the same reason the worker's own parser is: this
 * runs on a response that passed through a model, and an `action` the app does
 * not recognise must become nothing rather than something. A `code` is NOT
 * checked here - the worker already rejected any code the client did not send,
 * and the caller matches it back to a real row before navigating.
 */
export function parseReply(raw: unknown): AskOutcome | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const a = o.action;
  if (typeof a !== "object" || a === null) return null;
  const act = a as Record<string, unknown>;
  const remaining = typeof o.remaining === "number" ? o.remaining : 0;
  const say = cleanSay(act.say);
  // Which of the two silences this is. A model that wrote nothing is a prompt
  // problem; a sentence this guard threw away is a rule problem. From the
  // outside they are identical, and they need opposite fixes.
  if (say === undefined) {
    // Three possibilities, and they need three different fixes. The worker
    // reports the one this side cannot see: a sentence it wrote and then
    // refused. Without that flag a drop at the edge is indistinguishable here
    // from a model that never wrote anything, and the first hour of chasing
    // this went into loosening a rule that was not the problem.
    trace("no sentence",
      typeof act.say === "string" ? `this app's guard dropped: ${JSON.stringify(act.say)}`
      : o.sayDropped === true ? "the worker's guard dropped it - it stated a figure"
      : "the model wrote none");
  }

  if (act.kind === "view" && isView(act.view)) {
    return { ok: true, action: { kind: "view", view: act.view, say }, remaining };
  }
  if (act.kind === "subject" && typeof act.code === "string") {
    return {
      ok: true,
      action: {
        kind: "subject",
        code: act.code,
        view: isView(act.view) ? act.view : "attendance",
        say,
      },
      remaining,
    };
  }
  if (act.kind === "none") {
    const reason = act.reason;
    const known = reason === "off_topic" || reason === "unclear" || reason === "no_match";
    return {
      ok: true,
      action: { kind: "none", reason: known ? reason : "unclear", say },
      remaining,
    };
  }
  return null;
}

/**
 * Ask the worker to route a question.
 *
 * Signed out is not an error state to apologise for. Every figure in the app is
 * still readable without an account; this one box is what an account buys, and
 * the caller says that in a sentence rather than pushing a sign-in wall.
 */
/**
 * A subject as the router sees it: what it is called, and the engine's verdict.
 *
 * The verdict and nothing else. "SHORTAGE" is enough for the assistant to name
 * which subject to worry about, and carries no percentage, no mark and no
 * count - so the thing that makes it useful is not the thing that would make
 * it a disclosure of the record. PRIVACY.md states plainly that this is sent.
 */
export interface AskSubject {
  code: string;
  name: string;
  status?: Status;
}

/** One prior exchange, so a follow-up question means something. */
export interface AskTurn {
  question: string;
  answer?: string;
}

export async function askRemote(
  question: string,
  subjects: AskSubject[],
  signal?: AbortSignal,
  history: AskTurn[] = [],
): Promise<AskOutcome> {
  if (!askConfigured()) return { ok: false, kind: "unconfigured" };

  const token = accessToken();
  if (!token) return { ok: false, kind: "signin" };

  // Trimmed to the worker's own caps before sending. A request the edge will
  // reject as malformed is a round trip spent to be told what we already knew.
  const q = question.trim().slice(0, 400);
  if (q === "") return { ok: false, kind: "failed" };

  let res: Response;
  try {
    res = await fetch(`${ENDPOINT.replace(/\/+$/, "")}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        question: q,
        subjects: subjects.slice(0, 60),
        // Last three, trimmed to the worker's caps. Conversation, never a
        // record: this lives for as long as the palette is open and is never
        // written to disk.
        history: history.slice(-3).map((t) => ({
          question: t.question.slice(0, 400),
          ...(t.answer === undefined ? {} : { answer: t.answer.slice(0, 600) }),
        })),
      }),
      signal,
    });
  } catch {
    // No network, DNS, a campus proxy, a dead worker - indistinguishable from
    // here and identical to the student, who is simply not getting an answer.
    return { ok: false, kind: "offline" };
  }

  if (res.status === 401) return { ok: false, kind: "signin" };
  if (res.status === 429) return { ok: false, kind: "limit" };
  if (!res.ok) return { ok: false, kind: "failed" };

  try {
    return parseReply(await res.json()) ?? { ok: false, kind: "failed" };
  } catch {
    return { ok: false, kind: "failed" };
  }
}
