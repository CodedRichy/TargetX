import { describe, expect, it, vi } from "vitest";
import { logAsk, outcomeOf } from "../log";
import type { AskLog } from "../log";

/**
 * The log, and the two promises it makes.
 *
 * One: it never breaks a request. Analytics Engine is not on every plan, the
 * binding is optional, and a point can be rejected - none of which is a reason
 * to turn a working answer into an error for a student.
 *
 * Two: it never joins content to identity. The caller is verified on every
 * request and counted for quota, and none of that reaches this file. With both
 * halves this is a profile of a named student's questions over time; with one
 * it is a routing corpus. The difference is the whole reason the split exists,
 * and it is one careless field away from collapsing - so it is asserted here
 * rather than left to the comment at the top of log.ts.
 */

const entry = (over: Partial<AskLog> = {}): AskLog => ({
  outcome: "declined_off_topic",
  question: "how much is the hostel fee",
  subjectCount: 3,
  latencyMs: 412,
  ...over,
});

function fake() {
  const points: Array<Record<string, unknown>> = [];
  return {
    points,
    dataset: { writeDataPoint: (p: Record<string, unknown>) => { points.push(p); } },
  };
}

describe("a logging failure is never the student's problem", () => {
  it("does nothing when the dataset is not bound", async () => {
    // A deployment without the binding must serve questions, not refuse them.
    await expect(logAsk(undefined, entry())).resolves.toBeUndefined();
  });

  it("swallows a dataset that throws", async () => {
    const dataset = { writeDataPoint: () => { throw new Error("quota"); } };
    await expect(logAsk(dataset as never, entry())).resolves.toBeUndefined();
  });

  it("swallows a digest failure rather than rejecting", async () => {
    // The request has already been answered by the time this runs.
    const spy = vi.spyOn(crypto.subtle, "digest")
      .mockRejectedValueOnce(new Error("no"));
    await expect(logAsk(fake().dataset as never, entry())).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe("identity is never written beside content", () => {
  it("writes the question, the outcome and nothing that names anyone", async () => {
    const { points, dataset } = fake();
    await logAsk(dataset as never, entry());

    const flat = JSON.stringify(points[0]);
    // The fields the Worker HAS at the call site and deliberately does not pass:
    // the verified subject, the bearer token, and the course list.
    expect(flat).not.toMatch(/user_[a-z0-9]/i);
    expect(flat).not.toMatch(/\bsub\b/);
    expect(flat).not.toMatch(/CST\d/);
    expect(flat).not.toMatch(/eyJ/); // A JWT, if one ever leaked in.
  });

  it("keeps the course COUNT but not the courses", async () => {
    const { points, dataset } = fake();
    await logAsk(dataset as never, entry({ subjectCount: 7 }));
    // The count is the only thing the router's behaviour depends on.
    expect(points[0]!.doubles).toEqual([7, 412]);
  });

  it("indexes by outcome, because that is where every query starts", async () => {
    const { points, dataset } = fake();
    await logAsk(dataset as never, entry({ outcome: "upstream_error" }));
    expect(points[0]!.indexes).toEqual(["upstream_error"]);
  });

  it("gives the same phrasing the same digest, and different ones different", async () => {
    const { points, dataset } = fake();
    await logAsk(dataset as never, entry({ question: "Can I Skip Tomorrow" }));
    await logAsk(dataset as never, entry({ question: "  can i skip tomorrow  " }));
    await logAsk(dataset as never, entry({ question: "what is condonation" }));

    const d = (i: number) => (points[i]!.blobs as string[])[2];
    // Repeats can be counted without grouping by the raw text.
    expect(d(0)).toBe(d(1));
    expect(d(0)).not.toBe(d(2));
    // Truncated on purpose: 8 bytes identifies a phrasing and does not invite
    // being treated as a key for anything else.
    expect(d(0)).toHaveLength(16);
  });
});

describe("every way a request can end is a distinct row", () => {
  it.each([
    [{ kind: "view", view: "home" }, "routed_view"],
    [{ kind: "subject", code: "CST303", view: "ledger" }, "routed_subject"],
    [{ kind: "none", reason: "off_topic" }, "declined_off_topic"],
    [{ kind: "none", reason: "no_match" }, "declined_no_match"],
    [{ kind: "none", reason: "unclear" }, "declined_unclear"],
    [null, "unparseable"],
  ])("maps %j to %s", (action, outcome) => {
    expect(outcomeOf(action as never)).toBe(outcome);
  });

  it("distinguishes a refusal from a response that failed to parse", () => {
    // "The model declined" and "the model returned something illegal" are the
    // two rows that look alike and mean opposite things: one is the guardrail
    // working, the other is the guardrail firing.
    expect(outcomeOf(null)).toBe("unparseable");
    expect(outcomeOf({ kind: "none", reason: "off_topic" })).not.toBe("unparseable");
  });
});
