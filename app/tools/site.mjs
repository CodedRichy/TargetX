/**
 * Look at the download page, and measure it, before shipping it.
 *
 * docs/ is served by GitHub Pages, so nothing builds it and nothing type-checks
 * it — which means the only way it gets reviewed is by rendering it. This
 * serves the folder, walks the widths a real visitor arrives at, reports any
 * element wider than the viewport, and writes screenshots into shots/.
 *
 *   npm run site
 */
import { chromium } from "playwright";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("../docs");
const TYPES = {
  ".html": "text/html", ".png": "image/png",
  ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml",
};

const server = http.createServer(async (req, res) => {
  const file = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    const body = await readFile(path.join(ROOT, file));
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
let failed = false;

// Both themes at desktop, then the two widths phones actually arrive at.
const RUNS = [
  { width: 1440, height: 900, scheme: "dark", tag: "dark" },
  { width: 1440, height: 900, scheme: "light", tag: "light" },
  { width: 768, height: 1024, scheme: "dark", tag: "768" },
  { width: 390, height: 844, scheme: "dark", tag: "390" },
];

for (const run of RUNS) {
  const context = await browser.newContext({
    viewport: { width: run.width, height: run.height },
    colorScheme: run.scheme,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  // The entrance is an enhancement; measure the page it settles into.
  await page.evaluate(() => {
    document.querySelectorAll(".rise").forEach((el) => el.classList.add("seen"));
  });
  await page.waitForTimeout(200);

  const measured = await page.evaluate(() => {
    const doc = document.documentElement;
    const wide = [];
    document.querySelectorAll("body *").forEach((el) => {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.right > doc.clientWidth + 1) {
        wide.push((el.tagName + "." + (el.className || "")).slice(0, 40));
      }
    });
    return { overflow: doc.scrollWidth - doc.clientWidth, wide: [...new Set(wide)].slice(0, 6) };
  });

  const ok = measured.overflow <= 0 && measured.wide.length === 0;
  if (!ok) failed = true;
  console.log(
    `${run.tag.padEnd(6)} ${String(run.width).padStart(5)}px  ` +
    (ok ? "fits" : `OVERFLOW +${measured.overflow}  ${measured.wide.join(", ")}`)
  );

  await page.screenshot({ path: `shots/site-${run.tag}.png`, fullPage: true });
  await context.close();
}

await browser.close();
server.close();
process.exit(failed ? 1 : 0);
