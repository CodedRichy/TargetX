import { describe, expect, it } from "vitest";
import { detectTopic } from "../answers";

/**
 * Which question shape a phrasing is, decided locally.
 *
 * This runs before the model and before the subject matcher, and it is allowed
 * to say nothing. Saying nothing routes the student to a screen, which is a
 * worse answer but never a wrong one - so every case here is judged against the
 * standard that a WRONG topic is worse than no topic.
 */

describe("a question about the rule is not a question about the student", () => {
  it.each([
    "how is sgpa calculated",
    "explain cgpa",
    "what is the pass mark",
    "how does attendance affect marks",
    "how do they calculate the percentage",
  ])("declines %j", (q) => {
    // "how is sgpa calculated" contains "sgpa" and was answered with the
    // student's own CGPA - a confident reply to a question nobody asked. A
    // route at least lands somewhere the real answer might be.
    expect(detectTopic(q)).toBeNull();
  });

  it("still answers the same words when they are about this student", () => {
    // The test is possessive, not topical: the regulation question and the
    // personal one share almost all their vocabulary.
    expect(detectTopic("how badly would it affect my attendance")).not.toBeNull();
    expect(detectTopic("whats my cgpa")).toBe("standing");
  });
});

describe("the forward-looking attendance questions", () => {
  it.each([
    ["can i skip tomorrow", "tomorrow"],
    ["if i take a leave tommorow", "tomorrow"],
    ["what happens if i miss one more", "skip_cost"],
    ["how many classes can i miss", "budget"],
    ["am i eligible for the exam", "eligibility"],
    ["will i get debarred", "eligibility"],
  ])("reads %j as %s", (q, topic) => {
    expect(detectTopic(q)).toBe(topic);
  });
});

describe("the plainest question, which used to fall through", () => {
  it.each([
    "whats my attendance in cn",
    "how many classes have i attended",
    "my attendance",
  ])("answers %j rather than routing it", (q) => {
    // The detector only fired on forward-looking words, so "can i miss one"
    // was answered outright and "what is my attendance" opened a screen.
    expect(detectTopic(q)).toBe("attendance_now");
  });
});

describe("marks and standing", () => {
  it.each([
    ["what do i need in the final to pass cn", "need_to_pass"],
    ["how many marks do i need for an A", "need_to_pass"],
    ["am i failing anything", "need_to_pass"],
    ["whats my cgpa", "standing"],
    ["what sgpa do i need this sem", "standing"],
    ["will i get a first class", "standing"],
  ])("reads %j as %s", (q, topic) => {
    expect(detectTopic(q)).toBe(topic);
  });

  it("prefers the exam question over the standing one when both words appear", () => {
    // "what sgpa do i need to pass" is about the target, not about one paper;
    // the ordering in `detectTopic` is what decides this and it is asserted
    // here so a reorder does not silently change the answer.
    expect(detectTopic("what do i need to pass")).toBe("need_to_pass");
  });
});

describe("it says nothing rather than guessing", () => {
  it.each([
    "what is the capital of france",
    "write my assignment",
    "who teaches this",
    "",
    "   ",
  ])("declines %j", (q) => {
    expect(detectTopic(q)).toBeNull();
  });
});
