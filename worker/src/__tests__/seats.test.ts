import { afterEach, describe, expect, it, vi } from "vitest";
import { countSeats } from "../seats";

/**
 * The seat counter, and the one promise that makes it publishable.
 *
 * A remaining-spots figure on a download page is, in the wrong hands, the
 * oldest trick on the internet: a number that is not measuring anything,
 * chosen to hurry someone. This one is real - Clerk's development instances
 * genuinely refuse the 101st user - and the only thing keeping it real is that
 * every path where the truth is unavailable returns nothing at all rather than
 * a plausible substitute.
 *
 * So the interesting tests here are the ones that assert an absence. Each null
 * below is a "3 spots left!" that never gets invented, and there is no way to
 * see from the outside whether the code guessed, which is exactly why they are
 * pinned rather than trusted.
 */

const env = { CLERK_SECRET_KEY: "sk_test_x", SEAT_CAP: "100" };

const clerk = (body: unknown, ok = true) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));

afterEach(() => vi.unstubAllGlobals());

describe("counting what is left", () => {
  it("reports taken, cap and the difference", async () => {
    clerk({ object: "total_count", total_count: 37 });
    expect(await countSeats(env)).toEqual({ taken: 37, cap: 100, left: 63 });
  });

  it("says none left rather than a negative number", async () => {
    // Clerk does not stop the world at exactly 100 - an instance can be over
    // its own cap after a limit change. "-4 spots left" is nonsense on a page;
    // zero is true and reads correctly.
    clerk({ total_count: 104 });
    expect(await countSeats(env)).toEqual({ taken: 104, cap: 100, left: 0 });
  });

  it("sends the secret key to Clerk and nowhere else", async () => {
    const spy = vi.fn(async () => ({ ok: true, json: async () => ({ total_count: 1 }) }));
    vi.stubGlobal("fetch", spy);
    await countSeats(env);

    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.clerk.com/v1/users/count");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_x");
  });
});

describe("refusing to invent a number", () => {
  it("says nothing when there is no cap configured", async () => {
    // This is the production instance's answer, not a failure: no ceiling
    // means no countdown, and the counter must vanish from both clients
    // without either of them being shipped again.
    clerk({ total_count: 5 });
    expect(await countSeats({ CLERK_SECRET_KEY: "sk_test_x" })).toBeNull();
    expect(await countSeats({ ...env, SEAT_CAP: "" })).toBeNull();
    expect(await countSeats({ ...env, SEAT_CAP: "unlimited" })).toBeNull();
    expect(await countSeats({ ...env, SEAT_CAP: "0" })).toBeNull();
  });

  it("says nothing when the key is missing, without asking Clerk", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await countSeats({ SEAT_CAP: "100" })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("says nothing when Clerk refuses the key", async () => {
    clerk({ errors: [{ message: "unauthorized" }] }, false);
    expect(await countSeats(env)).toBeNull();
  });

  it("says nothing when the count is not a number", async () => {
    clerk({ total_count: "37" });
    expect(await countSeats(env)).toBeNull();
  });

  it("says nothing when the field is absent", async () => {
    clerk({ object: "total_count" });
    expect(await countSeats(env)).toBeNull();
  });

  it("says nothing when the body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, json: async () => { throw new Error("not json"); },
    })));
    expect(await countSeats(env)).toBeNull();
  });

  it("says nothing when Clerk is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await countSeats(env)).toBeNull();
  });

  it("says nothing when the request is aborted", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    expect(await countSeats(env)).toBeNull();
  });
});
