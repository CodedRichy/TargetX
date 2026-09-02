/**
 * TargetX ask endpoint.
 *
 * The only reason this service exists is that three of the app's requirements
 * cannot be met inside a desktop binary:
 *
 *   - the Gemini key must stay secret, and a Tauri bundle is files on the
 *     student's disk;
 *   - a rate limit enforced by the client is a rate limit the client deletes;
 *   - a Clerk session proves nothing until something verifies the signature.
 *
 * All three are the same problem - trust cannot live on the machine being
 * trusted - and this is the smallest thing that solves it.
 *
 * What it deliberately does NOT do: compute anything about a student. Marks,
 * attendance and CGPA never reach here. The request carries a question and a
 * course list; the response carries a route. Every figure the student reads is
 * still produced by the engine on their own machine, which is what lets the app
 * keep saying it never states a number it cannot show its working for.
 */
import { verify } from "./clerk";
import { claim } from "./limit";
import { route } from "./gemini";
import { parseAction, parseAskRequest } from "./schema";
import { logAsk, outcomeOf } from "./log";

export { Quota } from "./limit";

interface Env {
  GEMINI_KEY: string;
  CLERK_ISSUER: string;
  QUOTA: DurableObjectNamespace;
  /**
   * Optional. A deployment without the dataset bound still answers questions;
   * see `logAsk`. Analytics Engine is not on every plan, and losing the log is
   * a worse outcome than losing the feature only if the feature still works.
   */
  ASK_LOG?: AnalyticsEngineDataset;
}

/** No credentials, no cookies - the client sends a bearer token by hand. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "POST,OPTIONS",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS, ...extra } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return json({ error: "method" }, 405);

    const url = new URL(request.url);
    if (url.pathname !== "/ask") return json({ error: "not_found" }, 404);

    // Identity first, before the body is even read. An unauthenticated caller
    // should not be able to make us parse anything they sent.
    const caller = await verify(request.headers.get("authorization"), env);
    if (!caller) return json({ error: "unauthorized" }, 401);

    // Quota second, before the model is called. See `claim`: counting after a
    // success would let a caller who can reliably provoke an error spend our
    // budget without spending their own.
    const quota = await claim(env.QUOTA, caller.sub);
    if (!quota.ok) {
      return json({ error: "rate_limited", resetAt: quota.resetAt }, 429, {
        "retry-after": String(Math.max(1, quota.resetAt - Math.floor(Date.now() / 1000))),
      });
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "bad_request" }, 400);
    }

    const ask = parseAskRequest(payload);
    if (!ask) return json({ error: "bad_request" }, 400);

    // A hung upstream must not hold a Worker invocation open indefinitely. The
    // app has a local answer for most questions anyway, so a fast failure is
    // worth more here than a slow success.
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    const started = Date.now();
    // Logged on every path below, including the failures. The set of questions
    // that reach this Worker at all is the set the app could not answer by
    // itself, which is the only evidence there is about what to teach it next.
    const record = (outcome: Parameters<typeof logAsk>[1]["outcome"]) =>
      ctx.waitUntil(logAsk(env.ASK_LOG, {
        outcome, question: ask.question,
        subjectCount: ask.subjects.length,
        latencyMs: Date.now() - started,
      }));

    try {
      const raw = await route(ask, env.GEMINI_KEY, abort.signal);
      const action = parseAction(raw, new Set(ask.subjects.map((s) => s.code)));
      record(outcomeOf(action));

      // The model returned something outside its own schema. That is not an
      // action the app is allowed to act on, and it is not an error the student
      // needs to see either - it is a shrug.
      if (!action) {
        return json({ action: { kind: "none", reason: "unclear" }, remaining: quota.remaining });
      }

      // Why there is no sentence, when there is no sentence.
      //
      // The app cannot work this out for itself: a sentence the guard here
      // threw away and a sentence the model never wrote arrive at the client
      // looking identical, and they need opposite fixes - one is a rule that
      // is too strict, the other is a prompt or a schema that is too loose.
      // Measured, this cost an hour of loosening the wrong thing.
      //
      // A boolean, never the rejected text: the sentence was refused for
      // stating a figure about this student, and echoing it back would send
      // exactly what the refusal was protecting.
      const wrote = typeof (raw as { say?: unknown } | null)?.say === "string"
        && ((raw as { say: string }).say).trim() !== "";
      const dropped = wrote && action.say === undefined;

      return json({ action, remaining: quota.remaining, sayDropped: dropped });
    } catch {
      // Nothing about the upstream failure is echoed back. The error text could
      // carry a URL, a key fragment or a project id, and none of that is the
      // student's business or safe to leak. It IS recorded, because a run of
      // upstream errors is the difference between "nobody asked" and "everybody
      // asked and got nothing".
      record("upstream_error");
      return json({ error: "upstream" }, 502);
    } finally {
      clearTimeout(timer);
    }
  },
};
