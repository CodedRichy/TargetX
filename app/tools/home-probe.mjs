import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
const { seed } = await import("./seed.mjs");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((req, res) => {
  const path = normalize(join("dist", decodeURI((req.url || "/").split("?")[0])));
  const file = existsSync(path) && !path.endsWith("dist") ? path : "dist/index.html";
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((d) => server.listen(4173, d));
const browser = await chromium.launch();
for (const width of [1280, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 800 } });
  await context.addInitScript((d) => localStorage.setItem("targetx.state.v1", JSON.stringify(d)), seed);
  const page = await context.newPage();
  await page.goto("http://localhost:4173/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch {} }));
  console.log(width, await page.evaluate(() => {
    const bento = document.querySelector(".bento");
    const cols = getComputedStyle(bento).gridTemplateColumns.split(" ").length;
    return { cols, tiles: [...bento.children].map((t) => {
      const r = t.getBoundingClientRect();
      return `${t.querySelector("h3")?.textContent} ${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}`;
    }) };
  }));
  await page.screenshot({ path: `shots/probe-home-${width}.png`, fullPage: true });
  await context.close();
}
await browser.close(); server.close();
