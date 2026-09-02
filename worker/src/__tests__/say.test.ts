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

describe("a quantity about the student is a claim; a quantity in advice is not", () => {
  it.each([
    "You are at 78% in that subject.",
    "You can miss 3 more classes.",
    "Your CGPA is 8.2.",
    "You are at seventy five percent there.",
    "You can miss three more classes before it costs you.",
    "About half your attendance marks are gone.",
    "That subject is down to sixty percent.",
    "You need forty marks in the final.",
    "Two of your subjects are short on attendance.",
  ])("drops %j - it states a figure about this student", (text) => {
    // The engine prints the real number directly underneath this sentence.
    // A figure from the model is at best redundant and at worst a
    // contradiction the student has to resolve.
    expect(cleanSay(text)).toBeUndefined();
  });

  it.each([
    "Aim for two passes over the syllabus rather than one slow read.",
    "Most people find the first three chapters carry the rest.",
    "Give it thirty minutes a day and it stops being frightening.",
    "Start with whatever is closest to a deadline.",
    "Try working problems rather than reading them.",
  ])("keeps %j - it is advice, not a claim about them", (text) => {
    // Banning every number caught both cases, and that was the easy rule
    // rather than the right one: it left the assistant unable to give
    // ordinary advice without sounding like it was dodging something.
    expect(cleanSay(text)).toBe(text);
  });

  it("rejects a decimal anywhere, because advice does not have decimals", () => {
    expect(cleanSay("Try for 7.5 hours a week.")).toBeUndefined();
  });

  it("rejects a percent sign anywhere", () => {
    expect(cleanSay("Even 10% more effort compounds.")).toBeUndefined();
  });

  it("keeps a sentence that refers to a quantity without naming one", () => {
    const text = "Your attendance in that subject is the thing to watch.";
    expect(cleanSay(text)).toBe(text);
  });

  it.each([
    "Microcontrollers is the one to focus on - it is the only subject showing a shortage.",
    "That is the one where your attendance needs watching.",
    "No one enjoys that subject, but the marks there are gettable.",
  ])("keeps %j - \"one\" is a pronoun there, not a count", (text) => {
    // Observed live: an answer naming which subject to focus on was thrown
    // away, because a pronoun and a record word shared a sentence. English
    // uses "one" as a pronoun far more often than as a count, and treating
    // every instance as a quantity cost the assistant its best sentences.
    expect(cleanSay(text)).toBe(text);
  });

  it.each([
    "One more class and you lose the mark.",
    "You can afford one absence there.",
    "One of your subjects is short.",
  ])("still drops %j - there it IS counting", (text) => {
    expect(cleanSay(text)).toBeUndefined();
  });

  it("catches a number separated from the record word by a few words", () => {
    // Proximity is the whole mechanism, so the reach is asserted rather than
    // left to whatever the constant happens to be.
    expect(cleanSay("You have three of them left in that class."))
      .toBeUndefined();
  });
});

describe("what else it may not do", () => {
  it("drops a link, which is somewhere nobody here has vetted", () => {
    expect(cleanSay("See https://example.com for the rules.")).toBeUndefined();
    expect(cleanSay("Check www.ktu.edu.in.")).toBeUndefined();
  });

  it("drops anything past what advice needs", () => {
    expect(cleanSay("a".repeat(601))).toBeUndefined();
    expect(cleanSay("a".repeat(600))).toBe("a".repeat(600));
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
