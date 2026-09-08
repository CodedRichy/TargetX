/**
 * What does not fit on a phone, and what is making it not fit.
 *
 * The rule this enforces is absolute: the page never scrolls sideways. A
 * horizontal scrollbar on a phone is not a cosmetic complaint - it means a
 * student swipes down a list and the whole screen slides left, and every
 * column they were reading walks off the edge.
 *
 * Vertical scrolling is NOT a failure and is not reported. The setup wizard is
 * six paragraphs long and no phone is six paragraphs tall; an app that refused
 * to scroll down would have to delete the words instead. Sideways is the axis
 * that must be zero.
 *
 * `measure.mjs` answers the same question for height on a laptop. This is its
 * width-on-a-phone counterpart, and shares its seed so both are looking at the
 * same synthetic semester.
 *
 *   npm run build && node tools/mobile-fit.mjs
 *
 * Exit code is 1 if anything overflows, so this can gate a release.
 */
import { chromium } from "playwright";
import { seed, serve } from "./seed.mjs";

/**
 * The widths that matter, and why these.
 *
 * 320 is the narrowest screen still in real use (an iPhone SE 1st gen, and a
 * long tail of cheap Androids). 360 is the single most common Android CSS
 * width in India, which is this app's audience. 411 is the Pixel 7 the
 * emulator runs. 430 is a large modern phone - included because a layout can
 * also break by having too MUCH room, when something is centred against a
 * max-width that never engages.
 */
const WIDTHS = [320, 360, 411, 430];
const HEIGHT = 900;

/** Screens reachable from the nav, by their accessible button name. */
const SCREENS = ["Home", "Semester", "Attendance", "History", "Data"];

/**
 * Setup is measured separately, and it is not optional.
 *
 * The seed sets `onboarded: true`, so every screen above is the app AFTER
 * setup - and the wizard therefore never rendered in this harness at all. It
 * was the one screen still visibly clipped on a real phone after everything
 * here reported green, which is the worst possible failure for a test: a pass
 * that means "not looked at". It is also the first thing a new student sees.
 */
const SETUP_SEED = { ...seed, onboarded: false };

const { url: URL, stop } = await serve();
const browser = await chromium.launch();

/**
 * The elements that make a phone screen slide sideways.
 *
 * This asked `documentElement.scrollWidth > clientWidth` until that metric was
 * caught doing both of the possible wrong things at once, and neither is a
 * detail:
 *
 *   - IT INVENTED FAILURES, because the contexts below ran with
 *     `isMobile: true` and that turns on Chromium's wide-viewport quirk: the
 *     layout viewport grows to fit scrollable content even where a container
 *     has already clipped it. The attendance timetable sits in a `.grid-frame`
 *     whose right edge is 418px inside a 430px viewport, and
 *     `documentElement.scrollWidth` still read 790; deleting the frame dropped
 *     it to 430. Nothing on the page had ever crossed the edge. Two long hunts
 *     died in that gap, and `isMobile` is off for the same reason (see the
 *     context options).
 *   - IT MISSES REAL ONES. `.screen` carried `overflow: auto`, so History's
 *     seven-column table slid the whole screen sideways under a header that
 *     stayed put on a real phone - and because the box CLIPPED, the document
 *     never grew and this reported green at all four widths. A test that says
 *     "fine" to the exact bug being reported is worse than no test.
 *
 * So the question is asked directly, of the elements themselves, in two parts:
 *
 *   1. Does anything stick out past the viewport that nothing has clipped?
 *      That is a page that scrolls sideways.
 *   2. Does anything scroll sideways INSIDE the page that was not built to?
 *      That is a panel sliding under a frame that does not move with it.
 *
 * Deliberate scrollers are named below and are exempt from (2). They are the
 * answer to content that genuinely cannot fit a phone, and there should only
 * ever be a few - a list that keeps growing is the signal to redesign a screen
 * for the phone rather than to add a line here.
 */
const ALLOWED_SCROLLERS = [
  // Content that genuinely cannot fit a phone, sliding under a still frame.
  ".ledger-scroll", ".history-scroll", ".grid-frame", ".grid-scroll", ".diag",
  // The semester chips, which slide inside the strip on a phone. Eight chips
  // fit a 411px screen and do not fit a 320px one, and chips that scroll are
  // the right answer to that - shrinking "S1" further is not.
  //
  // `.sems-scroll` and not `.sems`: the strip used to be the scroller itself,
  // which meant "+" was part of the scrolled content and left the screen with
  // the chips - the only control that adds a semester, 95px past the right
  // edge. The chips scroll in their own box now and "+" sits outside it, so
  // the name here follows the box that actually clips.
  ".sems-scroll",
  // Not a scroller at all: 1px of clipped screen-reader text, which reports a
  // "slide" it was built to have. Ellipsis truncation is exempted below by its
  // own declaration rather than by name.
  ".sr-only",
];

async function offenders(page, width) {
  return page.evaluate(({ vw, allowed }) => {
    const name = (el) => [
      el.tagName.toLowerCase(),
      el.id ? `#${el.id}` : "",
      el.className && typeof el.className === "string"
        ? `.${el.className.trim().split(/\s+/).join(".")}`
        : "",
    ].join("");

    /**
     * The nearest ancestor that clips, or null when the spill reaches the page.
     *
     * The walk stops BEFORE `body`, which carries `overflow-x: hidden` as a
     * last-resort guard. Counting that as a clipper would make every element on
     * every screen "contained" and check (1) could never fire again - the guard
     * would have silenced the test that exists to make it unnecessary. Content
     * hidden by it is not content that fits; it is content nobody can reach.
     */
    const clipper = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === "auto" || ox === "hidden" || ox === "scroll") return a;
      }
      return null;
    };

    const out = {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      culprits: [],
    };

    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      // (1) Past the edge, with nothing above it to clip it.
      const spill = Math.round(r.right - vw);
      if (spill > 1 && !clipper(el)) {
        out.culprits.push({ el: name(el), width: Math.round(r.width), spill, why: "past the edge" });
        continue;
      }

      // (2) A box that scrolls sideways and was never meant to.
      const slide = el.scrollWidth - el.clientWidth;
      const cs = getComputedStyle(el);
      if (slide > 1 && el.clientWidth > 0
          && el !== document.body && el !== document.documentElement
          && cs.overflowX !== "visible"
          // `text-overflow: ellipsis` IS the author saying "this text is meant
          // to be wider than its box, cut it and show why". A subject name
          // trimmed to an ellipsis is the design working, not a screen sliding.
          && cs.textOverflow !== "ellipsis"
          && !allowed.some((sel) => el.matches(sel))) {
        out.culprits.push({ el: name(el), width: el.clientWidth, spill: slide, why: "slides inside" });
      }
    }
    out.culprits.sort((a, b) => b.spill - a.spill);
    out.culprits = out.culprits.slice(0, 6);
    return out;
  }, { vw: width, allowed: ALLOWED_SCROLLERS });
}

let failures = 0;

for (const width of WIDTHS) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHT },
    deviceScaleFactor: 2,
    /*
     * OFF, deliberately, and the touch flag carries what was wanted from it.
     *
     * `isMobile: true` enables Chromium's wide-viewport quirk, under which the
     * layout viewport expands to fit content that a container has already
     * clipped - so a correctly-framed timetable reported the page as 790px
     * wide inside a 430px window. This app ships `width=device-width`, which
     * is exactly what a plain viewport of that width already models, so the
     * flag bought emulation of a behaviour the app opts out of and cost two
     * false failures per run.
     */
    isMobile: false,
    hasTouch: true,
  });
  await context.addInitScript((data) => {
    localStorage.setItem("targetx.state.v1", JSON.stringify(data));
  }, seed);
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  /*
   * Wait for the launch overlay to go.
   *
   * `.boot` is `position: fixed; inset: 0`, so it is normally exactly the
   * viewport - but it is on screen only while `phase() !== "done"`, and
   * measuring during it reports the transient rather than the app. Worse, it
   * reports a MISLEADING transient: under mobile emulation the layout
   * viewport grows to fit overflowing content, the fixed overlay grows with
   * it, and the overlay then looks like the thing that overflowed. Two
   * separate hypotheses died on that before the overlay was found to be a
   * passenger rather than the cause.
   */
  await page.waitForSelector(".boot", { state: "detached", timeout: 15000 })
    .catch(() => console.log(`[warn] ${width}px  launch overlay never cleared`));

  await page.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch { /**/ } });
  });

  for (const screen of SCREENS) {
    // `force` deliberately. At phone width the header controls currently sit
    // ON TOP of each other - Playwright's actionability check reports `.tabs`
    // and `.homebtn` intercepting one another's clicks - and an ordinary click
    // times out. That overlap is one of the things this tool exists to expose,
    // so it must not also prevent the tool from running.
    const button = page.getByRole("button", { name: screen, exact: true });
    if (await button.count()) {
      try {
        await button.first().click({ force: true, timeout: 5000 });
      } catch {
        console.log(`[warn] ${width}px  could not reach "${screen}" - measuring what is on screen`);
      }
      await page.waitForTimeout(150);
      await page.evaluate(() => {
        document.getAnimations().forEach((a) => { try { a.finish(); } catch { /**/ } });
      });
    }

    const report = await offenders(page, width);
    if (report.culprits.length > 0) {
      failures += 1;
      console.log(`\n[FAIL] ${width}px  ${screen}`);
      for (const c of report.culprits) {
        console.log(`         +${String(c.spill).padStart(4)}px  w=${String(c.width).padStart(4)}  ${c.el}  (${c.why})`);
      }
    } else {
      console.log(`[ok]   ${width}px  ${screen}`);
    }
  }

  await context.close();

  // The wizard, in its own context because it needs a different seed.
  const setupCtx = await browser.newContext({
    viewport: { width, height: HEIGHT },
    deviceScaleFactor: 2,
    isMobile: false,  // see the note on the context above
    hasTouch: true,
  });
  await setupCtx.addInitScript((data) => {
    localStorage.setItem("targetx.state.v1", JSON.stringify(data));
  }, SETUP_SEED);
  const setupPage = await setupCtx.newPage();
  await setupPage.goto(URL, { waitUntil: "networkidle" });
  await setupPage.evaluate(() => document.fonts.ready);
  await setupPage.waitForSelector(".boot", { state: "detached", timeout: 15000 }).catch(() => {});
  await setupPage.evaluate(() => {
    document.getAnimations().forEach((a) => { try { a.finish(); } catch { /**/ } });
  });

  const setupReport = await offenders(setupPage, width);
  if (setupReport.culprits.length > 0) {
    failures += 1;
    console.log(`\n[FAIL] ${width}px  Setup`);
    for (const c of setupReport.culprits) {
      console.log(`         +${String(c.spill).padStart(4)}px  w=${String(c.width).padStart(4)}  ${c.el}  (${c.why})`);
    }
  } else {
    console.log(`[ok]   ${width}px  Setup`);
  }
  await setupCtx.close();
}

await browser.close();
await stop();

console.log(failures === 0
  ? "\nNo horizontal overflow at any tested width."
  : `\n${failures} screen/width combination(s) scroll sideways.`);
process.exit(failures === 0 ? 0 : 1);
