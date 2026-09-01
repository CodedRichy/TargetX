import { invoke } from "@tauri-apps/api/core";
import { createSignal } from "solid-js";
import { canSync } from "../sync/etlab";

/**
 * The account, front-end side.
 *
 * Thin passes to `src-tauri/src/oauth.rs`, which owns the whole flow: PKCE, the
 * loopback listener, the system browser and the refresh token in the OS vault.
 * Deliberately so. The webview this code runs in also renders a college
 * portal's HTML, and neither the authorization URL nor the refresh token has
 * any business passing through it.
 *
 * What lives here is the short-lived access token, in memory, in a signal that
 * is never persisted. It is a bearer credential for our own Worker and nothing
 * else, and writing it to disk would be storing a credential to save one
 * refresh call on the next launch.
 *
 * SIGNING IN IS OPTIONAL AND GATES NOTHING BUT THE ASSISTANT. Every figure the
 * app shows is computed on this machine from data this machine fetched, and a
 * student who never signs in - or whose provider is down, or whose refresh has
 * expired - must still open TargetX and read their attendance. There is no
 * screen behind this.
 */

export interface Session {
  accessToken: string;
  /** Unix seconds, or null when the provider declined to say. */
  expiresAt: number | null;
  name: string | null;
  email: string | null;
  /**
   * The avatar, already inlined as a `data:` URI by the Rust side.
   *
   * Never the provider's https URL. The app's `img-src` is `'self' data:` and
   * stays that way: pointing the webview at Google's CDN would mean a request
   * to them every time the header drew, from an application that otherwise
   * needs no network at all.
   */
  avatar: string | null;
}

/**
 * Sign-in configuration.
 *
 * Both values are public by definition: the issuer is in every token, and a
 * PKCE client id is not a secret - that is the entire point of PKCE. They are
 * build-time settings rather than constants so a fork can point at its own
 * provider without editing source.
 */
const ISSUER = String(import.meta.env.VITE_CLERK_ISSUER ?? "").trim();
const CLIENT_ID = String(import.meta.env.VITE_CLERK_CLIENT_ID ?? "").trim();

/**
 * Scopes. Every one of these is here because something uses it.
 *
 * `openid` is what makes this an identity request at all, and `offline_access`
 * is what earns a refresh token - without it the student is signed out the
 * moment the access token expires, on every launch, forever.
 *
 * `profile` and `email` were dropped for a while because nothing displayed
 * them, and are back because the account menu now does: the signed-in name,
 * address and picture. That is the standard for the scope - ask for a claim
 * when something shows it, not in case something might.
 *
 * `public_metadata` and `private_metadata` are offered by the instance and are
 * never appropriate here.
 */
const SCOPES = "openid profile email offline_access";

const [session, setSession] = createSignal<Session | null>(null);
const [authBusy, setAuthBusy] = createSignal(false);
const [authError, setAuthError] = createSignal<string | null>(null);
export { authBusy, authError, session };

/** Whether this build was given a provider to talk to at all. */
export const authConfigured = (): boolean =>
  canSync() && ISSUER !== "" && CLIENT_ID !== "";

export const signedIn = (): boolean => session() !== null;

/**
 * The token to send to the Worker, or null.
 *
 * Expiry is checked with a minute of headroom, because a token that passes
 * here and expires in flight fails at the edge as a 401 that looks like a bug.
 * A null answer means "refresh or sign in", never "carry on without one".
 */
export function accessToken(): string | null {
  const s = session();
  if (!s) return null;
  if (s.expiresAt !== null && s.expiresAt - 60 <= Date.now() / 1000) return null;
  return s.accessToken;
}

interface RawSession {
  access_token: string;
  expires_at: number | null;
  name: string | null;
  email: string | null;
  avatar: string | null;
}

const adopt = (raw: RawSession | null): Session | null => {
  if (!raw) return null;
  const next: Session = {
    accessToken: raw.access_token,
    expiresAt: raw.expires_at ?? null,
    name: raw.name ?? null,
    email: raw.email ?? null,
    avatar: raw.avatar ?? null,
  };
  setSession(next);
  return next;
};

/**
 * Sign in through the system browser.
 *
 * Two calls, not one: Rust must bind the loopback port and open the browser
 * before anything can wait on the callback, and `oauth_finish` then blocks for
 * as long as the student takes. Splitting them is what lets the UI show that it
 * is waiting rather than appearing to hang.
 */
export async function signIn(): Promise<Session | null> {
  if (!authConfigured()) {
    setAuthError("Sign-in is not configured in this build.");
    return null;
  }
  setAuthBusy(true);
  setAuthError(null);
  try {
    await invoke<{ authorize_url: string }>("oauth_begin", {
      issuer: ISSUER, clientId: CLIENT_ID, scopes: SCOPES,
    });
    return adopt(await invoke<RawSession>("oauth_finish"));
  } catch (exc) {
    setAuthError(exc instanceof Error ? exc.message : String(exc));
    return null;
  } finally {
    setAuthBusy(false);
  }
}

/**
 * Restore a session at launch from the stored refresh token, without a browser.
 *
 * Silent about every failure. This runs unasked, and a student who is not
 * signed in is in a normal state, not a broken one - telling them about it on
 * every launch would be nagging them to sign in to a feature they may not want.
 */
export async function resumeAccount(): Promise<Session | null> {
  if (!authConfigured()) return null;
  try {
    return adopt(await invoke<RawSession | null>("oauth_resume", {
      issuer: ISSUER, clientId: CLIENT_ID,
    }));
  } catch {
    return null;
  }
}

/**
 * Forget the account on this machine.
 *
 * The in-memory session is dropped even if the vault refuses, because the
 * student asked to be signed out and the token in this process is the one that
 * could still be used.
 */
export async function signOut(): Promise<void> {
  setSession(null);
  setAuthError(null);
  try {
    await invoke<void>("oauth_sign_out");
  } catch { /* nothing left to do; the session is already gone from memory */ }
}
