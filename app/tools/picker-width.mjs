/**
 * Does the branch select fit?
 *
 * The picker now lists KTU's printed branch names, the longest of which is 90
 * characters. A `select` sizes itself to its widest option, so `width: auto`
 * in a flex row is a horizontal overflow waiting to happen - and the one thing
 * a setup screen must not do is push its own buttons off the side.
 *
 *   npm run build && npm run picker-width
 *
 * Prints the overflow numbers and drops a screenshot in target/ - reading the
 * numbers alone missed that the counter beside the select had been squeezed
 * into three crushed lines while nothing overflowed at all.
 */
import { chromium } from "playwright";
import { serve } from "./seed.mjs";

const { url: URL, stop } = await serve();
const browser = await chromium.launch();

for (const viewport of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
  const context = await browser.newContext({ viewport });
  // No seeded state: setup only runs for a student who has not onboarded.
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByText("Pick from the KTU curriculum").click();
  await page.waitForTimeout(250);

  const report = await page.evaluate(() => {
    const out = [];
    const doc = document.documentElement;
    out.push(["document", doc.scrollWidth, doc.clientWidth]);
    for (const sel of [".setup-frame", ".setup-body", ".picker-controls"]) {
      const el = document.querySelector(sel);
      if (el) out.push([sel, el.scrollWidth, el.clientWidth]);
    }
    const select = document.querySelector(".picker-controls select");
    if (select) out.push(["branch select width", Math.round(select.getBoundingClientRect().width), 0]);
    return out;
  });

  console.log(`\n${viewport.width}x${viewport.height}`);
  for (const [name, scroll, client] of report) {
    const over = client ? scroll - client : 0;
    console.log(`  ${name.padEnd(22)} ${String(scroll).padStart(5)}` +
      (client ? ` / ${String(client).padStart(5)}  ${over > 0 ? `OVERFLOW +${over}` : "fits"}` : "px"));
  }
  // shots/ is gitignored and is where the other screenshot tool writes.
  await page.screenshot({ path: `shots/picker-${viewport.width}.png` });
  await context.close();
}

await browser.close();
await stop();
