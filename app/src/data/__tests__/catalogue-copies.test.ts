/**
 * The two copies of the catalogue must not drift.
 *
 * `app/src/data/curriculum.json` is compiled into the binary as the fallback.
 * `curriculum.json` at the repo root is what an INSTALLED app fetches from
 * raw.githubusercontent on launch, which is the whole point of holding the
 * course table outside the code: KTU revises the curriculum between batches
 * and nobody should need a new build for it.
 *
 * They are two files, so they drift, and the failure is quiet in the worst
 * direction. `setCatalogue` only accepts a strictly newer version, so a root
 * copy left behind is simply ignored - every installed app keeps the credits
 * it shipped with while the repo says they were fixed. That had already
 * happened: the root copy sat at version 2 while the bundled one moved to 3.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => JSON.parse(readFileSync(path, "utf-8")) as { version?: number };

describe("the bundled catalogue and the one the app downloads", () => {
  it("are the same file", () => {
    const bundled = read("src/data/curriculum.json");
    const served = read("../curriculum.json");
    expect(served).toEqual(bundled);
  });

  it("carry a version, because that is the only thing that makes an update land", () => {
    expect(read("src/data/curriculum.json").version).toBeGreaterThan(0);
  });
});
