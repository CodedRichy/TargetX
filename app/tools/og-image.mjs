/**
 * Renders tools/og-card.html to docs/og.png at exactly 1200x630.
 *
 *   npm run og
 *
 * The card is committed as a PNG rather than generated on the fly because a
 * link unfurler fetches the image once, from a cold cache, with a short
 * timeout - there is nothing to run at that moment but a static file.
 *
 * Re-run this after editing og-card.html, and only then: the file in docs/ is
 * what every share of this link shows.
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const CARD = path.resolve(process.cwd(), "tools/og-card.html");
const OUT = path.resolve(process.cwd(), "../docs/og.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto("file:///" + CARD.replace(/\\/g, "/"), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

/* Fail rather than ship a card with the fallback face: the whole point of a
   share image is that it looks like the product, and system-ui does not. */
const loaded = await page.evaluate(() =>
  document.fonts.check('700 74px "Space Grotesk"') &&
  document.fonts.check('400 15px "JetBrains Mono"'));
if (!loaded) {
  console.error("Space Grotesk or JetBrains Mono did not load - refusing to render.");
  process.exit(1);
}

await page.screenshot({ path: OUT });
await browser.close();

const { size } = fs.statSync(OUT);
console.log(`og.png  1200x630  ${(size / 1024).toFixed(0)} KB`);
/* Unfurlers have their own size ceilings and the slowest of them give up
   early; a card this simple has no business being large. */
if (size > 900 * 1024) {
  console.error("Over 900 KB - too heavy for a link preview.");
  process.exit(1);
}
