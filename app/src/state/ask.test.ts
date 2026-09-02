import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ask client.
 *
 * `ENDPOINT` is read at module scope from `import.meta.env`, so every test that
 * cares about it must stub the env BEFORE the dynamic import - a top-level
 * import would have already frozen the value. That is why this file imports
 * inside each test rather than at the top.
 */

const ENDPOINT = "https://worker.example.dev";

async function load(endpoint: string | undefined, token: string | null) {
  vi.resetModules();
  if (endpoint === undefined) vi.stubEnv("VITE_ASK_ENDPOINT", "");
  else vi.stubEnv("VITE_ASK_ENDPOINT", endpoint);
  vi.doMock("./auth", () => ({ accessToken: () => token }));
  return await import("./ask");
}

type FetchMock = (url: string, init: RequestInit) => Promise<Response>;

const reply = (body: unknown, status = 200) =>
  vi.fn<FetchMock>(async () => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  }));

/** The captured request, with the types the mock was declared with. */
const sent = (f: ReturnType<typeof reply>, i = 0) => {
  const call = f.mock.calls[i];
  if (!call) throw new Error("fetch was never called");
  return { url: call[0], init: call[1], body: JSON.parse(String(call[1].body)) };
};

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.doUnmock("./auth"); });

describe("askConfigured", () => {
  it("is false with no endpoint, so the palette never offers a route it cannot take", async () => {
    const { askConfigured } = await load(undefined, "t");
    expect(askConfigured()).toBe(false);
  });

  it("is true once an endpoint is built in", async () => {
    const { askConfigured } = await load(ENDPOINT, "t");
    expect(askConfigured()).toBe(true);
  });
});

describe("parseReply", () => {
  it("accepts a view route", async () => {
    const { parseReply } = await load(ENDPOINT, "t");
    expect(parseReply({ action: { kind: "view", view: "attendance" }, remaining: 7 }))
      .toEqual({ ok: true, action: { kind: "view", view: "attendance" }, remaining: 7 });
  });

  it("rejects a view the app does not have", async () => {
    const { parseReply } = await load(ENDPOINT, "t");
    expect(parseReply({ action: { kind: "view", view: "settings" } })).toBeNull();
  });

  it("defaults a subject's view rather than dropping a correct subject", async () => {
    const { parseReply } = await load(ENDPOINT, "t");
    const out = parseReply({ action: { kind: "subject", code: "CST301" }, remaining: 3 });
    expect(out).toEqual({
      ok: true, action: { kind: "subject", code: "CST301", view: "attendance" }, remaining: 3,
    });
  });

  it("narrows an unrecognised refusal reason instead of passing it through", async () => {
    const { parseReply } = await load(ENDPOINT, "t");
    const out = parseReply({ action: { kind: "none", reason: "because i said so" } });
    expect(out).toEqual({ ok: true, action: { kind: "none", reason: "unclear" }, remaining: 0 });
  });

  it("rejects anything that is not an action", async () => {
    const { parseReply } = await load(ENDPOINT, "t");
    expect(parseReply(null)).toBeNull();
    expect(parseReply({})).toBeNull();
    expect(parseReply({ action: "ledger" })).toBeNull();
    expect(parseReply({ action: { kind: "navigate", view: "ledger" } })).toBeNull();
  });

  it("treats a missing remaining as zero rather than NaN", async () => {
    const { parseReply } = await load(ENDPOINT, "t");
    const out = parseReply({ action: { kind: "view", view: "home" } });
    expect(out).toMatchObject({ remaining: 0 });
  });
});

describe("askRemote", () => {
  it("does not call out at all when no endpoint is built in", async () => {
    const { askRemote } = await load(undefined, "t");
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "unconfigured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not spend a request when there is no token", async () => {
    const { askRemote } = await load(ENDPOINT, null);
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "signin" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the question, the course list and a verdict - never a figure", async () => {
    const f = reply({ action: { kind: "view", view: "ledger" }, remaining: 9 });
    vi.stubGlobal("fetch", f);
    const { askRemote } = await load(ENDPOINT, "tok");
    await askRemote("where are my marks",
      [{ code: "CST301", name: "Formal Languages", status: "SHORTAGE" }]);

    const { url, init, body } = sent(f);
    expect(url).toBe(`${ENDPOINT}/ask`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    // The exact shape matters: anything extra here is an academic record
    // leaving the machine. `status` was added deliberately and is the ONLY
    // thing about the student's standing that goes - an assistant that cannot
    // see which subject is the problem can only give advice that fits any
    // student. It is a verdict, and a verdict carries no measurement.
    expect(Object.keys(body).sort()).toEqual(["history", "question", "subjects"]);
    expect(body.subjects).toEqual([
      { code: "CST301", name: "Formal Languages", status: "SHORTAGE" },
    ]);
  });

  it("sends no figure inside the verdict, whatever the engine computed", async () => {
    // The guard that matters: `status` must stay a member of a fixed set. A
    // future refactor that let a percentage or a mark ride along in this
    // field would break the privacy claim without breaking a type.
    const f = reply({ action: { kind: "view", view: "home" } });
    vi.stubGlobal("fetch", f);
    const { askRemote } = await load(ENDPOINT, "tok");
    await askRemote("how am i doing", [
      { code: "CST301", name: "Formal Languages", status: "SHORTAGE" },
      { code: "CST302", name: "Graph Theory", status: "SAFE" },
    ]);
    const subjects = sent(f).body.subjects as Array<Record<string, unknown>>;
    // Course codes have always contained digits; that is a name, not a
    // figure. What must hold is that a subject carries nothing BUT its
    // identity and a verdict from a fixed set.
    const KNOWN = ["SAFE", "TIGHT", "PENDING", "INCOMPLETE",
                   "SHORTAGE", "DEBARRED", "FAILED", "UNREACHABLE"];
    for (const s of subjects) {
      expect(Object.keys(s).sort()).toEqual(["code", "name", "status"]);
      expect(KNOWN).toContain(s.status);
      expect(String(s.status)).not.toMatch(/[0-9]/);
    }
  });

  it("carries the last few exchanges so a follow-up means something", async () => {
    const f = reply({ action: { kind: "none", reason: "no_match" } });
    vi.stubGlobal("fetch", f);
    const { askRemote } = await load(ENDPOINT, "tok");
    await askRemote("what about ML", [], undefined, [
      { question: "how is daa", answer: "It is the one to watch." },
      { question: "why", answer: "Attendance." },
    ]);
    expect(sent(f).body.history).toEqual([
      { question: "how is daa", answer: "It is the one to watch." },
      { question: "why", answer: "Attendance." },
    ]);
  });

  it("keeps only the last three exchanges", async () => {
    const f = reply({ action: { kind: "none", reason: "no_match" } });
    vi.stubGlobal("fetch", f);
    const { askRemote } = await load(ENDPOINT, "tok");
    await askRemote("and now", [], undefined,
      [1, 2, 3, 4, 5].map((n) => ({ question: `q${n}` })));
    expect(sent(f).body.history).toEqual([
      { question: "q3" }, { question: "q4" }, { question: "q5" },
    ]);
  });

  it("trims a question to the worker's cap instead of being rejected at the edge", async () => {
    const f = reply({ action: { kind: "none", reason: "unclear" } });
    vi.stubGlobal("fetch", f);
    const { askRemote } = await load(ENDPOINT, "tok");
    await askRemote("x".repeat(900), []);
    expect(sent(f).body.question).toHaveLength(400);
  });

  it("refuses an empty question without a round trip", async () => {
    const { askRemote } = await load(ENDPOINT, "tok");
    expect(await askRemote("   ", [])).toEqual({ ok: false, kind: "failed" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not double the slash when the endpoint has a trailing one", async () => {
    const f = reply({ action: { kind: "view", view: "home" } });
    vi.stubGlobal("fetch", f);
    const { askRemote } = await load(`${ENDPOINT}/`, "tok");
    await askRemote("q", []);
    expect(sent(f).url).toBe(`${ENDPOINT}/ask`);
  });

  it("maps 401 to a sign-in prompt, not a failure", async () => {
    vi.stubGlobal("fetch", reply({ error: "unauthorized" }, 401));
    const { askRemote } = await load(ENDPOINT, "stale");
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "signin" });
  });

  it("maps 429 to the quota state so the student is told they are out, not broken", async () => {
    vi.stubGlobal("fetch", reply({ error: "rate_limited" }, 429));
    const { askRemote } = await load(ENDPOINT, "tok");
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "limit" });
  });

  it("maps a thrown fetch to offline", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => { throw new TypeError("Failed to fetch"); }));
    const { askRemote } = await load(ENDPOINT, "tok");
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "offline" });
  });

  it("maps a 502 upstream failure to failed", async () => {
    vi.stubGlobal("fetch", reply({ error: "upstream" }, 502));
    const { askRemote } = await load(ENDPOINT, "tok");
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "failed" });
  });

  it("survives a 200 that is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => new Response("<html>proxy</html>", { status: 200 })));
    const { askRemote } = await load(ENDPOINT, "tok");
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "failed" });
  });

  it("survives a 200 whose action the app does not recognise", async () => {
    vi.stubGlobal("fetch", reply({ action: { kind: "delete_everything" } }));
    const { askRemote } = await load(ENDPOINT, "tok");
    expect(await askRemote("q", [])).toEqual({ ok: false, kind: "failed" });
  });

  it("caps the course list at the worker's limit", async () => {
    const f = reply({ action: { kind: "view", view: "home" } });
    vi.stubGlobal("fetch", f);
    const { askRemote } = await load(ENDPOINT, "tok");
    const many = Array.from({ length: 80 }, (_, i) => ({ code: `C${i}`, name: `Course ${i}` }));
    await askRemote("q", many);
    expect(sent(f).body.subjects).toHaveLength(60);
  });
});
