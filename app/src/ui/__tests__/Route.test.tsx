// @vitest-environment jsdom
/**
 * What a route says on screen.
 *
 * `RoutePanel` takes an `SgpaPlan` and its target as props and reads no store,
 * so every case below is a plan literal with known fields and the assertions
 * are on the exact sentence rendered from them. That is the point: the largest
 * defect class on this project is on-screen text asserting behaviour the code
 * does not have, and it went uncaught because nothing rendered these surfaces.
 *
 * The numbers in the literals are the shapes `planForSgpa` actually returns -
 * `maxSgpa` present on both the greedy path and the "target is above the best
 * still available" early return, `target` absent on the latter, `secured`
 * below `grade` exactly on the rows named by `bound`.
 */
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import type { SgpaPlan } from "../../engine";
import { RoutePanel } from "../Route";

afterEach(cleanup);

/** A route that carries its target. */
const REACHABLE: SgpaPlan = {
  reachable: true,
  plan: [
    { code: "CST305", grade: "A", ese: 47, credits: 4, locked: false,
      eseMax: 60, cieUnknown: false, secured: "A" },
    { code: "CSL333", grade: "S", ese: 0, credits: 2, locked: false,
      eseMax: 0, cieUnknown: false, secured: "S" },
    { code: "HUN101", grade: "B", ese: 30, credits: 3, locked: true,
      eseMax: 60, cieUnknown: false, secured: "B" },
  ],
  sgpa: 8.5, sgpaGuaranteed: 8.5, target: 8, credits: 9, maxSgpa: 9.5,
};

/** A route that does not carry its target, held back by a bound row. */
const BOUND: SgpaPlan = {
  reachable: false, conditional: true,
  plan: [
    { code: "CST301", grade: "B+", ese: 48, credits: 4, locked: false,
      eseMax: 60, cieUnknown: true, secured: "B" },
  ],
  bound: ["CST301"],
  sgpa: 8.2, sgpaGuaranteed: 7.94, target: 8.2, credits: 4, maxSgpa: 9.5,
};

/** A route waiting on a course it cannot price at all. */
const UNPRICED: SgpaPlan = {
  reachable: false, conditional: true,
  plan: [
    { code: "CST303", grade: "S", ese: 59, credits: 4, locked: false,
      eseMax: 60, cieUnknown: true, secured: "S" },
  ],
  unpriced: ["CSL331"],
  sgpa: 9.46, sgpaGuaranteed: 9.06, target: 9.46, credits: 6, maxSgpa: 9.5,
};

/**
 * The early return: no route at all, and `maxSgpa` is the only number there
 * is. `target` is absent from the plan, which is why the panel takes it as a
 * prop.
 */
const NO_ROUTE: SgpaPlan = {
  reachable: false, plan: [], credits: 11, maxSgpa: 7.83,
  reason: "target is above the best still available",
};

const text = (plan: SgpaPlan, target: number) => {
  const { container } = render(() => (
    <RoutePanel title="Route to your S5 target" chasing="the SGPA you set for S5"
                target={target} plan={plan} />
  ));
  return container.textContent ?? "";
};

describe("RoutePanel: which target it is chasing", () => {
  it("prints the target it was solved for, to two places", () => {
    expect(text(REACHABLE, 8)).toContain("Chasing 8.00 SGPA");
  });

  it("prints the caller's target, not the plan's, so the early return is not blank", () => {
    // NO_ROUTE carries no `target` field at all. A panel reading `plan.target`
    // would render "Chasing SGPA" here.
    expect(NO_ROUTE.target).toBeUndefined();
    expect(text(NO_ROUTE, 9.9)).toContain("Chasing 9.90 SGPA");
  });

  it("names whose target it is", () => {
    expect(text(REACHABLE, 8)).toContain("the SGPA you set for S5");
  });

  it("titles the route by whether anything was unpriceable", () => {
    expect(text(REACHABLE, 8)).toContain("Cheapest route");
    expect(text(REACHABLE, 8)).not.toContain("Best still on offer");
    expect(text(UNPRICED, 9.46)).toContain("Best still on offer");
    expect(text(UNPRICED, 9.46)).not.toContain("Cheapest route");
  });
});

describe("RoutePanel: the rows", () => {
  it("quotes an exam mark, and calls an internal-only course what it is", () => {
    const out = text(REACHABLE, 8);
    expect(out).toContain("CST305");
    expect(out).toContain("47 in the exam");
    expect(out).toContain("from the internals alone");
  });

  it("says nothing about an exam for a row already graded", () => {
    // HUN101 is locked with eseMax 60 and ese 30; a locked row has no mark
    // left to score, so 30 must not appear as a requirement.
    expect(text(REACHABLE, 8)).not.toContain("30 in the exam");
  });

  it("marks a mark priced off an internal that has not settled", () => {
    const out = text(BOUND, 8.2);
    expect(out).toContain("at least 48 in the exam");
    expect(out).toContain("internals not settled yet");
  });

  it("says what a bound row actually secures today", () => {
    expect(text(BOUND, 8.2)).toContain("B on today's internal");
  });

  it("omits the balance note where a course could not be priced", () => {
    expect(text(REACHABLE, 8)).toContain("Balanced on the difficulty of each next grade");
    expect(text(UNPRICED, 9.46)).not.toContain("Balanced on the difficulty");
  });
});

describe("RoutePanel: what the route guarantees", () => {
  it("quotes the guaranteed SGPA against the target, not the quoted sum", () => {
    expect(text(BOUND, 8.2)).toContain(
      "Scoring exactly these marks and nothing else reaches 7.94, not the 8.20 you need.");
  });

  it("says nothing of the kind on a route that carries its target", () => {
    expect(text(REACHABLE, 8)).not.toContain("Scoring exactly these marks");
  });
});

describe("RoutePanel: maxSgpa, the number that used to render nowhere", () => {
  it("prints the best still available when the quoted route falls short", () => {
    const out = text(BOUND, 8.2);
    expect(out).toContain("Best still available");
    expect(out).toContain("9.50");
    expect(out).toContain("Every subject at the best grade still open to it.");
  });

  it("says the target is still reachable by a harder route when it is", () => {
    // maxSgpa 9.50 >= target 8.20, so `reachable: false` here means "not by
    // this route", and saying otherwise is the defect this closes.
    expect(text(BOUND, 8.2)).toContain(
      "Your target sits inside that, so it is still reachable — just not by the route above.");
  });

  it("names the harder route's cost in the engine's own terms", () => {
    const out = text(BOUND, 8.2);
    expect(out).toContain("The harder route runs through");
    expect(out).toContain("CST301 (quoted for B+, secures B on today's internal)");
    expect(out).toContain("earn the attendance marks those quotes assume, or beat the quoted mark");
  });

  it("names the unpriced course where that is what the answer waits on", () => {
    const out = text(UNPRICED, 9.46);
    expect(out).toContain("The rest rides on marks nobody has entered yet: CSL331");
    expect(out).toContain("no exam to sit, and the internal not settled");
  });

  it("says no route reaches the target, with the shortfall, when the ceiling is below it", () => {
    // 9.90 - 7.83 = 2.07, and the panel must not claim a harder route exists.
    const out = text(NO_ROUTE, 9.9);
    expect(out).toContain("Best still available");
    expect(out).toContain("7.83");
    expect(out).toContain(
      "That is below 9.90, so no route reaches your target this semester — short by 2.07.");
    expect(out).not.toContain("still reachable");
    expect(out).not.toContain("The harder route runs through");
  });

  it("keeps the ceiling off a route that already carries its target", () => {
    expect(text(REACHABLE, 8)).not.toContain("Best still available");
  });

  it("shows the engine's reason for a route with no rows", () => {
    expect(text(NO_ROUTE, 9.9)).toContain("target is above the best still available");
    expect(text(NO_ROUTE, 9.9)).not.toContain("Cheapest route");
  });
});
