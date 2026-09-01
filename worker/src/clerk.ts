/**
 * Who is asking.
 *
 * Clerk issues a short-lived JWT signed with a key whose public half is
 * published at the instance's JWKS endpoint. Verification is therefore a pure
 * signature check against a public key - no call to Clerk on the request path,
 * no shared secret, and nothing that breaks when Clerk is having a bad day
 * beyond new sign-ins.
 *
 * The token is treated as hostile input throughout. It arrived from a desktop
 * binary on a machine we do not control, and the only thing making it
 * trustworthy is the signature.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";

export interface Caller {
  /** Clerk's stable user id. The rate limiter counts against this. */
  sub: string;
}

/**
 * One JWKS fetcher per isolate.
 *
 * `createRemoteJWKSet` caches the keys and re-fetches only when it sees a
 * signing key it does not know, which is what makes per-request verification
 * cheap. Building a new one per request would put an HTTPS round trip to Clerk
 * in front of every question and hand an attacker a way to make us hammer
 * Clerk by sending unknown key ids.
 */
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function keys(issuer: string) {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  return jwks;
}

/**
 * Verify a Clerk session token.
 *
 * Returns null on every failure rather than throwing, and never explains which
 * check failed. "Expired" and "forged" are different facts to us and must look
 * identical from outside: telling a caller their signature was valid but their
 * audience was wrong is telling them how to get closer.
 */
export async function verify(
  authorization: string | null,
  env: { CLERK_ISSUER: string },
): Promise<Caller | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, keys(env.CLERK_ISSUER), {
      issuer: env.CLERK_ISSUER,
      // Clock skew between a student's laptop and Cloudflare is real and is not
      // an attack. Thirty seconds is the usual allowance; it is far short of
      // the token's own lifetime, so it does not meaningfully extend one.
      clockTolerance: 30,
    });

    if (typeof payload.sub !== "string" || !payload.sub) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}
