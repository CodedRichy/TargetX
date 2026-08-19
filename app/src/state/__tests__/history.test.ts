/**
 * History credits: what gets stored, and what the CGPA divides by.
 *
 * KTU weights the CGPA by the credits a student REGISTERED for. A failed
 * course scores zero grade points but its credits stay in the denominator, so
 * storing the earned total under the field the CGPA reads quietly flatters
 * every semester that carries a backlog. These are the checks on the writers,
 * on the migration for saves that predate the distinction, and on the CGPA
 * that falls out of both.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { cgpaFromSemesters } from "../../engine";
import { parseGradeCard } from "../../sync/gradecard";
import { applyGradeCard, resetEverything } from "../actions";
import { migrateHistory, setHistory, state } from "../store";

/**
 * The screens read this through the `overall` memo, which only tracks inside a
 * render root. Calling the engine on the same map is the same arithmetic
 * without standing up a component tree.
 */
const cgpa = () => cgpaFromSemesters(state.history);

/**
 * S1 clean, S3 with one 4-credit F. Both printed SGPAs agree with the grades,
 * so nothing here rests on a parse the app would flag as a mismatch.
 *
 *   S1: 40 + 36 + 34 + 24 + 20 + 17 + 10 = 181 over 20 credits = 9.05
 *   S3:  0 + 26 + 24 + 16.5 + 14 + 13 + 7.5 = 101 over 20 credits = 5.05
 */
const CARD = `
First Semester
UCEST101  Algorithmic Thinking       4  S
UCEST102  Engineering Mechanics      4  A+
PCCST103  Programming Fundamentals   4  A
UCHUT104  Life Skills                3  B+
PCCSL105  Programming Lab            2  S
PCCSL106  Workshop                   2  A
UCEST107  Design Thinking            1  S
SGPA: 9.05

Third Semester
PCCST301  Discrete Mathematics       4  C
PCCST302  Data Structures            4  D
PCCST303  Object Oriented Design     4  F
PBCST304  Graph Theory               3  P
PCCSL307  Data Structures Lab        2  C+
PCCSL308  Programming Lab            2  C
UCHUT346  Sustainable Engineering    1  B
SGPA: 5.05
`;

describe("applying a grade card", () => {
  beforeEach(() => resetEverything());

  it("stores the registered total, and the earned total beside it", () => {
    applyGradeCard(parseGradeCard(CARD));

    expect(state.history["S1"]).toEqual(
      { sgpa: 9.05, creditsRegistered: 20, creditsEarned: 20 });
    // The F costs 4 earned credits; it costs nothing in the denominator.
    expect(state.history["S3"]).toEqual(
      { sgpa: 5.05, creditsRegistered: 20, creditsEarned: 16 });
  });

  it("divides the CGPA by registered credits, not earned ones", () => {
    applyGradeCard(parseGradeCard(CARD));

    //   registered: (181 + 101) / 40   = 7.05
    //   earned:     (181 + 5.05x16) / 36 = 7.272   <- the defect
    expect(cgpa().cgpa).toBe(7.05);
    expect(cgpa().credits).toBe(40);
    expect(cgpa().unconfirmed).toEqual([]);
  });
});

describe("saves written before the two totals were told apart", () => {
  beforeEach(() => resetEverything());

  it("keeps the old number as earned rather than reading it as registered", () => {
    const migrated = migrateHistory({ S3: { sgpa: 5.05, credits: 16 } });

    expect(migrated["S3"]).toEqual(
      { sgpa: 5.05, creditsRegistered: null, creditsEarned: 16 });
    // Reinterpreting 16 as registered would move a real student's CGPA with
    // nothing on screen to explain it, so the old weighting stands and the
    // semester is named instead.
    expect(cgpaFromSemesters(migrated).unconfirmed).toEqual(["S3"]);
  });

  it("survives a second pass unchanged", () => {
    const once = migrateHistory({ S3: { sgpa: 5.05, credits: 16 } });
    expect(migrateHistory(once)).toEqual(once);
  });

  it("takes a blank credit box as unknown, not as zero", () => {
    applyGradeCard(parseGradeCard(CARD));
    setHistory("S3", 5.05, null);

    // Clearing the box gives up the registered total but not the earned one
    // the card published, so the CGPA still has something to weigh by.
    expect(state.history["S3"]).toEqual(
      { sgpa: 5.05, creditsRegistered: null, creditsEarned: 16 });
    expect(cgpa().unconfirmed).toEqual(["S3"]);
    expect(cgpa().credits).toBe(36);
  });
});
