# Privacy

TargetX is a desktop application that runs on the machine it is installed on.
Every figure it shows is computed there. There is no telemetry, and no account
is needed to use any of it.

One optional feature is different, and is set out in full below: the question
box can forward a question it could not answer locally to a server of ours, and
that is the one part that asks you to sign in. It never receives a mark, an
attendance figure or a CGPA. If you never sign in, nothing in this paragraph
applies to you and the rest of the app is unaffected.

This document describes what the software actually does, and every claim in it
can be checked against the source in this repository. Where a claim is about
code, the file is named so it can be read rather than trusted.

## What is stored, and where

| What | Where | Leaves the machine? |
|---|---|---|
| Your marks, attendance, credits, targets and semester history | `state.json` and up to three backups in your user application-data folder | No |
| A duplicate of the same record | Browser storage inside the application | No |
| Your college portal password | Nowhere. It is held in memory for the length of one sign-in and discarded | No |
| Your college portal session cookie | The application's memory only, discarded when you quit | Sent only to your own college's portal |
| A fault log | `targetx.log` in your user log folder, up to three files of 2 MB | No, unless you choose to send it |

On Windows the record is at
`%APPDATA%\cv.codedrichy.targetx\state.json` — the roaming profile, chosen so
that a student on a shared lab machine keeps their record when they move to a
different one.

## What is sent over the network

TargetX makes network requests in exactly four situations, and no others. The
fourth happens only if you choose to sign in.

1. **When you press Sync.** It signs in to the college portal URL that you
   typed, and reads your attendance and internal marks. This is a request to
   your own college, made with your own credentials, at your instruction. See
   `app/src/sync/etlab.ts` and `app/src-tauri/src/etlab.rs`.
2. **When you refresh the course catalogue.** It fetches `curriculum.json` from
   this project's own GitHub repository. This is a plain file download and
   carries no information about you. See `app/src/engine/catalogue.ts`.
3. **A few seconds after launch, to ask whether a newer version exists.** This
   is a request to GitHub's release feed. It carries no information about you
   beyond what any file download carries. See `app/src/sync/update.ts`.
4. **When you are signed in and ask a question the app could not answer by
   itself.** This is the only request that reaches a server of ours, and the
   only one that requires an account. Most questions never get here: attendance,
   marks, standing and the regulations are all answered on your own machine,
   offline, and only a phrasing the app does not recognise is forwarded.

   **What is sent:** your question, and the code and title of the subjects you
   are registered for — the course list, so the question can be matched to a
   subject.

   **What is not sent:** marks, attendance, CGPA, your name, your register
   number, your password. None of it. See `app/src/state/ask.ts`, which is the
   only file that decides what goes into that request.

   **What comes back is not an answer.** It is a destination: one of five
   screens, or one of the subjects you sent. The reply is parsed into a fixed
   type before the app acts on it, and anything outside that type — including a
   subject code you did not send — is rejected. There is no field in it that
   could carry a figure about you, so the model cannot state one even if asked
   to. See `worker/src/schema.ts`.

   **What is logged:** the question text, the outcome, how many subjects were
   sent, and how long it took — so the app can learn which phrasings it failed
   to answer locally. Not logged: any account id, any token, or the course codes
   themselves. Identity and content are deliberately kept apart, so the log is a
   record of what people ask rather than a record of what a named student asks.
   See `worker/src/log.ts`.

Your marks are never sent anywhere, by anyone, for any reason. There is no
endpoint that would receive them.

## Your password

Your college portal password is used once, to sign in, and is never written to
disk, never logged, and never included in an export. The sign-in happens in the
Rust process rather than the web layer, and the cookie jar it produces lives in
that process's memory and is gone when the application exits
(`app/src-tauri/src/etlab.rs`).

If you leave the password field blank, TargetX re-uses the session from earlier
in the same run. There is nothing to re-use after a restart, by design.

## The fault log

When something inside TargetX fails, it writes the failure to a file so that it
still exists afterwards. Without it a crash leaves nothing behind at all, and a
report of "it stopped working" cannot be acted on.

The file holds error messages and the point in the program they came from. It
does not hold your marks, your attendance, your password, or the contents of any
portal page. It can contain the portal address you typed, because a message
about a bad address has to quote it. Nothing reads the file and nothing uploads
it. If you want to report a fault you can open it, read it, and decide for
yourself whether to send it — and send it yourself, by hand.

On Windows it is at
`%LOCALAPPDATA%\cv.codedrichy.targetx\logs\targetx.log`. The Data screen shows
the exact folder for your machine. Deleting it is safe.

## Analytics

There are none. No usage data, no crash telemetry, no identifiers, no counters.
The fault log above is written to your own disk and read by nobody; it is not
telemetry, because nothing sends it.

Nobody can tell how many people use TargetX, which is a deliberate trade: it
costs the project useful information and it is the only arrangement in which
the paragraph above is true without qualification.

## Taking your data with you, and deleting it

**Export** on the Data screen writes a `.json` file containing your whole
record. It is yours; nothing is withheld from it.

To delete everything TargetX holds, delete the application-data folder named
above. Uninstalling removes the program; deleting that folder removes the data.

## Children and student records

TargetX is used by students and holds academic performance data, which in most
jurisdictions is a protected education record. It is designed so that the
question of who else can see it does not arise: the data does not leave the
device, so there is no processor, no sub-processor, and no cross-border
transfer to disclose.

An institution deploying TargetX is not sharing student data with this project
or with anyone else by doing so.

## Contact

Raise an issue at https://github.com/CodedRichy/TargetX for anything in this
document that is unclear or that you believe the code contradicts.
