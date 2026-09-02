import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATALOGUE_URL } from "../../engine/catalogue";

/**
 * The content security policy, checked against what the app actually fetches.
 *
 * This exists because of a shipped defect that no other test could see. The
 * question box was built, wired, signed in and deployed, and every request it
 * made failed - because `connect-src` listed `'self'` and GitHub and nothing
 * else, so the webview refused to open a connection to the Worker before one
 * was ever attempted. The fetch throws a plain TypeError, `ask.ts` cannot tell
 * that apart from a dead network, and the student is told they are offline
 * while sitting on a working connection.
 *
 * Nothing in the unit tests could catch it: they mock `fetch`, and a mock is
 * not subject to a policy. Nothing in the build could catch it either - the
 * policy is valid, it is simply wrong. So the two halves are compared here:
 * every URL the FRONTEND fetches must be permitted by the policy the app
 * ships with.
 *
 * Note what is deliberately absent. Signing in talks to Clerk, but through
 * `invoke` and the Rust side, which is not subject to the webview's policy -
 * which is exactly why sign-in worked while asking did not, and why the two
 * failures did not look related. Clerk is not added here: a host that the
 * webview never contacts does not belong in its allowlist.
 */

const conf = JSON.parse(
  readFileSync(new URL("../../../src-tauri/tauri.conf.json", import.meta.url), "utf-8"),
) as { app: { security: { csp: Record<string, string> } } };

const connectSrc = conf.app.security.csp["connect-src"] ?? "";
const allowed = connectSrc.split(/\s+/).filter(Boolean);

/** The origin the app would call, as the policy would see it. */
const originOf = (url: string): string => new URL(url).origin;

describe("every host the frontend fetches is in connect-src", () => {
  it("allows the curriculum catalogue", () => {
    expect(allowed).toContain(originOf(CATALOGUE_URL));
  });

  it("allows the question router", () => {
    // Read from the build's own configuration when it is set, so a changed
    // endpoint fails here rather than silently in a student's copy. The
    // fallback is the production Worker, which is what ships when a developer
    // runs the suite without an `.env`.
    const endpoint = String(import.meta.env.VITE_ASK_ENDPOINT ?? "").trim()
      || "https://targetx-ask.rishipraseeth.workers.dev";
    expect(allowed).toContain(originOf(endpoint));
  });

  it("does not open the policy up to everything", () => {
    // A wildcard would make this file pass forever and mean nothing.
    expect(allowed).not.toContain("*");
    expect(connectSrc).not.toMatch(/https:\s*$|https:\s/);
  });
});

describe("the frontend fetches nothing this file has not accounted for", () => {
  it("makes exactly two kinds of request from the webview", () => {
    // A census on purpose: a third `fetch` is a third host, and the failure it
    // causes is invisible from inside the app. When this number changes, add
    // the host above rather than raising the count.
    const sources = [
      readFileSync(new URL("../actions.ts", import.meta.url), "utf-8"),
      readFileSync(new URL("../ask.ts", import.meta.url), "utf-8"),
      readFileSync(new URL("../auth.ts", import.meta.url), "utf-8"),
      readFileSync(new URL("../../engine/catalogue.ts", import.meta.url), "utf-8"),
    ].join("\n");
    const calls = sources.match(/\bfetch\s*\(/g) ?? [];
    expect(calls).toHaveLength(2);
  });
});
