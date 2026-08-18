/**
 * Render the application icon.
 *
 * The icon is the same X as the splash and the wordmark, so it is drawn from
 * the same geometry rather than exported by hand from a design tool - if the
 * mark changes, this regenerates and the three stay identical.
 *
 * Chromium is already a dependency for the screenshot review, so it is also
 * the rasteriser. Output is a single 1024px PNG; `npx tauri icon` takes that
 * and produces every size Windows, macOS and Linux want.
 *
 *   node tools/icon.mjs && npx tauri icon icons/source.png
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

// Literal hex, not tokens: this file has no stylesheet. Converted from the
// app's OKLCH palette - verdigris on the dark ground.
const BRAND = "#5AC0AB";
const DEEP = "#1F6255";
const GROUND = "#0E0905";

const SIZE = 1024;

// Rounded-square tile at roughly the platform radius, with the mark inset far
// enough that macOS and Windows masking never clips a stroke cap.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${SIZE}" height="${SIZE}">
  <rect x="0" y="0" width="100" height="100" rx="22" fill="${GROUND}"/>
  <line x1="30" y1="30" x2="70" y2="70" stroke="${DEEP}" stroke-width="13" stroke-linecap="round"/>
  <line x1="30" y1="70" x2="70" y2="30" stroke="${BRAND}" stroke-width="13" stroke-linecap="round"/>
</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.setContent(
  `<body style="margin:0;background:transparent">${svg}</body>`,
  { waitUntil: "load" });

mkdirSync("icons", { recursive: true });
await page.screenshot({ path: "icons/source.png", omitBackground: true });
await browser.close();

console.log(`wrote icons/source.png (${SIZE}x${SIZE})`);
console.log("next: npx tauri icon icons/source.png");
