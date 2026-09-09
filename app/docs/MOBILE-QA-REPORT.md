# Mobile QA report — tap targets, text clipping, and overflow a rect sweep cannot see

Headless Playwright audit of the Android/phone layout at **320 / 360 / 411 / 430 px**.
Companion to `tools/mobile-fit.mjs`, which answers a different and narrower question.

`mobile-fit.mjs` proves that **no element crosses the viewport edge**. That is necessary and
it is not sufficient. It says nothing about whether a control is large enough to hit with a
thumb, whether text is being cut off inside a box that fits, or whether *text* — which has no
element and no rect — is pushing the page sideways. Every finding below sat behind a green
`mobile-fit.mjs` run.

---

## How to reproduce any measurement in this document

1. **`npm run build` first, every time.** `tools/mobile-fit.mjs` and anything using
   `seed.mjs`'s `serve()` serve `dist/`, **not** the dev server. Measuring without rebuilding
   measures a stale bundle, and the failure output is byte-identical to a real one.
2. **Never pipe a gate through `tail`.** In a pipeline the exit status is the *last* command's,
   so a failing gate walks through an `&&` chain unnoticed. Use
   `node tools/x.mjs; echo "EXIT=$?"` or `${PIPESTATUS[0]}`.
3. Contexts use `isMobile: false, hasTouch: true`, matching `mobile-fit.mjs`. `isMobile: true`
   enables Chromium's wide-viewport quirk and invents overflow failures — see the long note in
   `mobile-fit.mjs`.
4. The seed is `tools/seed.mjs`'s shared `seed`, so these numbers and any screenshot of the
   same state are of the same app.

**Watch for concurrent builds.** One run here died with `ENOENT: dist/index.html` because
another agent rebuilt mid-run. If a run fails that way the results are partial, not clean.

---

## Finding A — Home was 7px wider than the viewport at 320px — **FIXED (`8685f82`)**

At 320px the Home document measured **327px** against a 320px viewport. `body` carries
`overflow-x: hidden` as a last-resort guard, so the excess was not scrollable — it was
unreachable.

**No element's rect crossed the edge.** `maxRight` was `320 (html)`; the "past the edge" list
and the suspect-pseudo-element list were both empty. The overflow was **text** overflowing a
flex item that was itself too narrow. Text has no element and no rect, so a rect-based sweep
cannot see it, and `mobile-fit.mjs` reported `[ok] 320px Home`.

Location: `div.bento > section.tile > ul.concerns > li`. The row is
`dot | <b> subject name | <span> description`, and the `<b>` was `flex-shrink: 0`.

| row | `<b>` subject | `<b>` width | shrink | `<span>` width | widest word | word needs |
|---|---|---|---|---|---|---|
| 1 | Artificial Intelligence | 133.5px | 0 | 97.3px | "condonation" | 82.4px — fits |
| 2 | Design and Analysis of Algorithms | **218.6px** | **0** | **12.3px** | "classes" | **47.8px** |

Row 2's text painted from the row's right edge (291) out to
`291 + (47.8 − 12.3) = 326.5` ≈ the observed **327**.

Root cause was confirmed three independent ways, each dropping `docW` 327 → 320:
`overflow-wrap: anywhere` on the span; `flex-shrink: 1` on the `<b>`; `flex-wrap: wrap` on the row.

**The squeeze mattered more than the 7px.** With the name unshrinkable at 218.6px the
description was crushed to **12.3px** — about two characters — so the explanatory sentence was
destroyed at 320px whether or not the page overflowed.

Fixed by wrapping the row (`flex-wrap: wrap`, plus `flex: 1 1 100%; overflow-wrap: anywhere`
on the span) rather than by letting the `<b>` shrink — `screens.css` documents `flex: none` on
the name as load-bearing, because a shrinking name prints on top of the detail.
**Verified: Home `docW` 320 = viewport at 320px.**

---

## Finding B — the documented 44px tap-target floor holds only where its author enumerated it

`mobile.css` applies the floor at `:216`, `:229`, `:242`, `:281`, `:283`, `:745`, `:756`,
`:766`, `:920`, `:933`, `:1021`, `:1272`, and it genuinely works for the ledger, the History row
controls, `.del` and `.goal-input` in the goal bar. The gaps are all of one kind: **a floor
written for a specific selector, or for one axis, while the same control class exists
elsewhere or on the other axis.**

### B3 — `.sem` chips met the floor on the block axis only — **FIXED (`8685f82`)**

`button.sem` "S5" was **43×44** and the "+" chip (`aria-label="Add S1"`) **35×44** at every
width: 44px tall, under 44 wide. Now 44×44 on both axes. **Verified: Semester is clean at all
four widths.**

### B1 — the Data screen has no floor at all — **OPEN**

Twelve controls, identical at 320 / 360 / 411 / 430 (width varies with viewport, height does not):

| Control | Size | Note |
|---|---|---|
| `a.link` "the privacy statement" | 266–372 × **24** | smallest text target in the app |
| `button.on` "Attendance" | 109 × **30** | import source tab |
| `button` "Series marks" | 115 × **30** | import source tab |
| `button.primary` "Import" | 77 × **38** | |
| `button.primary` "Import pasted card" | 158 × **38** | |
| `button.primary` "Fetch from KTU" | 132 × **38** | |
| `button.primary` "Check for updates" | 153 × **38** | |
| `button.primary` "Export backup" | 129 × **38** | |
| `button.danger` "Erase everything" | 142 × **38** | **fix first** |
| `button.ghost` "Restore backup" | 135 × **38** | sits beside "Erase everything" |
| `button.ghost` "Open PDF or text file" | 166 × **38** | |
| `button.ghost` "Export semester report" | 184 × **38** | |
| `button.ghost` "Open a saved portal page" | 198 × **38** | |

"Erase everything" is the most destructive control in the app, it is 38px tall, and its
neighbour is "Restore backup". That pairing at that size is the highest-risk item on this list.

Also on Data, from the device lane: two `input[type=checkbox]` "Remember this login on this
device" measured **16×16**. They are not in the headless list because the checkbox renders at
its UA size; confirm whether a wrapping `<label>` provides the hit area before sizing them.

### B2 — Home, two controls, all four widths — **OPEN**

| Control | Size |
|---|---|
| `button.link` "History" | 48 × **38** |
| `button.ghost` "Open the semester" | 262–372 × **38** |

Both persist in every Home state measured, including with the palette, profile menu or bell open.

---

## Finding C — no text clipping anywhere, in any state — **CLEAN**

Zero clipped text, zero line-clamped elements losing content, and zero unclipped spill across
all 20 base-state and all 48 interaction-state combinations.

**Exclude `.sr-only` or this check is 90% noise.** Screen-reader text is deliberately clipped to
a 1px box, which trips any `scrollWidth > clientWidth` test — 15 hits per Attendance screen
alone (`"Present — Computer Networks"`, `"Duty leave — Software Engineering"`, …). Those are the
design working. `text-overflow: ellipsis` is likewise intentional truncation and is reported
separately rather than as a defect.

---

## Finding D — interaction states, where the remaining floor gaps live — **OPEN**

Static-load checks are exactly how a control hides. Twelve interaction states were opened and
re-measured at all four widths (48 combinations). **No overflow and no clipped text appeared in
any of them** — every finding is a tap target.

### D1 — `button.pop-x` is 20×20 — the smallest target in the app

In the bell popover, the per-notification dismiss buttons measure **20×20** at every width:

```
20x20  button.pop-x  "Dismiss: 2 subjects below the attendance line"
20x20  button.pop-x  "Dismiss: Last synced 21 days ago"
```

Less than a quarter of the floor's area. This is the one I would fix after "Erase everything".

### D2 — the confirm-inline row repeats the B3 mistake, on the other axis

Pressing "Remove S5" (Semester) or a History row'
