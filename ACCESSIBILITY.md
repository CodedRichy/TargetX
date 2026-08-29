# Accessibility

TargetX is a desktop application built with web technology, rendered in the
system WebView. This document says what has been checked, how, and what is
still known to be short — including the things a conformance statement is
usually written to avoid mentioning.

It is written to be checkable. Where a claim rests on a measurement, the
measurement is named; where it rests on a test, the test file is named.

**Target: WCAG 2.1 Level AA.** No formal third-party audit has been carried
out. This is a self-assessment, and it is dated: **29 August 2026**.

## What has been verified

### Colour contrast — measured, and enforced by a test

Every foreground/background pair the interface actually uses was computed from
the design tokens: OKLCH to linear sRGB to WCAG relative luminance, with
translucent washes composited in linear light. Text pairs meet 4.5:1 and the
focus indicator meets 3:1, in both the light and the dark theme.

That check now lives in `app/src/styles/__tests__/contrast.test.ts`, which
parses the real stylesheet. It is not a report of a one-time review: a token
change that breaks a ratio fails the build. It also asserts that every colour
is inside sRGB, because an out-of-gamut value is silently clipped by the
browser — three tokens were shipping clipped, so the colour on screen was not
the colour anyone had measured.

The check deliberately does **not** assert contrast for row rules, card edges
or surface fills. SC 1.4.11 covers visual information required to identify a
control; those are decorative, and the controls that sit on them carry their
own text. Asserting them would be conformance theatre.

### Keyboard operation — driven, not reasoned about

Every focus stop on all four screens was tabbed through in a real browser, with
the tag, accessible name, ARIA state, computed outline and opacity printed at
each stop. All of them show a 2px focus ring. There is no keyboard trap, no
zero-size stop and no invisible stop.

That pass found two real defects that reading the code had not:

- **A keyboard trap in the History table.** Focus entered the first SGPA field
  and could not leave it: the credits column and every row below the first were
  unreachable. Two causes, both fixed — an unconditional commit on blur, and a
  keyed list that rebuilt every row on any write.
- **Focus rings that did not exist on any text field.** Every input set
  `outline: none` on `:focus`, and a class selector outranks the bare
  `:focus-visible` rule whatever the sheet order, so the only indicator was a
  1px border at 2.27:1 in dark and 1.36:1 in light. Restored for keyboard focus
  only, so a mouse click still gets the quiet treatment the dense table was
  designed around.

### Names, roles and structure

- The subject table uses `scope` on all fourteen headers, including the
  otherwise unlabelled remove column.
- Every input and select has an accessible name. The table cell component
  **requires** a label as a typed property, so the compiler catches the next
  unnamed box rather than a reviewer.
- The row expander is a real `<button>` with `aria-expanded` and
  `aria-controls`, not a `<span>` with a keydown handler.
- The `≥` and `*` markers carry their meaning through `role="img"` and a
  label, not through a tooltip.
- Status is never carried by colour alone: the pill text says SAFE, TIGHT,
  SHORTAGE, DEBARRED, and attendance below a regulation line is stated in words
  for screen readers as well as coloured.
- Banners that appear on their own — launch findings, a failed save, an update
  offer — are `role="status"`. Polite rather than assertive, deliberately: the
  save notice can be raised while the student is typing, and an assertive
  region would interrupt the keystroke.
- Destructive confirmation moves focus onto the confirmation itself, never onto
  its confirm button, so a second Enter pressed on the way past cannot erase
  the record.

### Motion

All transitions collapse to zero under `prefers-reduced-motion`, and the
keyframe animations are switched off explicitly. Two indeterminate progress
indicators keep moving on purpose: they are the only evidence that work has not
stalled, and freezing them would turn a download into what looks like a hang.

## Known shortfalls

- **A screen reader has not been run against the packaged build.** The names,
  roles and states are asserted by tests that render the real components, and
  the keyboard pass was driven through a real browser — but neither is the same
  as NVDA or Narrator on the shipped app.
- **The window's own title-bar buttons are untested in place.** TargetX draws
  its own close, minimise and maximise controls, and they only render inside
  the desktop shell, so the automated pass could not reach them. They carry
  labels and a focus ring, verified by reading and by contrast measurement, but
  not by operation.
- **A subject row in the setup wizard responds to a click on the whole row**,
  and only the checkbox inside it responds to the keyboard. The list is
  operable either way; the larger target is not.
- **The live regions are inserted with their content** rather than existing
  empty and being filled. The empty-first pattern is more reliable in
  principle; here it would add visible height to a named grid area on every
  screen. It announces correctly in the shipping target (WebView2 with NVDA)
  and is recorded here as a compromise rather than an oversight.
- **The view tabs use `aria-current` on plain buttons** rather than a tablist.
  This is valid, and a real tablist would mandate arrow-key roving focus —
  a behaviour change, not an accessibility fix. Named so the choice is visible.
- **Text scaling above 200% has not been tested.**

## Reporting a problem

Open an issue at https://github.com/CodedRichy/TargetX/issues. Say what you
were using — screen reader and version, keyboard only, magnification — and
what happened. An accessibility defect is a correctness defect here and is
treated as one.
