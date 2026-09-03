# Website rework brief

Captured 2026-09-03, before the design hook was silenced for `docs/`. The hook
was firing these on every single turn while the actual work was in `app/`, so
it was muted deliberately rather than by neglect — this file is where the
findings went.

`docs/index.html` and `docs/privacy.html` are in `detector.ignoreFiles`. **Undo
that at the start of the rework session** so the hook helps again:

    node ~/.claude/plugins/cache/impeccable/impeccable/4.0.2/skills/impeccable/scripts/hook-admin.mjs status
    # then edit .impeccable/config.json, or `reset` to clear everything

The list below is what the hook reported. It is not authoritative — regenerate
it first. The static detector runs as-is; the rendered rules (contrast, text
size, clipped overflow) need puppeteer, which is not installed:

    npm install puppeteer          # once, in app/ or a scratch dir
    node .../scripts/detect.mjs docs/index.html docs/privacy.html
    # and for the rendered pass, serve docs/ and scan the URL

## Reported, static — confirmed by running the detector

- **`overused-font`** — Space Grotesk, `index.html:32` and `privacy.html:26`.
  Deliberately kept and now whitelisted globally: it is the app's typeface too,
  and splitting the site from the product to satisfy a lint is the wrong trade.
  Revisit as a product-wide type decision or not at all.
- **`em-dash-overuse`** (advisory) — 26 em-dashes in `index.html` body copy, near
  one per 500 characters. Advisory only, never a failure. Worth a pass anyway:
  the density is a tell, and the copy reads better with some of them as commas
  or full stops.

## Reported by the rendered pass — NOT re-verified, regenerate before acting

Roughly 27 findings on `index.html`, 10 on `privacy.html`. The named ones:

- **`low-contrast`** — text under WCAG AA (4.5:1 body, 3:1 large).
- **`tiny-text`** ×3 — body text below 12px.
- **`undersized-ui-text`** ×3 — functional text below 11px. Being on the
  DESIGN.md ramp is explicitly not an exemption for this rule.
- **`all-caps-body`** — a long uppercase passage. Uppercase is for short labels.
- **`hero-eyebrow-chip`** — the small uppercase kicker above the hero headline.
  Fold it into the headline or drop it.
- **`clipped-overflow-container`** — an `overflow: hidden` ancestor clipping an
  absolutely-positioned child, so a tooltip or popover cannot escape.

## One thing to settle before any of it

The audience may be about to change. If TargetX moves toward institutional
customers, this site is read by principals and controllers of examinations, not
students — which changes the copy, the proof, and what the page is for well
before it changes the typography. Decide the reader first; redesigning for the
wrong one is the expensive mistake here, not the em-dashes.
