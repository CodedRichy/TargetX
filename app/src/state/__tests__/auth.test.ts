/**
 * The account.
 *
 * What matters here is not the happy path - the flow itself lives in Rust and
 * is exercised there. What matters is that this module cannot become a way to
 * lock a student out of their own marks, and that it never hands the Worker a
 * token that is about to expire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("../../sync/etlab", () => ({ canSync: () => true }));

// Both are read at module load, so they have to be in place before the import.
// Neither is a secret: the issuer is in every token this app receives, and a
// PKCE client id is public by design - that is what PKCE is for.
vi.stubEnv("VITE_CLERK_ISSUER", "https://example.clerk.accounts.dev");
vi.stubEnv("VITE_CLERK_CLIENT_ID", "client_test");

const {
  accessToken, authConfigured, authError, resumeAccount, signIn, signOut, signedIn,
} = await import("../auth");

const soon = (secs: number) => Math.floor(Date.now() / 1000) + secs;

beforeEach(async () => {
  vi.clearAllMocks();
  invoke.mockResolvedValue(null);
  await signOut();
  vi.clearAllMocks();
});

describe("configuration", () => {
  it("is on when the build was given a provider", () => {
    expect(authConfigured()).toBe(true);
  });
});

describe("token freshness", () => {
  it("withholds a token that expires within the minute", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "oauth_begin" ? { authorize_url: "x" }
        : { access_token: "tok", expires_at: soon(30) });
    await signIn();

    expect(signedIn()).toBe(true);
    // Signed in, but this token would 401 at the edge mid-flight, and a 401
    // there looks like a bug rather than an expiry.
    expect(accessToken()).toBeNull();
  });

  it("hands over a token with room to spare", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "oauth_begin" ? { authorize_url: "x" }
        : { access_token: "tok", expires_at: soon(600) });
    await signIn();
    expect(accessToken()).toBe("tok");
  });

  it("trusts a provider that declined to give an expiry", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "oauth_begin" ? { authorize_url: "x" }
        : { access_token: "tok", expires_at: null });
    await signIn();
    expect(accessToken()).toBe("tok");
  });
});

describe("failure never locks anyone out", () => {
  it("reports a refused sign-in and leaves the app usable", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "oauth_begin") return { authorize_url: "x" };
      throw new Error("Sign-in timed out. The browser never came back.");
    });

    await expect(signIn()).resolves.toBeNull();
    expect(signedIn()).toBe(false);
    expect(authError()).toMatch(/timed out/);
  });

  it("says nothing at launch when there is no stored account", async () => {
    invoke.mockResolvedValue(null);
    expect(await resumeAccount()).toBeNull();
    // Not signed in is a normal state. Nagging on every launch is not.
    expect(authError()).toBeNull();
  });

  it("stays quiet when a launch resume throws", async () => {
    invoke.mockRejectedValue(new Error("vault locked"));
    expect(await resumeAccount()).toBeNull();
    expect(authError()).toBeNull();
  });
});

describe("signing out", () => {
  it("drops the in-memory token even when the vault refuses", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "oauth_begin" ? { authorize_url: "x" }
        : { access_token: "tok", expires_at: soon(600) });
    await signIn();
    expect(accessToken()).toBe("tok");

    invoke.mockRejectedValue(new Error("vault locked"));
    await signOut();

    // The token in this process is the one that could still be used.
    expect(signedIn()).toBe(false);
    expect(accessToken()).toBeNull();
  });
});
