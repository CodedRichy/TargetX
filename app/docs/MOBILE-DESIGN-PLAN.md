# Mobile design plan — S4 onward

Phone UI plan for the Android build, written to be implemented from rather than
read. Every phone-specific rule belongs inside the existing
`@media (max-width: 720px)` block in `src/styles/mobile.css`, or behind
`isNarrow()` in `src/state/platform.ts`. **Desktop must not change.**

Standing constraints, from the user, verbatim:

- "keep iterating untill the app looks clean, organized and not cluttred"
- "why are there scroll bars??? no scroll bars. the screem should fit perfectly
  for any device"
- "it should be exactle the app but in the phone okay. do not miss anything out"
  — absolute feature parity. **Nothing may be dropped, hidden behind a
  discovery, or made unreachable to reduce clutter.** Reorganise, don't amputate.
- "so many elements going outside boundary"

Touch targets ≥44px. Nothing may depend on hover. Use the existing tokens; where
a token is genuinely missing this document names it and gives an OKLCH value.

## Measurement baseline

Emulator, 1080×2400 @ 420dpi → **411×914 CSS**, `devicePixelRatio` 2.625.
Captured before the 44px floor landed, so every pixel figure below is a
**pre-S1 baseline and needs re-measuring** before it is quoted as current.

| Thing | Measured (pre-S1) |
| --- | --- |
| `.head` height | 156px (17% of viewport) |
| `.goalbar` height | 94px |
| First subject card top, Semester | y = 250 — **27% of the screen is chrome** |
| `tr.row` card height | 304px, 12px gaps → **2.26 cards visible** |
| `.tabbar` height | 71px |
| Header children | ask 387, sems 240, refresh 34, bell 34, profile 48 |
| Controls ≥44px on Semester | **0 of 26** (fixed by S1) |
| Document horizontal overflow | **0px** — holds, do not disturb |
| Page heights | Attendance 3762, Data 2264, Semester 1902 |

## What is already right — do not touch

- Horizontal overflow is zero and `mobile-fit.mjs` guards it at 320/360/411/430
  across six screens. That work is finished.
- `.grid-table { min-width: 0 }` was correct: the attendance calendar measures
  386/386 in a 386px frame. It fits; it does not scroll; it is not clipped.
- The **timetable day view** and the **Attendance subject card** are properly
  designed objects. S3 copies the latter; nothing here should invent a third
  pattern when that one already works.
- The bottom tab bar is right on every count — five destinations, none buried,
  22px icons, correct `max()` gesture inset.

---

# S4 — 27% of the screen is chrome before the first subject

**Tier: Structural.**

## What's wrong

On four of the five screens the header's first row is mostly empty air. Its
three controls total 116px of content in a 387px strip, so Home, Attendance,
History and Data each render two icons hard left, an avatar hard right, and
**271px of nothing between them**. That does not read as restraint; it reads as
a row that lost its contents — which is exactly what happened when the view tabs
and the wordmark correctly moved to the bottom bar. Ask then takes a second
full-width row on every screen, and Semester stacks a 94px goal bar on top of
that. The result is a quarter of the display spent before the student sees a
single subject.

A screenshot of Home shows this plainly: a refresh glyph and a bell at the far
left, a circular avatar at the far right, and a wide horizontal void between
them, above a full-width pill containing one line of placeholder text.

## The fix

### 1. One header row, not two

```css
/* Inside @media (max-width: 720px) */

/*
 * Ask does not need a row of its own; it needs to BE the row.
 *
 * The header wraps because its children once overflowed. They no longer do -
 * the tabs and the wordmark left for the bottom bar - so wrapping now buys
 * nothing and costs a row on all five screens, with 271px of dead space in
 * the row it kept. `nowrap` with a shrinkable field is the same fix the
 * overflow work used, pointed at emptiness instead of at overflow.
 */
.head { flex-wrap: nowrap; gap: var(--s2); }
.head .ask     { order: 1; flex: 1 1 auto; min-inline-size: 0; margin-inline: 0; }
.head .refresh { order: 2; }
.head .bell    { order: 3; }
.head .profile { order: 4; margin-inline-start: 0; }
```

`.ask` keeps its 48px floor from S1 and its existing ellipsis rule at
`mobile.css` — a field that truncates is still a field.

### 2. The semester strip leaves the header

It is not app chrome. It scopes the page, which is why it only renders on one
screen, and why leaving it in the header forced the explicit `order` rules that
exist today solely to stop refresh and the bell jumping half a screen sideways
as the student changes view. Move it into the Semester screen's own first row.

`App.tsx`: render the existing `<nav class="sems">` inside `GoalBar` when
`isNarrow()`, before the target inputs. Same markup, same component, same
handlers — only its position in the tree changes.

```css
.head .sems { display: none; }   /* it lives in the goal bar on a phone now */

/*
 * The goal bar becomes the semester's own header: which semester, what it is
 * being held to, and how far off it is. Three rows that read as one block,
 * rather than a strip of app chrome above an unrelated strip of page chrome.
 */
.goalbar { flex-wrap: wrap; gap: var(--s2) var(--s3); padding: var(--s2) var(--s3); }
.goalbar .sems {
  flex: 1 1 100%;
  order: -1;                     /* the strip leads the block */
  overflow-x: auto;
  scrollbar-width: none;         /* harmless here; the native bar is killed in MainActivity */
}
.goalbar .sems::-webkit-scrollbar { display: none; }
.goalbar > * { min-width: 0; }
```

The existing `order` rules for `.head .refresh`, `.head .bell` and `.head .sems`
at `mobile.css` become dead once the strip leaves — **delete them** rather than
leave selectors that no longer describe the layout.

## Cost

**Honest pixel accounting, and it is smaller on Semester than it first looks.**

- Non-Semester screens: header goes from two rows to one. Roughly
  `52 (inset) + 8 + 44 + 8 + 48 + 8 = 168` down to `52 + 8 + 48 + 8 = 116`.
  **~50px saved on Home, Attendance, History and Data**, and the 271px void
  disappears entirely.
- Semester: the same ~50px comes off the header, but the strip adds a ~38px row
  to the goal bar. **Net ~12px.** The win on Semester is not height — it is that
  the strip and the targets finally read as one "this semester" block, and the
  icons stop moving between screens.

**Re-measure after S1.** These are pre-44px-floor numbers.

**What it trades away.** Ask's placeholder truncates earlier at 411px. That is
already an accepted trade in `mobile.css`, which argues correctly that a field
with words in it is still a field. It also re-opens the deliberate decision in
commit `ecd95f2` to give Ask a full-width row of its own — that decision is
costing every screen a row, and it should be re-litigated rather than inherited.

Sequencing note: do **S3 before S4**. S4's reclaimed pixels are only worth having
once the cards they reveal are worth showing.

---

# S5 — the Ask Tex palette

**Tier: Structural.**

## What's wrong

Tapping the app's headline feature dims and blurs the entire screen — the full
cost of a modal — and delivers **one line**: the Tex face, a placeholder, and a
close glyph. No suggestions, no recent questions, no examples, nothing. The
placeholder is a 46-character sentence rendered at `--text-lg` in a field about
250px wide, so it **hard-clips mid-sentence with no ellipsis** — the prompt
simply stops. In dark theme the sheet is a near-black strip on a blurred
near-black app, separated by a single hairline, which reads as a rendering fault
rather than a surface.

A screenshot of the open palette shows a shallow rounded strip at the top of the
screen containing the face, the words "Ask Tex — how many classes" ending
abruptly, and a close glyph — with the whole application blurred out beneath it
and nothing else on screen.

## The fix

### 1. Give the sheet a body

`mobile.css` already caps the palette at `100dvh`. Let it claim it, and fill it.

```css
/*
 * The palette fills the screen it is already dimming.
 *
 * The note above this rule argued against filling the display because "an
 * empty palette that fills the screen is a black void with one line of
 * placeholder in it". That observation is right and the conclusion is
 * backwards: the answer is to stop it being empty, not to shrink the void.
 * This surface is one of the three ways into the record the app is sold on,
 * and it currently spends a full-screen modal to show a text field.
 */
.palette {
  min-block-size: 100dvh;
  border-radius: 0;
  justify-content: flex-start;
}

/* 16px floor: anything smaller triggers the WebView's zoom-on-focus, which
   jumps the whole page the moment the student taps the field. */
.palette-input { font-size: 16px; }
```

Below the field, render suggested questions: the glossary terms already in
`state/glossary` (which is what the ask box answers definitions from) plus the
student's own at-risk subjects, so the first thing in the sheet is a question
worth tapping rather than an empty page.

### 2. Shorten the prompt

`Palette.tsx` — the placeholder becomes `Ask ${ASSISTANT} a question`. The long
example (`how many classes can I miss in ML?`) moves into the body as the first
suggestion. **A placeholder that cannot fit its field is not a placeholder.**

## Cost

Filling the screen removes tap-outside-to-close, which the current layout
deliberately preserved by leaving the scrim visible. `.palette-close` already
exists with `var(--s4)` padding and covers the case — but it must then be
unmistakable, not a `--text-faint` glyph in a corner. Give it the app's own
`--text` colour at 44px.

Building the suggestion list is real work and touches `Palette.tsx`, not just
CSS. It is the largest non-card item in this plan.

---

# R6 — dark mode: the cards disappear

**Tier: Refinement. High impact.**

**Confirmed still open:** `--surface-1` is `oklch(0.195 0.013 68)` and
`--edge-hi` is `oklch(1 0 0 / 0.13)` in the dark block of `tokens.css`.

## What's wrong

`--bg` at L 0.145 against `--surface-1` at L 0.195 is a lightness difference of
**0.05 — about 1.28:1**. The lit rim that is supposed to rescue it,
`--edge-hi`, is white at only **0.13 alpha**. At 411px with a 12px gutter, a
card's edges are two near-invisible hairlines against a near-identical field, so
the Semester screen becomes one flat black sheet with text floating on it and
the tab bar barely detaches from the page.

Side by side, the same screen with the same data in light and dark is the whole
argument: the light capture has obvious containers with visible edges and a
clear ground/card separation; the dark capture has none — the card boundaries
are only findable if you already know where they are.

`tokens.css` records this exact audit being performed **for light mode**, where
`--edge-hi` was strengthened to 0.24 because the card edge had stopped reading
against the cream ground. Dark never received the same pass, and dark needs it
more: light has near-white cards *and* a strong dark rim, while dark has a weak
lift *and* the weaker rim.

## The fix

In the dark block of `tokens.css` only:

```css
  /* Was 0.195. The gap to `--bg` was 0.05 of lightness, which at a 12px gutter
     is not a container - it is a tone change the eye does not resolve as an
     edge. 0.215 gives 0.07 and lets elevation carry some of the work the rim
     was carrying alone. */
  --surface-1: oklch(0.215 0.013 68);

  /* Was 0.13/0.04/0.01. Light mode was already strengthened once for exactly
     this defect and is documented as such above; dark has the same defect with
     less lightness separation to fall back on. 0.20 is still well under the
     plastic-bevel threshold - one hairline of light on a top edge, not a
     border. */
  --edge-hi:  oklch(1 0 0 / 0.20);
  --edge-mid: oklch(1 0 0 / 0.07);
  --edge-lo:  oklch(1 0 0 / 0.02);
```

## The test that should have caught this

**Confirmed gap:** `src/styles/__tests__/contrast.test.ts` iterates
`["--bg", "--surface-1", "--surface-2"]` as *grounds for text*, but never
asserts separation **between** two grounds. That is precisely why the light pass
caught this defect and the dark pass did not.

Add a ground-to-ground assertion: for each theme, the lightness difference
between `--bg` and `--surface-1` must be **≥ 0.06**, and between `--surface-1`
and `--surface-2` likewise. Parse the OKLCH L component the same way the file
already parses colours for its ratio maths. Without this, the value above drifts
back the next time someone tunes the dark palette by eye.

## Cost

A slightly less inky dark theme — the ground/card separation is deliberately
visible where it used to be subliminal. That is the trade, and it is worth it: a
card you cannot see is not a card, and the whole information architecture of
this app is "these things are grouped".

---

# R7 — the analytics panel has no vertical rhythm

**Tier: Refinement.**

**Confirmed still open:** `app.css` still has `.chart-block { margin-bottom: var(--s6); }`.

## What's wrong

The section heading `ATTENDANCE VS INTERNALS` sits with **zero space above it**
and `--s2` below — a heading closer to the paragraph it has nothing to do with
than to the content it introduces. One inversion like that makes an entire panel
read as unlaid-out, and it is the most visible spacing fault on the screen.

The cause is exact and mechanical. `.chart-block` carries `margin-bottom` only,
so it spaces *below* blocks and never above them. `Drawer.tsx` renders a loose
`<p class="chart-note">` — the paragraph pointing at the Targets tab — **between**
two `.chart-block`s. That orphan paragraph inherits 32px above it from the
previous block's bottom margin and has nothing below it, so the next block's
`h4`, which is `margin: 0 0 var(--s2)`, lands directly on the last line of a
sentence it is unrelated to.

It reproduces on both an empty and a populated semester, so it is structural,
not data-dependent.

## The fix

```css
/*
 * Space BETWEEN blocks, not below them.
 *
 * `margin-bottom` alone left anything rendered between two chart blocks - the
 * Targets pointer paragraph in Drawer.tsx - with 32px above it and nothing
 * below, so the next section heading butted straight onto a sentence it has
 * no relationship to. An owl selector spaces siblings regardless of what they
 * are, which is what a panel of mixed headings, charts and prose needs.
 */
.chart-block { margin-bottom: 0; }
.drawer > * + * { margin-block-start: var(--s6); }
.drawer h4 { margin-block-start: 0; }   /* the heading owns its block, not the gap */
```

Then give the panel's sections containers on the phone, so it stops reading as a
document appended to the end of an app screen:

```css
/* Inside @media (max-width: 720px) */
.drawer .chart-block {
  background: var(--surface-1);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-card);
  padding: var(--s4);
}
```

## Cost

`.drawer > * + *` fires on desktop too. Verify the 340px column still reads
correctly; if it does not, scope the owl inside the media query and leave the
desktop panel on its current `margin-bottom`.

---

# R8 — every screen speaks a different surface language

**Tier: Refinement.** History's half of this shipped; the rest is open.

## What's wrong

Three idioms remain across the app, with nothing to tell a student why.

**Home** stacks a `--surface-2` grey "Standing" tile directly above
`--surface-1` near-white cards — two different elevations for peers in a single
vertical list. The capture shows a visibly greyer block sitting immediately
above a visibly whiter one, both full width, both cards, both the same kind of
thing.

**Semester's analytics panel** is a full-bleed `--surface-1` slab with a hard
`border-top`, which draws a **seam straight across the page** at whatever scroll
position it happens to occupy, and then changes the page's ground colour for
everything below it. In a scrolled capture it reads as two documents stapled
together.

**Home's left edge is broken.** The heading "Where you stand" begins at x≈74
because Tex's avatar indents it, while the line beneath it, "Synced 8/18/2026",
hangs at x≈12 against the container edge. Two different left margins inside one
four-line block.

## The fix

One rule: **on the phone, a section is a card** — `--surface-1` ground,
`1px solid var(--hairline)`, `--radius-card`, `--s4` padding, `--s3` between
cards. That is what Attendance and Data already do, so this standardises on the
majority rather than inventing anything.

```css
/* Inside @media (max-width: 720px) */

/* Home's Standing tile is a peer of the cards below it and must not sit on a
   different elevation from them. Two grounds in one list says the two things
   are different kinds of thing; they are not. */
.tile { background: var(--surface-1); }

/*
 * The panel stops being a slab.
 *
 * A full-bleed surface with a hard top border draws a seam across the page at
 * an arbitrary scroll position and changes the ground for everything after it.
 * With R7 giving each chart block its own card, the panel itself has no
 * remaining reason to be a surface at all.
 */
.drawer,
.drawer.wide { border-top: 0; background: transparent; }
```

For Home's left edge, in `Home.tsx`: either move the synced line into the same
text column as the heading, or take Tex out of the flow so the whole block
shares one margin. Either is correct; two margins is not.

## Cost

More visible borders on screen at once. R6 keeps them quiet, and they replace a
seam that is louder than all of them together.

---

# R9b — Refresh gives no visible feedback

**Tier: Refinement.**

## What's wrong

A control that changes the bell badge from 1 to 2 and says nothing has not
refreshed as far as the student is concerned — it has flickered. Verified by the
mobile QA sweep: body text is byte-identical before and after, there is no
`aria-busy`, no toast, and no element with `role="status"`. The work happens and
the interface declines to mention it.

## The fix

Three parts, all using motion the app already owns — no bounce, nothing new in
`motion.css`:

1. `aria-busy="true"` on `.refresh` while the request is in flight, so assistive
   technology reports what sighted users are about to be shown.
2. A rotation on the glyph for the duration, at `var(--fast)` and `var(--ease)`.
   The existing rule that keeps `.refresh` un-dimmed while disabled is correct
   and stays — a control that fades the moment it is pressed reads as having
   failed.
3. On settle, a `role="status"` live region in the header reading
   `Synced just now` or `Nothing new`, fading after about four seconds.

**Make Home's existing `Synced 8/18/2026` line the target.** It is already on
screen, it is already the right sentence, and making it visibly change turns an
invisible action into a visible one for free.

## Cost

One live region, and the copy must not lie. If the sync fails, it must say so —
`Nothing new` on a failed request is worse than silence, because it is a false
statement the student will act on.

---

# R10 — orphan controls between sections

**Tier: Refinement.**

## What's wrong

Between the last subject card and the analytics panel sit two controls with no
relationship to each other: `+ Subject` hard left, then roughly 90px of empty
page, then `Remove S4` hard right — on the bare page ground, at two different
alignments, in two different idioms (a bordered button and an underlined link).
They read as leftovers rather than as the end of a list. This is the same
"outside boundary" complaint as S3's stranded delete, one level up.

## The fix

```css
/* Inside @media (max-width: 720px) */

/*
 * Adding a subject is the natural end of the list, so it looks like the next
 * row rather than like a button that wandered off the side. Full width and a
 * dashed edge is the standard list-append affordance, and it gives the control
 * its 44px in the process.
 */
.ledger .add-subject {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 100%;
  min-block-size: 44px;
  background: transparent;
  border: 1px dashed var(--hairline-strong);
  border-radius: var(--radius-card);
  color: var(--text-dim);
  margin-block-start: var(--s3);
}
```

`Remove S4` moves into the analytics panel, below the charts. It is destructive
and it currently sits closer to the eye than the subject list it would destroy.

**This is ranking, not hiding.** The control keeps its label, its position in
the document, and its reachability by scroll and by keyboard. Feature parity
holds — nothing is behind a discovery.

## Cost

`Remove S4` becomes one level less immediate. That is correct for a destructive
action, but it is a change a user could notice, so it is worth confirming rather
than assuming.

---

# R11 — the header popovers are pseudo-sheets

**Tier: Refinement.**

## What's wrong

Below 720px `.pop` is stretched to `left`/`right: var(--s3)` — full bleed minus a
gutter — but it keeps a desktop popover's identity: positioned by inline `top`
arithmetic measured off a 44px button, no scrim, no grab handle, no visible
means of dismissal, and it silently covers the entire Ask bar while open. The
capture of the open bell shows the header's own hairline running behind the
panel on both sides, which gives away that this is an overlay pretending to be a
surface.

The `!important` on `left`/`right` is honestly documented in the stylesheet as
fighting an inline style. It is fighting it because **it is the wrong component
at this width**, and no amount of overriding will make an anchored menu into a
sheet.

## The fix

```css
/* Inside @media (max-width: 720px) */

/*
 * A real bottom sheet, not a menu anchored to a 44px button 850px above the
 * thumb. Bottom-anchored is also the only place on a 914px screen a panel can
 * be reached without a second hand, and it removes the inline `top` the
 * component computes - which is the arithmetic the `!important` above exists
 * to fight.
 */
.pop {
  inset: auto 0 0 0 !important;
  inline-size: auto;
  max-block-size: 70dvh;
  border-radius: var(--radius-card) var(--radius-card) 0 0;
  border-inline: 0;
  border-block-end: 0;
  padding-block-end: max(14px, env(safe-area-inset-bottom, 0px));
}

/* The handle says "drag or tap away" without a word, which is what a surface
   with no Escape key needs. */
.pop::before {
  content: "";
  display: block;
  inline-size: 36px;
  block-size: 4px;
  margin: 0 auto var(--s3);
  border-radius: 999px;
  background: var(--hairline-strong);
}
```

`Popover.tsx` can then skip the anchor measurement entirely behind `isNarrow()`,
and the `!important` goes with it.

Separately: in the profile menu, the `Appearance / Light` row is visually
indistinguishable from a static label. It is a control and must look like one.

## Cost

A real change to `Popover.tsx`, and the bell's "See which" deep link needs
re-testing when triggered from a bottom sheet rather than a top-anchored panel.
`.pop` also needs a scrim added; today it has none because a desktop popover
dismisses on outside click without one.

---

# P12 — `--dur-fast` does not exist: three transitions are dead

**Tier: Polish. This is a plain bug, not a preference.**

**Confirmed:** `--dur-fast` has **7 uses and 0 definitions** across
`src/styles/`. `tokens.css` defines `--fast` and `--med`; nothing anywhere
defines `--dur-fast`.

## What's wrong

`app.css` references `var(--dur-fast)` at lines 43–45, 765, and 953–955. An
invalid `<time>` value invalidates the **whole** `transition` declaration, so:

- `.pill` has no transition
- `.ask` has no transition — the app's headline control, so every press on the
  search field is an instant snap
- the palette's blur has no transition

The motion was written, reviewed, and has never once run. It is invisible in
review because the property looks correct, and invisible on screen because the
absence of an animation is not something you notice.

## The fix

Replace all seven occurrences with `var(--fast)`.

Then add a stylelint rule for undefined custom properties. This class of bug is
invisible in both review and testing, which is the worst combination a defect
can have, and this file will not be the last place it happens.

## Cost

None. It restores motion that was already designed and approved.

---

# P13 — Data screen: a sentence torn into three lines

**Tier: Polish.**

## What's wrong

In the "This build" card, the privacy statement anchor renders as a block, so a
single sentence breaks into three ragged pieces: "…and the fourth only if you
sign in to ask a question —" / "the privacy statement" / "names all of them."
The link is not a list item or a button; it is a phrase inside a sentence, and
it is the last thing a privacy-conscious student reads.

Also in "Backup and reset": `Export backup`, `Restore backup` and
`Export semester report` wrap two-then-one, leaving a ragged block. Three equal
rows read as a set; two-and-one reads as an accident.

## The fix

```css
/* Inside @media (max-width: 720px) */

/* A phrase inside a sentence, not a block. As a block it tore one sentence
   into three pieces in the one paragraph whose job is to be believed. */
.build-card a { display: inline; }

/* Full-width and stacked. At 411px these wrap 2-then-1, which reads as a
   layout accident rather than as three things you can do. */
.backup-actions > button { inline-size: 100%; }
.backup-actions { display: flex; flex-direction: column; gap: var(--s2); }
```

Confirm the actual class names against `Data.tsx` before applying — the
selectors above are named for the regions described, not read from the file.

## Cost

None.

---

# P14 — the current view is not persisted

**Tier: Refinement.**

**Confirmed still open:** `src/state/nav.ts` line 48 —
`const [view, setView] = createSignal<View>("home");`

## What's wrong

The current view is a bare in-memory signal defaulting to `"home"`, and it is
absent from the persisted state blob. The stored keys are `version`, `scheme`,
`student`, `activeSemester`, `etlab`, `semesters`, `history`, `goal`,
`onboarded`, `theme`, `lastSync`, `daywiseAttendance`, `timetable`,
`daywiseMonths`, `drawerOpen`, `savedAt`.

Note what that list contains and what it omits: **`drawerOpen` is persisted and
`view` is not**, which is exactly backwards on a phone, where the drawer does not
exist as a togglable panel at all and the view is the one thing a student would
notice losing.

Android reclaims backgrounded WebView processes routinely. A student reading
Attendance who takes a phone call comes back to Home. This was observed during
the audit — the app cold-started mid-session and returned to the default view —
though in that instance the restart was almost certainly caused by another agent
reinstalling, not by the app. The *consequence* is real regardless of what
triggers the restart.

## The fix

Persist `view` alongside `activeSemester`, and validate it on read against
`VIEWS` — the same defensive pattern `theme.ts` already applies to an unknown
stored theme, and for the same reason: state comes off disk and out of restored
backups, so an unknown value is possible and must fall back rather than stamp
nonsense onto the app.

## Cost

One more key in the persisted blob and one validation branch. Consider whether
`drawerOpen` should stop being persisted at the same time — it has no meaning
below the breakpoint.

---

# X1 — CSP blocks Tauri's IPC origin: possible blocker, not a design item

**Tier: not design. Flagging at the highest severity in this document, because
if the inference below is right it outranks everything else here.**

## What I actually observed

Two facts, both verified:

1. `src-tauri/tauri.conf.json` line 31 reads:
   `"connect-src": "'self' https://raw.githubusercontent.com https://targetx-ask.rishipraseeth.workers.dev"`
   — **`http://ipc.localhost` is not in the list.**

2. At **every** app launch, logcat carries:
   ```
   E Tauri/Console: Refused to connect to
   'http://ipc.localhost/plugin%3A__TAURI_CHANNEL__%7Cfetch' because it
   violates the following Content Security Policy directive:
   "connect-src 'self' https://raw.githubusercontent.com https://targetx-ask.rishipraseeth.workers.dev"
   ```
   100% reproduction, observed on a debug build on the emulator.

## What I am inferring, and did not verify

The blocked URL is specifically the **Channel** transport
(`plugin:__TAURI_CHANNEL__|fetch`), not a generic `invoke`. Tauri v2 on Android
uses more than one IPC path, so there are two possibilities and I did not
distinguish them:

- **Narrower:** only `Channel`-based APIs fail — streamed or progress-reporting
  calls — while plain `invoke` continues to work over the custom protocol. This
  would break a subset: anything using streamed responses.
- **Wider:** the same origin backs `invoke` generally, in which case **sync,
  export, import and updates all die**, and the app is broken in every way that
  is not local arithmetic.

Evidence that at least *something* works: during the audit the app persisted
state, applied the theme, and the bell badge moved from 1 to 2 after a refresh.
Whether any of those paths goes through `invoke` I did not check. **I am not
claiming the app is broken; I am claiming it emits a CSP violation on every
launch that nobody has explained.**

## The discriminator, for whoever is testing on device

Call one plain `invoke` and one `Channel`-based API from the WebView console and
watch which throws. If plain `invoke` succeeds, this is the narrow case and
belongs in the normal queue. If it fails, stop everything else and fix this
first.

## The fix

Add `http://ipc.localhost` to `connect-src` in `tauri.conf.json`. If Tauri is
expected to inject its own IPC origin on Android and is not doing so, that is
worth reporting upstream rather than only patching locally — a hand-written
`connect-src` that silently omits a framework origin will break again the next
time the CSP is edited.

## Cost

Broadening the CSP by one origin that the framework itself owns. Negligible
against the failure mode.

---

# Sequencing

**S3 → S4 → R6 → R7 → R11 → S5**, with **P12 folded into whichever commit
touches `app.css` first** — it is a find-and-replace that silently restores
motion which was written and never ran, so there is no reason for it to wait.

**X1 is out of band.** Resolve the narrow-versus-wide question before any of the
above; if it is the wide case, it precedes everything.

R8, R9b, R10, P13 and P14 are independent and can land in any order between the
structural items.

Do S3 before S4: S4's reclaimed pixels are only worth having once the cards they
reveal are worth showing.

---

# The single highest-leverage change

If only one item from this document could be implemented: **S3**, the subject
card.

The 44px floor already shipped and was the change that stopped the app being a
desktop app on a phone. S3 is the change that makes the Semester screen — the
screen this app exists for — a designed object rather than a repaired one. It is
also the item that answers the user's own complaint in the user's own words: the
spanned-but-empty third column and the delete stranded across 250px of nothing
*are* "elements going outside boundary", and no amount of overflow testing will
ever catch them, because nothing overflows. Only looking at it does.

# Designed, or assembled?

**Assembled — by someone who can design, which is a far better problem to have.**

The evidence for the second half is everywhere. The token file reasons about hue
separation so a teal heading can never read as a warning. Contrast values are
measured and guarded by a test that fails on drift. The mobile stylesheet is
better-argued than most production CSS: it does not merely fix the sideways
scroll, it identifies `min-width: 0` as the load-bearing half and `overflow-x` as
the decoration, and it warns that a selector matching nothing "costs nothing and
looks like a fix, which is the worst thing a stylesheet can contain."

What is missing is the pass where you stop fixing and start looking. Every
phone-layer decision in this repo is locally correct and was made in isolation:
the header wraps because it overflowed; the tabs left because they did not fit;
the drawer became a row because a fixed column cannot be scrolled away. Each
commit solves the defect in front of it, and none of them asks what the whole
screen looks like afterwards. That is why the header is 70% empty — nobody broke
it, it was correctly emptied one control at a time. It is why a section heading
welds itself to the wrong paragraph: `margin-bottom` was right for the block it
was written on.

The tell was the delete glyph alone at the end of its row. Nothing was broken
there. Nothing overflowed, nothing collided, no test failed. It just looked like
nobody had stood back.

The good news is that the reference already lives in the repo. **The Attendance
screen is what this app looks like when it is designed.** The Semester screen is
what it looks like when it is repaired. Make the second look like the first and
all three of the user's complaints — cluttered, scrollbars, don't drop anything —
fall out of the same work.

**Nothing in this document removes a feature.** Every item reorganises, resizes,
or re-ranks.
