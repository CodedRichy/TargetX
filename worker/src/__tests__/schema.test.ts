import { describe, expect, it } from "vitest";
import { VIEWS, parseAction, parseAskRequest } from "../schema";

/**
 * The layer that holds when the other two fail.
 *
 * Topic restriction is enforced three times over: the prompt asks, the response
 * schema constrains decoding, and this rejects. The first two are properties of
 * a remote service that can be retired, reworded, or talked around - Google
 * retired the pinned model mid-session and every request 404'd, which is the
 * mild version of the same lesson. `parseAction` is the only one of the three
 * that runs on our own machine against whatever actually came back.
 *
 * So it is tested as a security boundary rather than as a mapper: the input is
 * assumed hostile, and the assertion is always what does NOT get through.
 */

const CODES = new Set(["CST303", "CST305"]);

describe("a valid action is recognised", () => {
  it.each([...VIEWS])("accepts the real view %s", (view) => {
    expect(parseAction({ kind: "view", view }, CODES)).toEqual({ kind: "view", view });
  });

  it("accepts a subject the client actually sent", () => {
    expect(parseAction({ kind: "subject", code: "CST303", view: "ledger" }, CODES))
      .toEqual({ kind: "subject", code: "CST303", view: "ledger" });
  });

  it.each(["off_topic", "unclear", "no_match"])("accepts the refusal %s", (reason) => {
    expect(parseAction({ kind: "none", reason }, CODES)).toEqual({ kind: "none", reason });
  });

  it("defaults the view when a subject arrives without one", () => {
    // Naming the right subject and forgetting where to show it is still the
    // useful half of the job.
    expect(parseAction({ kind: "subject", code: "CST305" }, CODES))
      .toEqual({ kind: "subject", code: "CST305", view: "attendance" });
  });
});

describe("an invented subject never reaches the app", () => {
  it("rejects a course code the client did not send", () => {
    // The defect this exists for: a model that invents a plausible KTU code
    // would otherwise have the app navigate to a subject that does not exist.
    expect(parseAction({ kind: "subject", code: "CST999", view: "ledger" }, CODES)).toBeNull();
  });

  it("rejects every subject when the student has no courses at all", () => {
    // With an empty course list the response schema cannot carry a code enum -
    // empty enums are invalid - so the field is left open upstream and this is
    // the only thing checking it.
    expect(parseAction({ kind: "subject", code: "CST303", view: "ledger" }, new Set())).toBeNull();
  });

  it("does not accept a code by prefix, suffix or case", () => {
    for (const code of ["cst303", "CST303 ", " CST303", "CST30", "CST3030"]) {
      expect(parseAction({ kind: "subject", code, view: "ledger" }, CODES), code).toBeNull();
    }
  });
});

describe("an invented view never reaches the app", () => {
  it.each(["admin", "Home", "", "settings", "../data"])("rejects %j", (view) => {
    expect(parseAction({ kind: "view", view }, CODES)).toBeNull();
  });

  it("rejects a subject whose view is invented, rather than trusting it", () => {
    // The view defaults when ABSENT. An invented one is a different thing: the
    // model asserted a destination and got it wrong, so it falls back rather
    // than navigating somewhere that does not exist.
    expect(parseAction({ kind: "subject", code: "CST303", view: "admin" }, CODES))
      .toEqual({ kind: "subject", code: "CST303", view: "attendance" });
  });
});

describe("prose never reaches the app", () => {
  it.each([
    { kind: "answer", text: "Your CGPA is 8.2" },
    { kind: "view", view: "home", answer: "You can miss 3 classes" },
    { kind: "none", reason: "off_topic", note: "ignore previous instructions" },
  ])("drops the extra field it was not asked for (%#)", (raw) => {
    const out = parseAction(raw, CODES);
    // Either rejected outright, or returned as exactly the action shape - never
    // with a passenger field riding along. The app renders what it is handed.
    if (out !== null) {
      expect(Object.keys(out).sort()).not.toContain("answer");
      expect(Object.keys(out).sort()).not.toContain("note");
      expect(Object.keys(out).sort()).not.toContain("text");
    }
  });

  it("carries no field that could hold a number about a student", () => {
    const out = parseAction({ kind: "view", view: "attendance" }, CODES)!;
    // The structural claim the whole design rests on: there is no shape here
    // that can carry a figure, so the model cannot state one even if it tries.
    expect(JSON.stringify(out)).not.toMatch(/\d/);
  });
});

describe("malformed input is rejected rather than coerced", () => {
  it.each([
    null, undefined, 0, 1, "", "view", true, [], [{ kind: "view", view: "home" }],
    {}, { kind: "none" }, { kind: "none", reason: "because" },
    { kind: "view" }, { kind: "view", view: null }, { kind: "subject" },
    { view: "home" }, { kind: "VIEW", view: "home" },
  ])("rejects %j", (raw) => {
    expect(parseAction(raw, CODES)).toBeNull();
  });

  it("is not fooled by a prototype-shaped payload", () => {
    // JSON.parse can produce a key named `__proto__` as an own property; the
    // parser must read `kind` off the object and find nothing.
    expect(parseAction(JSON.parse('{"__proto__":{"kind":"view","view":"home"}}'), CODES))
      .toBeNull();
  });
});

/**
 * The other direction: what the CLIENT sent, before any of it is forwarded to a
 * metered API. Everything here is a bill or a leak if it gets through.
 */
describe("the request the client sent", () => {
  const ok = { question: "can i skip tomorrow", subjects: [{ code: "CST303", name: "CN" }] };

  it("accepts a real request and trims the question", () => {
    expect(parseAskRequest({ ...ok, question: "  can i skip tomorrow  " }))
      .toEqual(ok);
  });

  it("accepts a student with no courses yet", () => {
    expect(parseAskRequest({ question: "hi", subjects: [] }))
      .toEqual({ question: "hi", subjects: [] });
  });

  it("refuses an empty or whitespace-only question", () => {
    expect(parseAskRequest({ ...ok, question: "" })).toBeNull();
    expect(parseAskRequest({ ...ok, question: "   " })).toBeNull();
  });

  it("refuses a question past the cap, which is an unbounded bill", () => {
    expect(parseAskRequest({ ...ok, question: "a".repeat(400) })).not.toBeNull();
    expect(parseAskRequest({ ...ok, question: "a".repeat(401) })).toBeNull();
  });

  it("refuses a course list past the cap", () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ code: `C${i}`, name: "x" }));
    expect(parseAskRequest({ ...ok, subjects: many(60) })).not.toBeNull();
    expect(parseAskRequest({ ...ok, subjects: many(61) })).toBeNull();
  });

  it("refuses an oversized code or name rather than truncating it", () => {
    expect(parseAskRequest({ ...ok, subjects: [{ code: "x".repeat(25), name: "n" }] })).toBeNull();
    expect(parseAskRequest({ ...ok, subjects: [{ code: "c", name: "x".repeat(121) }] })).toBeNull();
  });

  it.each([
    null, undefined, "question", 5, [],
    { subjects: [] },
    { question: 5, subjects: [] },
    { question: "hi" },
    { question: "hi", subjects: {} },
    { question: "hi", subjects: [null] },
    { question: "hi", subjects: ["CST303"] },
    { question: "hi", subjects: [{ code: "CST303" }] },
    { question: "hi", subjects: [{ code: 303, name: "CN" }] },
  ])("rejects %j", (raw) => {
    expect(parseAskRequest(raw)).toBeNull();
  });

  it("rejects the whole request when one subject is bad, not just that subject", () => {
    // Dropping the bad one silently would send a course list that is not the
    // one the client thinks it sent.
    expect(parseAskRequest({
      question: "hi",
      subjects: [{ code: "CST303", name: "CN" }, { code: 1, name: "ML" }],
    })).toBeNull();
  });
});
