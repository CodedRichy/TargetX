/**
 * How many students can still sign in.
 *
 * The cap is not a marketing device. Clerk's development instances stop
 * accepting users at 100 - a real ceiling, already in force, that the app hits
 * whether or not anyone is told about it. Publishing the number turns an
 * invisible cliff into a countdown: students see honestly what is left, and we
 * see the ceiling coming instead of learning about it from the first person
 * whose sign-in fails.
 *
 * Which is also the rule this file exists to enforce: the figure is fetched,
 * never invented, and when it cannot be fetched nothing is returned at all.
 * A made-up "3 left" is a dark pattern; a stale one is a lie with a timestamp.
 * Silence is the only honest failure.
 */

interface SeatsEnv {
  /**
   * Clerk Backend API key (`sk_...`). A Worker secret, set with
   * `wrangler secret put CLERK_SECRET_KEY` - it is not in wrangler.toml and
   * must never reach the app or the website. It can read and delete every user
   * in the instance; what it is used for here is one integer.
   */
  CLERK_SECRET_KEY?: string;
  /**
   * The ceiling, as a string because wrangler vars are strings. Set to the
   * limit of whatever Clerk instance is configured - 100 while the instance is
   * a development one. Remove it on the day the instance goes to production
   * and the endpoint reports no cap, which is how the counter disappears from
   * the app and the website without shipping either of them again.
   */
  SEAT_CAP?: string;
}

/** Cached at the edge for this long. See `seats` for why it is not shorter. */
const CACHE_SECONDS = 300;

export interface Seats {
  /** Users in the instance right now. */
  taken: number;
  /** The ceiling. */
  cap: number;
  /** Never negative: an instance can end up over its own cap. */
  left: number;
}

/**
 * Ask Clerk how many users exist.
 *
 * Returns null on every failure - no key, no cap, HTTP error, unparseable
 * body. The caller turns that into a 503 and both clients then show nothing,
 * which is the point: a counter that guesses when the network is down is worse
 * than no counter, because it is indistinguishable from one that works.
 */
export async function countSeats(env: SeatsEnv, signal?: AbortSignal): Promise<Seats | null> {
  const cap = Number(env.SEAT_CAP);
  // No cap configured is the production instance's answer, not an error: there
  // is nothing to count down to, so there is nothing to say.
  if (!env.CLERK_SECRET_KEY || !Number.isFinite(cap) || cap <= 0) return null;

  try {
    const response = await fetch("https://api.clerk.com/v1/users/count", {
      headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}` },
      signal,
    });
    if (!response.ok) return null;

    const body = (await response.json()) as { total_count?: unknown };
    const taken = body?.total_count;
    if (typeof taken !== "number" || !Number.isFinite(taken) || taken < 0) return null;

    return { taken, cap, left: Math.max(0, Math.floor(cap - taken)) };
  } catch {
    return null;
  }
}

/**
 * The `GET /seats` response, cached at the edge.
 *
 * Five minutes, not five seconds. Three reasons, in order of how much they
 * cost: the Clerk Backend API is rate limited and this endpoint is public and
 * unauthenticated, so an uncached one is a free way for anyone to spend our
 * quota; a number that ticks live invites someone to sit and watch it, which
 * is the fake-urgency theatre this is meant to avoid; and nobody signing up is
 * harmed by a figure five minutes old.
 *
 * The cache is keyed on this Worker's own URL, so the Clerk key never takes
 * part in a cache key and the cached object is one integer either way.
 */
export async function seats(
  request: Request,
  env: SeatsEnv,
  headers: Record<string, string>,
): Promise<Response> {
  const cache = caches.default;
  const key = new Request(new URL("/seats", request.url).toString(), { method: "GET" });

  const hit = await cache.match(key);
  if (hit) {
    const fresh = new Response(hit.body, hit);
    for (const [name, value] of Object.entries(headers)) fresh.headers.set(name, value);
    return fresh;
  }

  // A hung Clerk must not hold the Worker open; both clients treat a slow
  // answer and no answer the same way, so failing fast costs nothing.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 4000);
  let found: Seats | null;
  try {
    found = await countSeats(env, abort.signal);
  } finally {
    clearTimeout(timer);
  }

  if (!found) {
    // Deliberately not cached. The next request should try again rather than
    // inherit five minutes of an outage.
    return Response.json({ error: "unavailable" }, { status: 503, headers });
  }

  const body = Response.json(found, {
    headers: { ...headers, "cache-control": `public, max-age=${CACHE_SECONDS}` },
  });
  await cache.put(key, body.clone());
  return body;
}
