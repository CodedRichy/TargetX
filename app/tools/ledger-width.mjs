/**
 * Does the semester table actually fit? (issue #12)
 *
 * jsdom has no layout, so no unit test can answer this - and the bug was
 * entirely a layout one: the drawer took a fixed 340px and the table's
 * fourteen columns needed more than what was left, so Target, Need and Status
 * ran off the right edge and stopped against the drawer's border. It read as
 * the drawer covering the table.
 *
 * This measures the thing itself in a real browser and fails loudly, so the
 * arithmetic in `app.css` cannot drift back. Two cases are held to zero:
 *
 * - the default 1440 window WITH the drawer open, which is what a student gets
 *   without touching anything;
 * - the app's own 1100 minimum window with the drawer closed, which is the
 *   narrowest the window can be made and still be asked to show everything.
 *
 * 1100 and 1280 with the drawer open are expected to overflow - the table
 * cannot fit beside a 340px panel in a 1100px window, and closing the panel is
 * the answer there. They are reported, not asserted.
 *
 *   npm run build && node tools/ledger-width.mjs
 */
import { chromium } from "playwright";
import { seed, serve } from "./seed.mjs";

/** [viewport, drawer open, must fit] */
const CASES = [
  [1100, true, false],
  [1100, false, true],
  [1280, true, false],
  [1280, false, true],
  [1440, true, true],
  [1440, false, true],
  [1600, true, true],
];

const { url: URL, stop } = await serve();
const browser = await chromium.launch();
const failures = [];

for (const [width, open, mustFit] of CASES) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addInitScript(
    (d) => localStorage.setItem("targetx.state.v1", JSON.stringify(d)), seed);
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Semester", exact: true }).click();
  await page.waitForTimeout(250);
  if (!open) {
    await page.getByRole("button", { name: /analytics panel/i }).click();
    await page.waitForTimeout(250);
  }

  const cut = await page.evaluate(() => {
    const led = document.querySelector(".ledger");
    return led ? led.scrollWidth - led.clientWidth : -1;
  });
  const state = open ? "panel open  " : "panel closed";
  const verdict = cut === 0 ? "fits" : `cut by ${cut}px`;
  console.log(`${width}  ${state}  ${verdict}${mustFit ? "  (must fit)" : ""}`);
  if (mustFit && cut !== 0) {
    failures.push(`${width}px with the ${open ? "panel open" : "panel closed"}: cut by ${cut}px`);
  }
  await context.close();
}

await browser.close();
stop();

if (failures.length) {
  console.error("\nThe semester table is losing columns again (issue #12):");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log("\nEvery column reachable in each case that has to hold.");
