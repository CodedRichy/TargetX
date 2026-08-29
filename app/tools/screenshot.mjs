/**
 * Screenshot every screen, in the order a real user meets them.
 *
 * Shipping UI without looking at it is how you get a layout that only works on
 * the one state you had in mind. The state is `tools/seed.mjs`, shared with
 * `tools/measure.mjs` so the picture and the measurement are of the same app.
 *
 *   npm run build && node tools/screenshot.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { seed, serve } from "./seed.mjs";

const VIEWPORT = { width: 1600, height: 950 };
const { url: URL, stop } = await serve();

const browser = await chromium.launch();
mkdirSync("shots", { recursive: true });

/** A page with no saved state - what a first-time user gets. */
async function freshPage() {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  return page;
}

/**
 * Let every animation finish before the shutter.
 *
 * Headless captures land mid-flight otherwise - tiles half-faded, the gauge
 * arc part-drawn - which reviews the transition rather than the design.
 * getComputedStyle will happily report the final value while the compositor
 * is still interpolating, so the animations have to be explicitly finished
 * rather than waited on.
 */
async function settle(page) {
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* infinite */ } });
  });
  await page.waitForTimeout(120);
}

/**
 * A page with the seed already in storage.
 *
 * addInitScript rather than "load, write, reload": it must be present before
 * the app's first render. Note the flip side, which caught me out once - an
 * init script also re-runs on reload, so a "cleared" page is never actually
 * clear. That is why the empty states above use a separate context.
 */
async function seededPage(overrides = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  await context.addInitScript((data) => {
    localStorage.setItem("targetx.state.v1", JSON.stringify(data));
  }, { ...seed, ...overrides });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  return page;
}

// --- first run -------------------------------------------------------------

const setup = await freshPage();
await setup.screenshot({ path: "shots/01-welcome.png" });

await setup.getByRole("button", { name: "Get started" }).click();
await setup.waitForTimeout(250);
  await settle(setup);
await setup.screenshot({ path: "shots/02-how-data-gets-in.png" });

await setup.getByText("Sign in to your college portal").click();
await setup.waitForTimeout(250);
  await settle(setup);
await setup.screenshot({ path: "shots/03-sync.png" });

await setup.getByRole("button", { name: "← Other ways to start" }).click();
await setup.getByText("Pick from the KTU curriculum").click();
await setup.waitForTimeout(300);
  await settle(setup);
await setup.screenshot({ path: "shots/04-subject-picker.png" });

// Straight to the goal step without committing a preset.
await setup.getByRole("button", { name: "← Other ways to start" }).click();
await setup.getByText("Start empty").click();
await setup.waitForTimeout(250);
  await settle(setup);
await setup.screenshot({ path: "shots/05-goal.png" });

// --- the app ---------------------------------------------------------------

const app = await seededPage();
await app.screenshot({ path: "shots/06-home.png" });

// Home is the landing screen now, so the ledger has to be asked for. Scoping
// the row click to the table matters: a subject code appears on Home too.
await app.getByRole("button", { name: "Semester", exact: true }).click();
await app.waitForTimeout(250);
  await settle(app);
await app.screenshot({ path: "shots/07-ledger.png" });

await app.locator("table").getByText("PCCST502").first().click();
await app.waitForTimeout(250);
  await settle(app);
await app.screenshot({ path: "shots/08-subject-detail.png" });

await app.getByRole("button", { name: "History" }).click();
await app.waitForTimeout(250);
  await settle(app);
await app.screenshot({ path: "shots/09-history.png" });

await app.getByRole("button", { name: "Data" }).click();
await app.waitForTimeout(250);
  await settle(app);
await app.screenshot({ path: "shots/10-data.png" });

// Light mode gets its own capture rather than a toggle click: the point is to
// review the palette, and a screenshot taken mid-transition proves nothing.
const light = await seededPage({ theme: "light" });
await light.screenshot({ path: "shots/11-home-light.png" });

await light.getByRole("button", { name: "Semester", exact: true }).click();
await light.waitForTimeout(250);
  await settle(light);
await light.screenshot({ path: "shots/12-ledger-light.png" });

await browser.close();
stop();
console.log("wrote shots/01-welcome.png .. 12-ledger-light.png");
