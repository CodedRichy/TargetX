/**
 * Tab through every screen and print what focus lands on.
 *
 * The accessibility statement claims every focus stop was driven in a real
 * browser. That claim goes stale the moment a surface is added, and a stale
 * accessibility claim is worse than none: a college may rely on it. This is
 * how it is re-checked rather than re-asserted.
 *
 *   npm run build && node tools/keyboard.mjs
 */
import { chromium } from "playwright";
import { seed, serve } from "./seed.mjs";

const { url, stop } = await serve();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript((d) => localStorage.setItem("targetx.state.v1", JSON.stringify(d)), seed);
const page = await context.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

const describe = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const style = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const name = el.getAttribute("aria-label")
    || el.labels?.[0]?.textContent
    || el.textContent?.trim().slice(0, 40)
    || el.getAttribute("title") || "";
  return {
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute("type") ?? "",
    name: name.replace(/\s+/g, " "),
    ring: `${style.outlineStyle} ${style.outlineWidth}`,
    size: `${Math.round(box.width)}x${Math.round(box.height)}`,
    hidden: style.visibility === "hidden" || style.display === "none"
      || Number(style.opacity) === 0,
  };
});

let problems = 0;
for (const screen of ["Home", "Semester", "History", "Data"]) {
  await page.getByRole("button", { name: screen, exact: true }).click();
  await page.waitForTimeout(200);
  await page.evaluate(() => document.activeElement?.blur());
  console.log(`\n--- ${screen} -------------------------------------------`);
  const seen = new Set();
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const stopInfo = await describe();
    if (!stopInfo) continue;
    const key = `${stopInfo.tag}|${stopInfo.name}|${stopInfo.size}`;
    if (seen.has(key)) break;           // wrapped around
    seen.add(key);
    const faults = [];
    if (!stopInfo.name) faults.push("NO ACCESSIBLE NAME");
    if (stopInfo.hidden) faults.push("INVISIBLE STOP");
    if (stopInfo.size.startsWith("0x") || stopInfo.size.endsWith("x0")) faults.push("ZERO SIZE");
    if (stopInfo.ring.startsWith("none")) faults.push("NO FOCUS RING");
    if (faults.length) problems++;
    console.log(`  ${stopInfo.tag}${stopInfo.type ? `[${stopInfo.type}]` : ""}`.padEnd(14)
      + `${stopInfo.size.padEnd(10)} ${stopInfo.ring.padEnd(12)} ${stopInfo.name}`
      + (faults.length ? `   <-- ${faults.join(", ")}` : ""));
  }
}
console.log(`\n${problems} problem stop(s).`);
await browser.close();
stop();
process.exit(problems ? 1 : 0);
