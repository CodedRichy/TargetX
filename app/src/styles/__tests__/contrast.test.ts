/**
 * Contrast, as an assertion rather than as a memory.
 *
 * Every ratio here was wrong once. `--text-faint` sat at 2.95:1 on
 * `--surface-2` while being the colour of every table header, every `/40`
 * denominator and the PENDING pill; the status pills ran 3.32-4.50:1, and
 * those pills are the non-colour carrier of SAFE / SHORTAGE / DEBARRED, so
 * they are the one thing on the screen that has to survive being read badly.
 *
 * Checking it once and writing the numbers into a report would leave the next
 * nudge of a token free to undo it silently, because nothing about a colour
 * says it has become unreadable. So the tokens are parsed out of the real
 * stylesheet and the ratios are computed here.
 *
 * Two things this deliberately does NOT do:
 *
 *   - It does not assert the hairlines or the surfaces against the page.
 *     SC 1.4.11 covers visual information REQUIRED to identify a control; row
 *     rules and card edges are decorative and the segment faces carry their own
 *     text. Asserting them would be conformance theatre and would block a
 *     legitimate design change.
 *   - It does not test the rendered DOM. This is arithmetic on the token file,
 *     which is where the decision lives.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Read as a file rather than imported with Vite's `?raw`. This suite runs in
// the node environment, where a `?raw` CSS import comes back through Vite's
// stylesheet handling rather than as the text of the file.
const CSS = readFileSync(new URL("../tokens.css", import.meta.url), "utf-8");

type Oklch = { l: number; c: number; h: number; alpha: number };

/**
 * The value of one custom property, inside one selector block.
 *
 * Both themes define the same names, so a plain search of the file would
 * always return the dark one.
 */
function token(selector: string, name: string): Oklch {
  const block = CSS.slice(CSS.indexOf(selector));
  const line = new RegExp(`${name}\\s*:\\s*oklch\\(([^)]+)\\)`).exec(block);
  if (!line) throw new Error(`no ${name} under ${selector}`);
  const [values, alpha] = line[1]!.split("/");
  const parts = values!.trim().split(/\s+/).map(Number);
  return {
    l: parts[0]!, c: parts[1]!, h: parts[2]!,
    alpha: alpha === undefined ? 1 : Number(alpha),
  };
}

const dark = (name: string) => token(":root {", name);
const light = (name: string) => token(':root[data-theme="light"]', name);

/** OKLCH to linear sRGB. Linear, because that is what luminance is defined on. */
function linear({ l: L, c: C, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad);
  const b = C * Math.sin(rad);
  const lc = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.7076147010 * sc,
  ];
}

const luminance = (rgb: [number, number, number]) =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];

function ratio(fg: Oklch, bg: [number, number, number]): number {
  const a = luminance(linear(fg));
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** A translucent wash composited over a ground, in linear light. */
function washOver(wash: Oklch, ground: Oklch): [number, number, number] {
  const top = linear(wash);
  const base = linear(ground);
  return top.map((c, i) => c * wash.alpha + base[i]! * (1 - wash.alpha)) as
    [number, number, number];
}

const AA = 4.5;

describe.each([
  ["dark", dark] as const,
  ["light", light] as const,
])("%s theme", (_name, t) => {
  const grounds = ["--bg", "--surface-1", "--surface-2"] as const;

  it("sets body text well clear of AA on every ground", () => {
    for (const ground of grounds) {
      expect(ratio(t("--text"), linear(t(ground)))).toBeGreaterThanOrEqual(AA);
      expect(ratio(t("--text-dim"), linear(t(ground)))).toBeGreaterThanOrEqual(AA);
    }
  });

  it("keeps the faintest text readable, including on the darkest card", () => {
    // This is the one that failed, and `--surface-2` is where it failed worst.
    for (const ground of grounds) {
      expect(ratio(t("--text-faint"), linear(t(ground)))).toBeGreaterThanOrEqual(AA);
    }
  });

  it.each(["good", "warn", "danger"])(
    "keeps a %s status pill readable on its own wash", (status) => {
      // A pill is its colour on a low-alpha tint of itself, over either the
      // page or a card. Colour alone must not carry status, so the text that
      // does carry it has to be legible - which it was not.
      const ink = t(`--${status}`);
      const wash = t(`--${status}-wash`);
      for (const ground of ["--bg", "--surface-1"] as const) {
        expect(ratio(ink, washOver(wash, t(ground)))).toBeGreaterThanOrEqual(AA);
      }
    });

  it("puts the brand and its text on each other legibly", () => {
    // Brand is link text as well as the focus ring, so it is held to 4.5:1 on
    // cards and not only on the page.
    for (const ground of grounds) {
      expect(ratio(t("--brand"), linear(t(ground)))).toBeGreaterThanOrEqual(AA);
    }
    expect(ratio(t("--on-brand"), linear(t("--brand")))).toBeGreaterThanOrEqual(AA);
  });

  it("draws the focus ring against the surfaces it is drawn on", () => {
    // A non-text indicator: SC 1.4.11 asks for 3:1, not 4.5:1.
    for (const ground of grounds) {
      expect(ratio(t("--brand"), linear(t(ground)))).toBeGreaterThanOrEqual(3);
    }
  });

  it("stays inside sRGB, so the rendered colour is the specified one", () => {
    // Out-of-gamut OKLCH is clipped by the browser, which changes the colour
    // and therefore the ratio measured above. `--warn` in the light theme was
    // outside sRGB at its old chroma, so the yellow that shipped was never the
    // yellow written in the file.
    for (const name of ["--text", "--text-dim", "--text-faint", "--brand",
                        "--on-brand", "--good", "--warn", "--danger",
                        "--good-wash", "--warn-wash", "--danger-wash",
                        "--bg", "--surface-1", "--surface-2"]) {
      for (const channel of linear(t(name))) {
        expect(channel, `${name} is outside sRGB`).toBeGreaterThan(-0.001);
        expect(channel, `${name} is outside sRGB`).toBeLessThan(1.001);
      }
    }
  });
});
