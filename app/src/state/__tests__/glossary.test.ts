import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_CONDONE, ATTENDANCE_MARK_BANDS, ATTENDANCE_MARK_MAX,
  ATTENDANCE_MIN, DL_CAP_PCT, ESE_PASS_FRACTION,
} from "../../engine";
import { ALL_FACTS, CAPABILITIES, TERMS, lookupCapability, lookupTerm } from "../glossary";
import { defineFor, detectTopic } from "../answers";

/**
 * The definitions, and the misfires they replaced.
 *
 * "What is condonation" contains no explainer verb, so the topic detector read
 * it as an eligibility question and answered with the student's own attendance
 * budget - a confident reply to a question nobody asked. These assert both
 * halves: the definition is returned, and the wrong figure is not.
 */

describe("a definition is returned for a question about a word", () => {
  it.each([
    ["what is condonation", "Condonation"],
    ["what is duty leave", "Duty leave"],
    ["what does ese mean", "ESE"],
    ["what is cie", "CIE"],
    ["whats the difference between sgpa and cgpa", "SGPA and CGPA"],
    ["explain debarred", "Debarred"],
  ])("answers %j with %s", (q, name) => {
    expect(defineFor(q)?.headline).toBe(name);
  });

  it("prefers the longest matching alias", () => {
    // "duty leave" must not lose to "dl", and "sgpa and cgpa" must not lose to
    // the bare "sgpa" entry.
    expect(lookupTerm("what is duty leave")?.name).toBe("Duty leave");
    expect(lookupTerm("what is the difference between sgpa and cgpa")?.name)
      .toBe("SGPA and CGPA");
  });

  it("marks a definition as one, so it is not read as a computed figure", () => {
    // "Condonation is available down to 60%" is the regulation. Presented like
    // the student's own numbers it would read as something worked out for them.
    expect(defineFor("what is condonation")?.isDefinition).toBe(true);
  });
});

describe("a question about the student is not a definition", () => {
  it.each([
    "what is my attendance",
    "whats my cgpa",
    "what do i need to pass",
    "how many classes can i miss",
  ])("declines %j so the engine answers it instead", (q) => {
    // One word apart from a definitional question, and a completely different
    // kind of answer.
    expect(defineFor(q)).toBeNull();
    expect(detectTopic(q)).not.toBeNull();
  });

  it("returns nothing for a word the glossary does not hold", () => {
    expect(defineFor("what is a placement drive")).toBeNull();
    expect(defineFor("what is the capital of france")).toBeNull();
  });
});

describe("the misfires are dead", () => {
  it.each([
    "what is duty leave",
    "what is condonation",
  ])("no longer answers %j with a figure about the student", (q) => {
    // Both used to return an attendance budget. The definition path claims
    // them first, and the topic detector must not be reached.
    expect(defineFor(q)).not.toBeNull();
  });
});

describe("every figure quoted is the constant the engine calculates with", () => {
  const body = (name: string) => TERMS.find((t) => t.name === name)!.body;

  it("quotes the eligibility floor rather than a literal", () => {
    expect(body("Shortage")).toContain(`${ATTENDANCE_MIN}%`);
    expect(body("Condonation")).toContain(`${ATTENDANCE_CONDONE}%`);
  });

  it("quotes the duty leave cap rather than a literal", () => {
    expect(body("Duty leave")).toContain(`${DL_CAP_PCT}%`);
  });

  it("quotes the attendance band table rather than a literal", () => {
    const text = body("Attendance marks");
    expect(text).toContain(`${ATTENDANCE_MARK_MAX} CIE marks`);
    // The top band's percentage and its mark, read off the table itself - the
    // drawer used to write "85% earns 5" out by hand in the one panel whose
    // job is teaching the rule.
    expect(text).toContain(`${ATTENDANCE_MARK_BANDS[0]![0]}% earns ${ATTENDANCE_MARK_BANDS[0]![1]}`);
  });

  it("quotes the separate ESE minimum rather than a literal", () => {
    const pct = Math.round(ESE_PASS_FRACTION * 100);
    expect(TERMS.some((t) => t.name.includes(`${pct}%`))).toBe(true);
  });

  it("has no term whose aliases are empty, since it could never be found", () => {
    for (const term of TERMS) expect(term.aliases.length).toBeGreaterThan(0);
  });
});

/**
 * Questions about the app, which are the ones nothing could answer.
 *
 * These shipped once with no test and were dead on arrival: a heredoc turned
 * every `\b` in the HOWTO patterns into a literal backspace byte, so the regexes
 * read as `/^Hhow (?:do|can|does|often)^H/` and matched nothing at all. The file
 * looked correct in every editor, because a terminal renders 0x08 as nothing.
 * Six capability entries, reachable by no phrasing, and the only thing that
 * would have caught it is an assertion that a real question finds one.
 */
describe("a question about the app is answered by the app", () => {
  it.each([
    ["what can this app do", "What TargetX does"],
    ["where does this data come from", "Where the data comes from"],
    ["how do i import my grade card", "Importing a grade card"],
    ["is my password stored", "Whether your password is stored"],
    ["how do i back up my data", "Backing up"],
    ["how often does it sync", "How often it syncs"],
  ])("answers %j with %s", (q, name) => {
    expect(defineFor(q)?.headline).toBe(name);
  });

  it("is reached by a possessive phrasing, which the term lookup refuses", () => {
    // "How do I import MY grade card" is first-person and is still not a
    // question about this student's record. `lookupTerm` rejects it twice over
    // - not definitional, and possessive - which is why capabilities need
    // their own matcher rather than a looser guard on the shared one.
    expect(lookupTerm("how do i import my grade card")).toBeNull();
    expect(lookupCapability("how do i import my grade card")).not.toBeNull();
  });

  it("every capability is reachable by at least one of its own aliases", () => {
    // The assertion the backspace bug needed. A phrasing built from the entry
    // itself, so adding a capability with an unmatchable alias fails here.
    for (const cap of CAPABILITIES) {
      const alias = cap.aliases[0]!;
      expect(lookupCapability(`what is ${alias}`), cap.name).not.toBeNull();
    }
  });

  it("declines a question that is not about the app", () => {
    expect(lookupCapability("what is the capital of france")).toBeNull();
    expect(lookupCapability("import")).toBeNull(); // No question in it at all.
  });

  it("does not let a capability claim a question about the student", () => {
    // "what is my attendance" reads as a HOWTO phrasing and must still reach
    // the engine, or a student asking for a figure gets a paragraph.
    expect(defineFor("what is my attendance")).toBeNull();
    expect(detectTopic("what is my attendance")).toBe("attendance_now");
  });

  it("has no fact whose body is shorter than a sentence", () => {
    for (const fact of ALL_FACTS) {
      expect(fact.body.length, fact.name).toBeGreaterThan(40);
    }
  });
});
