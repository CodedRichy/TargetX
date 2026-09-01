/**
 * The daily quota, counted where it cannot be lied to.
 *
 * A limit enforced in the app is not a limit: the app is a binary on the
 * student's own machine and they can edit it. This counter lives in a Durable
 * Object, which is the only thing in the Workers platform that gives a single
 * authoritative copy of a value with serialised access to it - KV would be
 * cheaper and would also let a client fire twenty parallel requests through a
 * read-modify-write race and spend twenty units of a five-unit quota.
 *
 * One object per user id, so two students never contend with each other, and a
 * heavy user's traffic is serialised only against themselves.
 */

/** Requests one user may make per UTC day. */
const DAILY = 40;

export interface Decision {
  ok: boolean;
  /** Requests left AFTER this one, so the client can show a real number. */
  remaining: number;
  /** Unix seconds at which the quota resets. */
  resetAt: number;
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function nextMidnight(now: number): number {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export class Quota {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(): Promise<Response> {
    const now = Date.now();
    const today = dayKey(now);

    // `blockConcurrencyWhile` is not needed here: a Durable Object already
    // processes one fetch at a time per object, which is the entire reason
    // this is a DO and not a KV key.
    const stored = await this.state.storage.get<{ day: string; used: number }>("c");
    const used = stored?.day === today ? stored.used : 0;

    if (used >= DAILY) {
      return Response.json({
        ok: false, remaining: 0, resetAt: nextMidnight(now),
      } satisfies Decision);
    }

    await this.state.storage.put("c", { day: today, used: used + 1 });
    return Response.json({
      ok: true, remaining: DAILY - (used + 1), resetAt: nextMidnight(now),
    } satisfies Decision);
  }
}

/**
 * Claim one request against a user's quota.
 *
 * Counted BEFORE the model is called, not after. Counting on success would let
 * a caller who reliably triggers a Gemini error spend our money without ever
 * spending their own quota, which is the cheapest denial-of-wallet there is.
 */
export async function claim(
  ns: DurableObjectNamespace, userId: string,
): Promise<Decision> {
  const stub = ns.get(ns.idFromName(userId));
  return await (await stub.fetch("https://quota/claim")).json<Decision>();
}
