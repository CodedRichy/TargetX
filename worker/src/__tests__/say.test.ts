/**
 * The assistant may have a voice. It may never have a number.
 *
 * `say` is the one free-text field in a contract that is otherwise entirely
 * enums, and it exists because an assistant with nowhere to write a sentence
 * could not say what it was - observed live, twice, before it was added. What
 * pays for it is this file: the schema cannot express "a sentence containing
 * no figure", so the check is code, and code is testable.
 *
 * TargetX's whole position is that it never states a number it cannot show the
 * working for. Every case below is a way that promise could be broken by a
 * sentence rather than by a calculation.
 */
import { describe, expect, it } from "vitest";
import { cleanSay, parseAction } from "../schema";

const CODES = new Set(["CST305"]);

describe("a sentence may not name a quantity", () => {
  it.each([
    "You are at 78% in that subject.",
    "You can miss 3 more classes.",
    "Your CGPA is 8.2.",
  ])("drops %j for its digits", (text) => {
    expect(cleanSay(text)).toBeUndefined();
  });

  it.each([
    "You are at seventy five percent there.",
    "You can miss three more before it costs you.",
    "About half your attendance marks are gone.",
    "That subject is down to sixty percent.",
  ])("drops %j for spelling the number out", (text) => {
    // Banning digits alone would be a rule about typography. "Seventy five
    // percent" asserts a figure exactly as much as "75%", and a model told
    // not to use digits will reach for it.
    expect(cleanSay(text)).toBeUndefined();
  });

  it("keeps a sentence that refers to a quantity without naming one", () => {
    const text = "Your attendance in that subject is the thing to watch.";
    expect(cleanSay(text)).toBe(text);
  });
});

describe("what else it may not do", () => {
  it("drops a link, which is somewhere nobody here has vetted", () => {
    expect(cleanSay("See https://example.com for the rules.")).toBeUndefined();
    expect(cleanSay("Check www.ktu.edu.in.")).toBeUndefined();
  });

  it("drops anything past two sentences' worth", () => {
    expect(cleanSay("a".repeat(241))).toBeUndefined();
    expect(cleanSay("a".repeat(240))).toBe("a".repeat(240));
  });

  it("flattens control characters and padding rather than rejecting them", () => {
    // A model padding a short answer with newlines is not misbehaving, it is
    // formatting. The layout is what would break.
    expect(cleanSay("  Padded\n\nacross\tlines. ")).toBe("Padded across lines.");
  });

  it.each([undefined, null, 42, {}, ["a"], ""])("drops %j", (raw) => {
    expect(cleanSay(raw)).toBeUndefined();
  });
});

describe("a bad sentence costs the sentence, not the route", () => {
  it("keeps routing when the model states a figure it should not", () => {
    // The model has still done the useful half. The student gets the screen
    // and no commentary, which is exactly what they got before `say` existed.
    const action = parseAction(
      { kind: "subject", code: "CST305", view: "attendance", say: "You are at 78%." },
      CODES,
    );
    expect(action).toEqual({ kind: "subject", code: "CST305", view: "attendance" });
  });

  it("carries a clean sentence through on every kind of action", () => {
    // Note what this sentence cannot contain: "that ONE lives on the
    // attendance screen" is rejected, because "one" is a number word and the
    // ban does not try to guess whether this particular use is a quantity.
    // Over-blocking costs a sentence; under-blocking costs the promise.
    const say = "That lives on the attendance screen.";
    expect(parseAction({ kind: "view", view: "attendance", say }, CODES))
      .toEqual({ kind: "view", view: "attendance", say });
    expect(parseAction({ kind: "none", reason: "off_topic", say }, CODES))
      .toEqual({ kind: "none", reason: "off_topic", say });
  });

  it("still rejects an invented course code, sentence or no sentence", () => {
    expect(parseAction(
      { kind: "subject", code: "MADEUP", view: "ledger", say: "Here you go." },
      CODES,
    )).toBeNull();
  });
});
