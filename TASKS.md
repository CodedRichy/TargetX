# TargetX — open work

Compiled 2026-08-18 from four persona audits, re-verified line by line against
the code on 2026-08-29, and then worked down the same day. Of the roughly forty
defects the audit found, **none remain open in code**. Two are open and cannot
be closed here: they need a document or a person this repository does not
contain, and guessing at either would recreate the exact class of defect the
rest of the list was about.

The re-verification is the part worth keeping. The August list had gone stale in
the worst direction — it listed fixed defects as open, which makes it useless as
a release gate: a list you have learned to disbelieve stops being read.

Ordered by what would hurt a real student most.

---

## Blocked on information, not on work

Both of these need a document or a person, and guessing at either would
recreate exactly the class of defect the rest of this list was about: a number
presented as the university's that nobody checked.

- [ ] **The S1 CSE preset is 15 credits and the catalogue's own note says 20.**
      `GXEST104`, `GXCYT122`, `UCHUT128`, `UCPWT127` and `UCHUT347` are priced
      in the credits map and appear in no branch table. Which of them belong to
      S1 is not decidable from the file: KTU's first year runs a Physics stream
      and a Chemistry stream, which is also why `GAPHT121` sits in both S1 and
      S2 and why S2 sums to 22 against a note claiming 23. **Needs the KTU 2024
      curriculum PDF.** Until then a first year seeding from the preset gets a
      wrong SGPA denominator on day one. The intended fix is to carry an
      expected per-semester total and have the app say "this preset covers 15 of
      the 20 credits KTU registers for S1" rather than seed a wrong one in
      silence.

- [ ] **Portal sync has been validated against one college.** Everything
      portal-side is n=1 and the TypeScript port has never touched a live
      portal. This is the largest commercial risk in the project and no amount
      of local testing reduces it. A zero-course sync is now a failure rather
      than a green tick, so a college this does not work for is at least told
      so — but that is a safety net, not validation.

## Layout, measured rather than argued about

- [x] **Residual scroll on Home.** Done 2026-08-29, and the cause was not
      the layout. Every chart was `viewBox="0 0 300 130" width="100%"`, which
      scales the whole drawing by container/300 — so in Home's 784px-wide
      Trend tile the chart was 340px TALL with its 8px axis labels rendered at
      21px, and in the 324px drawer the same labels came out at 7.4px. The
      drawing was only correct at exactly 300px. The charts now measure their
      container and draw at 1:1, the bento states its column counts instead of
      leaving `auto-fit` to decide what a two-column span means, and a
      `max-height` band trims the chrome on short windows. Home went from
      overflowing by 143px at 1440x900 to **fitting**, and from 519px to 74px
      at 1280x800. `tools/measure.mjs` is the measurement, re-runnable.

- [ ] **Data still scrolls by 188px at 1440x900** and 238px at 1280x800, and
      the subject drawer by 277px. Both are lists rather than at-a-glance
      screens, so this is not the same defect — recorded so the numbers do not
      have to be rediscovered.

---

## Before a release

- [ ] Buy a Windows code-signing certificate. The plumbing is done and
      secret-gated; see [`SIGNING.md`](SIGNING.md). Until then Windows tells
      every student the publisher is unknown.
- [ ] Put the updater signing key into GitHub Actions secrets. A build
      without it exits 0 and produces installers with no update payload, so
      the release reads as clean and no installed copy is ever offered it.
      The workflow now refuses to run without the secret rather than trusting
      anyone to notice.
- [ ] Tag v0.1.0 and publish the release — and remember a *draft* release is
      not "latest", so nobody is offered it until it is published.
- [ ] **Rotate the etlab password** that was pasted into a chat transcript.

## After a release

- [ ] Test the grade-card parser against a real KTU PDF. Its six defects were
      all found by reading it; none were found by running it.
- [ ] Branch tables beyond CSE. Every non-CSE student currently has no preset.
- [ ] "Since you were last here" — snapshot on close, diff on open. The reason
      a student reopens the app.
- [ ] Opt-in "stay signed in" via Windows Credential Manager, enabling a real
      sync-on-open.
- [ ] Ctrl+K command palette — natural-language queries answered
      deterministically.
- [ ] Optional Gemini Flash Lite summary behind a Cloudflare Worker: key never
      shipped, per-install daily cap, one button rather than a chat, model
      phrases numbers it is given and never computes them. Check the free
      tier's data-retention terms first — this would be students' academic
      records.
- [ ] Tutor/HOD class view. The paid product, per the monetisation decision.

## Testing debt

The parity corpus is pinned to the buggy Python oracle in `legacy/`, and every
fix above makes the port disagree with it on purpose. The resolution taken: the
corpus stays frozen for the rules that did not change, and each corrected rule
is covered by a direct test that states the rule rather than the answer the
oracle gave. `engine/__tests__/core.test.ts` is where those live.

- [ ] The grade-card tests are written from row shapes, not from a real card's
      text. They caught the six defects that were there, which is the point —
      but a real card is still the thing that has never been run through it.
