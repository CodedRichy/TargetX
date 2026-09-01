import { accessToken } from "./auth";
import type { View } from "./nav";

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
export type AskAction =
  | { kind: "view"; view: View }
  | { kind: "subject"; code: string; view: View }
  | { kind: "none"; reason: "off_topic" | "unclear" | "no_match" };

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

  if (act.kind === "view" && isView(act.view)) {
    return { ok: true, action: { kind: "view", view: act.view }, remaining };
  }
  if (act.kind === "subject" && typeof act.code === "string") {
    return {
      ok: true,
      action: {
        kind: "subject",
        code: act.code,
        view: isView(act.view) ? act.view : "attendance",
      },
      remaining,
    };
  }
  if (act.kind === "none") {
    const reason = act.reason;
    const known = reason === "off_topic" || reason === "unclear" || reason === "no_match";
    return {
      ok: true,
      action: { kind: "none", reason: known ? reason : "unclear" },
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
export async function askRemote(
  question: string,
  subjects: Array<{ code: string; name: string }>,
  signal?: AbortSignal,
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
      body: JSON.stringify({ question: q, subjects: subjects.slice(0, 60) }),
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
