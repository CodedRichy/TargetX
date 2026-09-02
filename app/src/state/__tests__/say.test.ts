/**
 * The number ban, enforced again in the binary the student runs.
 *
 * The worker checks this too, and that is not redundancy. The worker can be
 * redeployed tomorrow without a single app changing; the app ships to a
 * student and then stays exactly as it is for months. "TargetX never states a
 * number it cannot show the working for" is a promise made by the thing on
 * their machine, so the thing on their machine is where it has to hold.
 */
import { describe, expect, it } from "vitest";
import { cleanSay, parseReply } from "../ask";

describe("the app does not trust the worker to have checked", () => {
  it.each([
    "You are at 78% in that subject.",
    "You can miss three more classes.",
    "About half your attendance marks are gone.",
    "See https://example.com.",
  ])("drops %j even though the worker should have", (say) => {
    expect(cleanSay(say)).toBeUndefined();
  });

  it("keeps a sentence that names no quantity", () => {
    const say = "Your attendance there is the thing to watch.";
    expect(cleanSay(say)).toBe(say);
  });
});

describe("a dropped sentence never costs the route", () => {
  it("still navigates when the reply states a figure", () => {
    const out = parseReply({
      action: { kind: "view", view: "attendance", say: "You are at 78%." },
      remaining: 12,
    });
    expect(out).toEqual({
      ok: true, action: { kind: "view", view: "attendance", say: undefined },
      remaining: 12,
    });
  });

  it("carries a clean sentence through a refusal, which is where it matters most", () => {
    // A refusal is the one reply with no screen behind it. Before `say` this
    // was a canned string, and a canned string is what made the assistant
    // read as a lookup table rather than as something that had understood.
    const say = "TargetX does not hold fee records, so nothing here can answer that.";
    const out = parseReply({ action: { kind: "none", reason: "off_topic", say }, remaining: 3 });
    expect(out).toMatchObject({ ok: true, action: { kind: "none", say } });
  });
});
