/**
 * What actually overflows, and by how much.
 *
 * The point is not "Home scrolls" - it is which block inside it is taller than
 * the space it was given, at the size a real laptop opens the app at. Reading
 * the CSS cannot answer that; this prints the offending children in order.
 *
 *   npm run build && node tools/measure.mjs
 */
import { chromium } from "playwright";
import { seed, serve } from "./seed.mjs";

const SIZES = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }];
const { url: URL, stop } = await serve();

const browser = await chromium.launch();

for (const viewport of SIZES) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((data) => {
    localStorage.setItem("targetx.state.v1", JSON.stringify(data));
  }, seed);
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  for (const screen of ["Home", "Semester", "History", "Data"]) {
    await page.getByRole("button", { name: screen, exact: true }).click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      document.getAnimations().forEach((a) => { try { a.finish(); } catch { /**/ } });
    });
    const report = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        const over = el.scrollHeight - el.clientHeight;
        if (over > 4 && el.clientHeight > 0) {
          const style = getComputedStyle(el);
          if (style.overflowY === "visible") continue;
          const kids = [...el.children].map((k) => {
            const r = k.getBoundingClientRect();
            return `${k.tagName.toLowerCase()}.${(k.className || "").toString().split(" ")[0]}=${Math.round(r.height)}`;
          });
          out.push({
            sel: `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ").join(".")}`,
            client: el.clientHeight, scroll: el.scrollHeight, over, kids,
          });
        }
      }
      return out;
    });
    for (const r of report) {
      console.log(`${viewport.width}x${viewport.height} ${screen}: ${r.sel} over by ${r.over}px (${r.client} -> ${r.scroll})`);
      console.log(`    ${r.kids.join("  ")}`);
    }
    if (report.length === 0) console.log(`${viewport.width}x${viewport.height} ${screen}: fits`);
  }
  await context.close();
}
await browser.close();
stop();
