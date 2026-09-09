/**
 * The download page, looked at rather than reasoned about.
 *
 *   npm run site:audit            against docs/ on a local server
 *   npm run site:audit -- --live  against the published GitHub Pages site
 *
 * `npm run site` answers one question - does anything overflow. This answers
 * the ones that only a rendered page can: is there a gap between a paragraph
 * and the box under it, does the phone visitor get offered a .dmg, does the
 * recommendation match the machine. Screenshots land in shots/ so the answer
 * can be looked at and not just read.
 */
import { chromium, devices } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const LIVE = process.argv.includes("--live");
const DOCS = path.resolve(process.cwd(), "../docs");
const OUT = path.resolve(process.cwd(), "shots");
fs.mkdirSync(OUT, { recursive: true });

const TYPES = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};

async function serve() {
  const srv = http.createServer((req, res) => {
    const rel = req.url === "/" ? "index.html" : req.url.split("?")[0];
    const file = path.join(DOCS, rel);
    try {
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise((r) => srv.listen(0, r));
  return { url: `http://localhost:${srv.address().port}/`, stop: () => srv.close() };
}

/*
 * Vertical rhythm. A heading or paragraph that sits flush against the box
 * below it reads as though the box belongs to the next thing, not this one -
 * and the usual cause is a margin on one that the other's `margin-block-start`
 * was expected to provide. Measured from rendered boxes, because that is the
 * only place the answer exists once the cascade has had its say.
 */
const SPACING_PROBE = () => {
  const BOXED = ".notice, .dl-primary, .store, .readout, .stair-top, .dl-wrap, .facts, table";
  const TEXTY = "p, h1, h2, h3, .prose, .claim, .doc-lede, .hero-lede, dt, dd, li";
  const out = [];
  for (const box of document.querySelectorAll(BOXED)) {
    let prev = box.previousElementSibling;
    if (!prev) continue;
    if (!prev.matches(TEXTY) && !prev.querySelector(TEXTY)) continue;
    const a = prev.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (!a.height || !b.height) continue;
    /* Siblings that sit side by side in a grid are not stacked, so the
       vertical distance between them means nothing - the hero's text column
       and its readout read as a -474px "gap". Only compare boxes that
       actually share horizontal space. */
    const sideBySide = b.left >= a.right - 1 || b.right <= a.left + 1;
    if (sideBySide) continue;

    const gap = Math.round(b.top - a.bottom);
    if (gap >= 0 && gap < 12) {
      out.push({
        gap,
        box: box.className || box.tagName.toLowerCase(),
        after: (prev.textContent || "").trim().replace(/\s+/g, " ").slice(0, 52),
      });
    }
  }
  return out;
};

/*
 * Two elements can be adjacent in the markup with no whitespace between them
 * because a style stacks them, and then a media query puts them back inline
 * and the missing space becomes visible - REGULATIONR 7.5.ii. Rendered
 * geometry is what catches it: the child's box starting exactly where the
 * text before it ended.
 */
const GLUED_PROBE = () => {
  const out = [];
  for (const label of document.querySelectorAll(".mark")) {
    const b = label.querySelector("b");
    if (!b) continue;
    if (getComputedStyle(b).display !== "inline") continue;
    const r = document.createRange();
    r.setStart(label, 0);
    r.setEndBefore(b);
    const before = r.getBoundingClientRect();
    const own = b.getBoundingClientRect();
    if (!before.width || !own.width) continue;
    if (Math.abs(own.left - before.right) < 2 && Math.abs(own.top - before.top) < 4) {
      out.push((label.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40));
    }
  }
  return out;
};

/*
 * Touch targets. 44px is the smallest box a finger hits reliably, and the
 * links that matter here are the ones that start a download - a nav link that
 * happens to be short is not worth failing a build over, so this looks at the
 * actions only.
 */
const TAP_PROBE = () => {
  const out = [];
  const targets = document.querySelectorAll(
    "#dl-rows a, #dl-button, #hero-dl, .btn"
  );
  for (const el of targets) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.height < 44) {
      out.push(`${Math.round(r.height)}px  "${(el.textContent || "").trim().slice(0, 24)}"`);
    }
  }
  return out;
};

const DOWNLOAD_PROBE = () => {
  const t = (id) => {
    const el = document.getElementById(id);
    return el ? el.textContent.trim().replace(/\s+/g, " ") : null;
  };
  const btn = document.getElementById("dl-button");
  const hero = document.getElementById("hero-dl");
  return {
    heroText: hero && hero.textContent.trim().replace(/\s+/g, " "),
    heroHref: hero && hero.getAttribute("href"),
    for: t("dl-for"), what: t("dl-what"), meta: t("dl-meta"),
    btnText: btn && btn.textContent.trim(),
    btnHref: btn && btn.getAttribute("href"),
    firstRow: (() => {
      const r = document.querySelector("#dl-rows tr");
      return r ? [...r.querySelectorAll("td")].slice(0, 2)
        .map((c) => c.textContent.trim().replace(/\s+/g, " ")).join(" | ") : null;
    })(),
  };
};

/*
 * The releases API allows 60 unauthenticated calls an hour, and this tool
 * makes seven a run - so a few runs in, GitHub starts answering 403 and every
 * case silently exercises the empty-state fallback instead of the table. The
 * fixture removes that: the page under test always sees the same release, so
 * a difference between two runs is a change in the page. `--live` skips it.
 */
const FIXTURE = {
  tag_name: "v0.1.0",
  assets: [
    ["TargetX_0.1.0_x64-setup.exe", 4823000],
    ["TargetX_0.1.0_x64_en-US.msi", 6501000],
    ["TargetX_0.1.0_universal.dmg", 13107200],
    ["TargetX_0.1.0_amd64.AppImage", 84200000],
    ["TargetX_0.1.0_amd64.deb", 6920000],
    ["TargetX-0.1.0.apk", 26898775],
  ].map(([name, size]) => ({
    name, size,
    browser_download_url:
      "https://github.com/CodedRichy/TargetX/releases/download/v0.1.0/" + name,
  })),
};

/*
 * The tags a link preview and a search result are built from. These fail
 * silently and invisibly - a missing og:image is a blank grey box in a
 * WhatsApp share, and nothing on the page looks wrong - so they are checked
 * rather than remembered. Run once, not per device.
 */
const META_PROBE = () => {
  const need = [
    ["title", () => document.title, 15],
    ['meta[name="description"]', null, 70],
    ['link[rel="canonical"]', null, 0],
    ['meta[property="og:title"]', null, 10],
    ['meta[property="og:description"]', null, 40],
    ['meta[property="og:image"]', null, 10],
    ['meta[property="og:url"]', null, 10],
    ['meta[name="twitter:card"]', null, 5],
    ['script[type="application/ld+json"]', null, 0],
  ];
  const missing = [];
  for (const [sel, direct, min] of need) {
    let value;
    if (direct) value = direct();
    else {
      const el = document.querySelector(sel);
      value = el && (el.getAttribute("content") || el.getAttribute("href") || el.textContent);
    }
    if (!value) missing.push(`${sel} absent`);
    else if (min && value.trim().length < min) missing.push(`${sel} too short (${value.trim().length})`);
  }
  const img = document.querySelector('meta[property="og:image"]');
  return { missing, image: img && img.getAttribute("content") };
};

const CASES = [
  { name: "desktop-1440-dark", viewport: { width: 1440, height: 900 }, theme: "dark" },
  { name: "desktop-1440-light", viewport: { width: 1440, height: 900 }, theme: "light" },
  { name: "desktop-1920-dark", viewport: { width: 1920, height: 1080 }, theme: "dark" },
  { name: "laptop-1280-dark", viewport: { width: 1280, height: 800 }, theme: "dark" },
  { name: "tablet-768-dark", viewport: { width: 768, height: 1024 }, theme: "dark" },
  { name: "iphone-14", device: "iPhone 14", theme: "dark" },
  { name: "pixel-7", device: "Pixel 7", theme: "dark" },
];

/*
 * The seat chip, in the states nobody looks at.
 *
 * It carries a scarcity figure, so the one rule it must never break is that it
 * shows nothing at all when the count cannot be read - a "spots left" box that
 * survives its own data is indistinguishable from a fabricated one, which is
 * the exact thing this feature was built not to be.
 *
 * It broke that rule the day it was written. `.seat-chip { display:inline-flex }`
 * outranks the browser's own `[hidden] { display:none }`, so every failure path
 * drew an empty bordered box in the hero - and no overflow, spacing or meta
 * check could see it, because an empty box is the right size and the right
 * colour. Hence a probe of its own, driving the failures on purpose.
 */
async function seatStates(browser, base) {
  const cases = [
    ["a real count", 200, '{"taken":6,"cap":100,"left":94}', true],
    ["a full instance", 200, '{"taken":100,"cap":100,"left":0}', true],
    ["the worker down", 503, '{"error":"unavailable"}', false],
    ["figures of the wrong type", 200, '{"cap":"lots","left":null}', false],
    ["a reply that is not JSON", 200, "<html>nope", false],
    ["no network at all", null, null, false],
  ];
  const found = [];
  for (const [name, status, body, shouldShow] of cases) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.route("**/seats", (route) =>
      status === null
        ? route.abort()
        : route.fulfill({ status, contentType: "application/json", body }));
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    const chip = page.locator("#seat-note");
    const shown = await chip.isVisible();
    const text = ((await chip.textContent()) || "").trim();
    // Two ways to be wrong: showing when there is nothing to show, and showing
    // an empty box, which is the same failure wearing a border.
    if (shown !== shouldShow) found.push(`${name}: chip ${shown ? "shown" : "hidden"}, expected ${shouldShow ? "shown" : "hidden"}`);
    else if (shown && text === "") found.push(`${name}: chip shown but empty`);
    await page.close();
  }
  return found;
}

const local = LIVE ? null : await serve();
const base = LIVE ? "https://codedrichy.github.io/TargetX/" : local.url;
const browser = await chromium.launch();
let problems = 0;

console.log(`\n${LIVE ? "LIVE" : "LOCAL"}  ${base}\n`);

for (const c of CASES) {
  const opts = c.device ? { ...devices[c.device] } : { viewport: c.viewport };
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const bad = [];
  page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

  if (!LIVE) {
    await page.route("**/api.github.com/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  }

  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), c.theme);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800); // the releases call

  /* Once, on the first case: the tags do not vary by viewport. */
  if (c === CASES[0]) {
    const meta = await page.evaluate(META_PROBE);
    if (meta.missing.length) {
      problems += meta.missing.length;
      for (const m of meta.missing) console.log(`  META    ${m}`);
    } else {
      console.log("  meta    complete");
    }
    /* An og:image that 404s is worse than none: the unfurler shows a broken
       card rather than falling back to text. */
    if (meta.image) {
      const local = meta.image.replace("https://codedrichy.github.io/TargetX/", "");
      const target = LIVE ? meta.image : base + local;
      const res = await page.request.get(target).catch(() => null);
      const ok = res && res.ok();
      console.log(`  og:image ${ok ? "reachable" : "UNREACHABLE"}  ${target}`);
      if (!ok) problems++;
    }
  }

  const dl = await page.evaluate(DOWNLOAD_PROBE);
  const tight = await page.evaluate(SPACING_PROBE);
  const glued = await page.evaluate(GLUED_PROBE);
  /* Only on the real touch devices: a mouse does not need 44px. */
  const small = c.device ? await page.evaluate(TAP_PROBE) : [];
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });

  console.log(`${c.name}`);
  console.log(`  hero    ${dl.heroText}`);
  console.log(`  card    ${dl.for} / ${dl.what}`);
  console.log(`          ${dl.meta}`);
  console.log(`  button  ${dl.btnText} -> ${String(dl.btnHref).replace(/^https:\/\/github\.com\/CodedRichy\/TargetX/, "…")}`);
  console.log(`  row 1   ${dl.firstRow}`);
  console.log(`  overflow ${overflow > 0 ? `+${overflow}px  OVERFLOW` : "none"}`);
  if (tight.length) {
    problems += tight.length;
    for (const t of tight) console.log(`  TIGHT   ${String(t.gap).padStart(3)}px  .${t.box}  under "${t.after}"`);
  } else {
    console.log("  spacing ok");
  }
  if (glued.length) {
    problems += glued.length;
    for (const g of glued) console.log(`  GLUED   no space before the clause in "${g}"`);
  }
  if (small.length) {
    problems += small.length;
    for (const s of small) console.log(`  SMALL   tap target ${s}`);
  }
  if (bad.length) console.log(`  FAILED  ${bad.join(", ")}`);
  if (overflow > 0) problems++;

  await page.screenshot({ path: path.join(OUT, `site-${c.name}.png`), fullPage: true });
  await ctx.close();
  console.log("");
}

/* Local only: it stubs the worker, and against the live site that would be
   testing the stub rather than the page. */
if (!LIVE) {
  const seatProblems = await seatStates(browser, base);
  if (seatProblems.length) {
    problems += seatProblems.length;
    for (const p of seatProblems) console.log(`  SEATS   ${p}`);
  } else {
    console.log("seat chip  shows a real count, and nothing at all without one");
    console.log("");
  }
}

await browser.close();
if (local) local.stop();
console.log(problems ? `${problems} problem(s)` : "clean");
process.exit(problems ? 1 : 0);
