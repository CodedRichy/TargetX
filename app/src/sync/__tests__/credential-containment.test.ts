// @vitest-environment jsdom
/**
 * Where a real portal password ends up after a whole sync.
 *
 * The URL rules next door cover how the credential travels. This covers where
 * it comes to rest, which is the question behind every "is it safe to type my
 * college password into this?" - and the one the app cannot answer with a
 * paragraph, only with a check.
 *
 * The password used below is a sentinel: it is searched for by value across
 * every outbound call, every error the sync can throw, the saved state, and
 * the export a student hands to someone else. It is allowed in exactly one
 * place - the POST body of the login form - and nowhere else at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SENTINEL = "correct-horse-battery-staple-9271";

interface Call { command: string; args: Record<string, unknown> }
const calls: Call[] = [];
let academicsBody = "";

const LOGIN_PAGE = `<html><head><title>Login</title></head><body>
  <form action="/user/login" method="post">
    <input type="hidden" name="YII_CSRF_TOKEN" value="abc123">
    <input type="text" name="LoginForm[username]">
    <input type="password" name="LoginForm[password]">
  </form></body></html>`;

const DASHBOARD = `<html><head><title>Student Dashboard</title></head><body>
  <a href="/ktuacademics/student/studentacademics">Academics</a></body></html>`;

const RECORD = `<html><head><title>Academics</title></head><body>
  <table><tr><td>Vth Semester</td><td>41/48 (85.4%)</td>
    <td>SGPA : 7.83 Earned Credit : 22 Cumulative Credit : 92 CGPA : 7.09</td></tr></table>
  <table>
    <tr><th>Subject</th><th>Attendance</th><th>Internal</th><th>Grade</th></tr>
    <tr><td>PCCST501 Computer Networks</td><td>41/48 (85.4%)</td><td>38</td><td>A</td></tr>
  </table></body></html>`;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    calls.push({ command, args });
    const path = String(args?.["path"] ?? args?.["url"] ?? "");
    if (command === "etlab_post") {
      return Promise.resolve({ url: "https://p.edu/user/login", status: 200, body: DASHBOARD });
    }
    if (command === "etlab_get") {
      if (path.includes("academics") || path.includes("results")) {
        return Promise.resolve({ url: `https://p.edu${path}`, status: 200, body: academicsBody });
      }
      if (path === "/" || path.includes("login")) {
        return Promise.resolve({ url: `https://p.edu${path}`, status: 200, body: LOGIN_PAGE });
      }
      return Promise.resolve({ url: `https://p.edu${path}`, status: 404, body: "" });
    }
    return Promise.resolve(null);
  },
}));

beforeEach(() => {
  calls.length = 0;
  academicsBody = RECORD;
  localStorage.clear();
  (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});
afterEach(() => { delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__; });

/** Every call except the one login POST, serialised. */
const trafficBesidesTheLoginPost = () => JSON.stringify(
  calls.filter((c) => c.command !== "etlab_post"));

describe("a password that has been through a whole sync", () => {
  it("is sent once, in the login POST, bound to the form's own field name", async () => {
    const { fullSync } = await import("../etlab");
    await fullSync("https://p.edu", "24CS999", SENTINEL);

    const posts = calls.filter((c) => c.command === "etlab_post");
    expect(posts).toHaveLength(1);
    const fields = posts[0]!.args["fields"] as Array<[string, string]>;
    expect(fields).toContainEqual(["LoginForm[password]", SENTINEL]);
    // The CSRF token the form carried goes with it; that is the point of
    // replaying hidden inputs verbatim.
    expect(fields).toContainEqual(["YII_CSRF_TOKEN", "abc123"]);
  });

  it("appears in no other call - not a path, not a query, not a later fetch", async () => {
    const { fullSync } = await import("../etlab");
    await fullSync("https://p.edu", "24CS999", SENTINEL);
    expect(trafficBesidesTheLoginPost()).not.toContain(SENTINEL);
  });

  it("is in neither the saved record nor the export a student hands over", async () => {
    const { fullSync } = await import("../etlab");
    const { applySync } = await import("../../state/actions");
    const { exportJson } = await import("../../state/actions");
    const { state } = await import("../../state/store");

    applySync(await fullSync("https://p.edu", "24CS999", SENTINEL));

    expect(JSON.stringify(state)).not.toContain(SENTINEL);
    expect(exportJson()).not.toContain(SENTINEL);
    expect(JSON.stringify(localStorage)).not.toContain(SENTINEL);
  });
});

describe("a password the student chose to remember", () => {
  // Issue #2 adds an opt-in credential store. It moves the password to exactly
  // one new resting place - the OS vault, reached through `cred_save` - which
  // is the credential-store equivalent of the login POST: the single sanctioned
  // exception. Everywhere the login POST is forbidden, the vault path must be
  // too. This extends the containment guarantee to cover it rather than
  // relaxing it.
  it("reaches the vault, and no forbidden place", async () => {
    const { saveCreds } = await import("../../state/creds");
    const { fullSync } = await import("../etlab");
    const { applySync, exportJson } = await import("../../state/actions");
    const { state } = await import("../../state/store");

    applySync(await fullSync("https://p.edu", "24CS999", SENTINEL));
    await saveCreds("https://p.edu", "24CS999", SENTINEL);

    // It did land in the vault write - that is the whole point of the feature.
    const saves = calls.filter((c) => c.command === "cred_save");
    expect(saves).toHaveLength(1);
    expect(JSON.stringify(saves[0]!.args)).toContain(SENTINEL);

    // And in none of the places the sync itself is forbidden to leave it.
    expect(JSON.stringify(state)).not.toContain(SENTINEL);
    expect(exportJson()).not.toContain(SENTINEL);
    expect(JSON.stringify(localStorage)).not.toContain(SENTINEL);
  });

  it("is never written to the vault as a side effect of syncing", async () => {
    // The store is opt-in. A plain sync must not call `cred_save` at all - the
    // password reaches the vault only when the student ticks the box, never
    // because they synced.
    const { fullSync } = await import("../etlab");
    const { applySync } = await import("../../state/actions");
    applySync(await fullSync("https://p.edu", "24CS999", SENTINEL));
    expect(calls.filter((c) => c.command === "cred_save")).toHaveLength(0);
  });
});

describe("a password that has been through a FAILED sync", () => {
  it("is not quoted back in the error the student is shown", async () => {
    // The failure path is where credentials leak: a message built by
    // interpolating what was tried is the ordinary way it happens.
    academicsBody = `<html><body><p>Nothing here</p></body></html>`;
    const { fullSync, EtlabError } = await import("../etlab");

    const thrown = await fullSync("https://p.edu", "24CS999", SENTINEL)
      .then(() => null, (exc: unknown) => exc);

    expect(thrown).toBeInstanceOf(EtlabError);
    const error = thrown as InstanceType<typeof EtlabError>;
    expect(error.message).not.toContain(SENTINEL);
    expect(error.diagnostic ?? "").not.toContain(SENTINEL);
    // Nor the username, which is a registration number.
    expect(error.message).not.toContain("24CS999");
  });
});
