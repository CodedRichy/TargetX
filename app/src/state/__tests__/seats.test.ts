// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The seat counter, client half.
 *
 * The tests that matter are the ones asserting nothing is shown. A "spots
 * left" figure is trivially turned into a dark pattern - invent it, freeze it,
 * or keep showing the last one you saw after the network went - and none of
 * those are visible from outside the app. So each case below is one way the
 * truth could go missing, and every one of them must produce no line at all
 * rather than a number a student would believe.
 */

const load = async (endpoint = "https://w.example/ask") => {
  vi.resetModules();
  vi.stubEnv("VITE_ASK_ENDPOINT", endpoint);
  return import("../seats");
};

const served = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("reading the count", () => {
  it("takes all three figures from the server", async () => {
    served({ taken: 37, cap: 100, left: 63 });
    const { checkSeats, seats } = await load();
    expect(await checkSeats()).toEqual({ taken: 37, cap: 100, left: 63 });
    expect(seats()).toEqual({ taken: 37, cap: 100, left: 63 });
  });

  it("asks the /seats sibling of the ask endpoint", async () => {
    // Same origin by construction, which is what keeps it inside the app's
    // connect-src without a second entry in the policy.
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ taken: 1, cap: 100, left: 99 }) }));
    vi.stubGlobal("fetch", spy);
    const { checkSeats } = await load("https://targetx-ask.example.dev/ask");
    await checkSeats();
    const [url] = spy.mock.calls[0] as unknown as [string];
    expect(url).toBe("https://targetx-ask.example.dev/seats");
  });

  it("does not recompute what is left", async () => {
    // If the server and the client ever disagree about how full the instance
    // is, the server is the one that knows. Deriving `left` here would make
    // the app quietly authoritative about someone else's ceiling.
    served({ taken: 90, cap: 100, left: 0 });
    const { checkSeats } = await load();
    expect((await checkSeats())?.left).toBe(0);
  });
});

describe("refusing to show a number it did not read", () => {
  const bad: Array<[string, unknown]> = [
    ["a missing count", { cap: 100, left: 63 }],
    ["a missing cap", { taken: 37, left: 63 }],
    ["a missing remainder", { taken: 37, cap: 100 }],
    ["figures sent as strings", { taken: "37", cap: "100", left: "63" }],
    ["a negative remainder", { taken: 137, cap: 100, left: -37 }],
    ["a cap of zero", { taken: 0, cap: 0, left: 0 }],
    ["an error body", { error: "unavailable" }],
    ["a null body", null],
  ];

  for (const [name, body] of bad) {
    it(`shows nothing for ${name}`, async () => {
      served(body);
      const { checkSeats, seats } = await load();
      expect(await checkSeats()).toBeNull();
      expect(seats()).toBeNull();
    });
  }

  it("shows nothing when the worker is down", async () => {
    served({ error: "unavailable" }, false);
    const { checkSeats } = await load();
    expect(await checkSeats()).toBeNull();
  });

  it("shows nothing when the network is gone", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const { checkSeats } = await load();
    expect(await checkSeats()).toBeNull();
  });

  it("shows nothing when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => { throw new Error("not json"); },
    })));
    const { checkSeats } = await load();
    expect(await checkSeats()).toBeNull();
  });

  it("asks nothing at all in a build with no endpoint", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const { checkSeats } = await load("");
    expect(await checkSeats()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("keeps the last figure rather than replacing it with a failure", async () => {
    // A failed refresh must not blank a number that was true a moment ago,
    // and must not overwrite it with a worse one either.
    served({ taken: 37, cap: 100, left: 63 });
    const { checkSeats, seats } = await load();
    await checkSeats();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await checkSeats()).toBeNull();
    expect(seats()).toEqual({ taken: 37, cap: 100, left: 63 });
  });
});

describe("the line a student reads", () => {
  it("says nothing when there is no figure", async () => {
    const { seatsLine } = await load();
    expect(seatsLine(null)).toBeNull();
  });

  it("counts down plainly, with no urgency added", async () => {
    const { seatsLine } = await load();
    const line = seatsLine({ taken: 37, cap: 100, left: 63 });
    expect(line).toBe("63 of 100 spots left.");
    // The whole difference between this and a dark pattern is that the figure
    // is measured and the sentence around it is flat.
    expect(line).not.toMatch(/!|hurry|only|last chance|fast|now/i);
  });

  it("gets the grammar right at one", async () => {
    const { seatsLine } = await load();
    expect(seatsLine({ taken: 99, cap: 100, left: 1 })).toBe("1 of 100 spots left.");
  });

  it("says it is full rather than offering a button that fails", async () => {
    const { seatsLine } = await load();
    expect(seatsLine({ taken: 100, cap: 100, left: 0 })).toBe("All 100 spots are taken.");
  });
});
