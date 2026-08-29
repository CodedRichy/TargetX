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

One of these turned out to be gettable and is closed; the other still needs a
person. Guessing at either would recreate exactly the class of defect the rest
of this list was about: a number presented as the university's that nobody
checked.

- [x] **The S1 CSE preset is 15 credits against a curriculum that registers
      20.** Closed 2026-08-29 from the KTU B.Tech Curriculum 2024, Group A
      tables (pages 3 and 6 of the copy at nssce.ac.in, cross-checked against
      the Group A first-year syllabus book at sctce.ac.in). The preset was
      missing `GXEST104` outright and both of KTU's first-year **slots** —
      Slot B is Physics *or* Chemistry (4 cr) and Slot I is Health and Wellness
      *or* Life Skills (1 cr), taken one way round in S1 and the other in S2,
      in an order the institution sets rather than KTU. Those are now rows
      carrying a slot id, the picker treats them as a choice (ticking one
      unticks its sibling), and the app holds KTU's own S1=20 / S2=24 totals so
      a preset that does not cover them says so instead of seeding a wrong SGPA
      denominator in silence. S2 also gains `UCSEM129`, whose MOOC credit is
      recorded there. Note for anyone re-checking: thejusengg.com hosts a
      **superseded draft** of the same document with different codes and
      credits — the sums do not match it and should not.

- [ ] **Portal sync has been validated against one college.** Everything
      portal-side is n=1 and the TypeScript port has never touched a live
      portal. This is the largest commercial risk in the project and no amount
      of local testing reduces it. Two things now blunt it rather than fix it:
      a zero-course sync is a failure rather than a green tick, and the failure
      carries a redacted description of the page — table shapes and headings
      with every digit blanked, no subject row at all — that the student can
      read and forward. That turns "sync doesn't work" into something a
      selector can be written from without anyone asking for a portal password.
      It is still not validation.

      What has changed is the price of getting it. `npm run portal-check --
      <saved-page.html>` runs the real parser over a page saved out of a
      browser, so testing a college no longer needs an account at it: the ask
      is now "save one page and paste three lines", which a stranger can do in
      a minute and which moves no credential at all. Whoever finds the second
      college should send them that, not a copy of the app.

      Researched 2026-08-29 across six public etlab scrapers at four other
      colleges. Three things came out of it. Our login handling is a superset
      of all four of theirs — they all post `LoginForm[username]` with no CSRF
      token, and RIT detects a bounced login from `<title>` exactly as we do,
      which is the first corroboration of that tell at a second college. Two
      bugs they share, we were checked for and do not have: a hardcoded
      semester path segment (it is an opaque global `sem_id`, not 1–8) and a
      hardcoded session cookie name (it is per-college). And no public repo
      anywhere contains a saved HTML fixture of a real etlab page, so there is
      still nothing to test against but a real one.

- [ ] **Decide whether TargetX may use etlab's mobile JSON API.** It exists,
      it would replace almost all of our parsing, and it hands over duty leave
      as a field rather than an inference. It also refuses a client that is not
      the vendor's Android app — a plain request to its college registry
      returns HTTP 403 — so using it means presenting as that app, which is the
      same call this project already refused once over a bot filter. Not built,
      deliberately. Written up with the evidence and a recommendation in the
      vault: `_brain/decisions/2026-08-29-targetx-etlab-mobile-api-declined.md`.
      **This one is a posture decision, not an engineering one, and it is
      yours.**

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
      every student the publisher is unknown. Every release now publishes
      `SHA256SUMS-<platform>.txt` so a college IT department has something to
      verify against in the meantime — that proves the file did not change in
      transit, not who built it, and is not a substitute.
- [ ] Put the updater signing key into GitHub Actions secrets. A build
      without it exits 0 and produces installers with no update payload, so
      the release reads as clean and no installed copy is ever offered it.
      The workflow now refuses to run without the secret rather than trusting
      anyone to notice.
- [ ] Tag v0.1.0 and publish the release — and remember a *draft* release is
      not "latest", so nobody is offered it until it is published.
- [ ] **Rotate the etlab password** that was pasted into a chat transcript.
      Only you can do this. Verified 2026-08-29 that the credential appears
      nowhere in this repo, its full history, or the built installers, and
      `sync/__tests__/credential-containment.test.ts` now proves a password put
      through a whole sync reaches the login POST and nothing else — not a
      later request, the saved record, the export, or an error message. None of
      that undoes the exposure.

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
