# Deploying TargetX in a college

Written for whoever in IT has to answer "what is this thing and what does it
touch?" before a few hundred students install it. Every claim below is
checkable against the code, and where it is, the file is named.

TargetX is a desktop app. There is no server, no account, and no database
belonging to us — a student's record lives in a file on their own machine and
goes nowhere unless they export it themselves.

## What it installs

| | |
|---|---|
| Windows | `TargetX_<version>_x64-setup.exe` (NSIS) and `TargetX_<version>_x64_en-US.msi` |
| macOS | `.dmg` |
| Linux | `.deb` and `.AppImage` |
| Application id | `cv.codedrichy.targetx` |
| Publisher | Rishi Praseeth Krishnan |
| Windows install scope | **Per user**, not per machine (`bundle.windows.nsis.installMode: currentUser`) |

Per-user is deliberate: the record is one student's academic data and belongs in
their profile, not in a shared location on a lab machine. It also means no
administrator rights are needed to install.

**Silent install**, for deployment through Intune, SCCM or a login script:

```powershell
# NSIS
.\TargetX_0.1.0_x64-setup.exe /S

# MSI, per-user
msiexec /i TargetX_0.1.0_x64_en-US.msi /qn
```

Verify the download first — see **Signing** below.

## What it talks to

Three hosts, and only three. There is **no telemetry, no analytics and no
crash reporting**; the only `fetch` in the entire frontend is the second row of
this table (`app/src/state/actions.ts`).

| Host | When | Why |
|---|---|---|
| `github.com` | A few seconds after launch | Update check — reads `releases/latest/download/latest.json` |
| `raw.githubusercontent.com` | On launch | Course catalogue refresh, so a KTU curriculum revision does not need a new build |
| **Your own portal** | Only when the student presses Sync, and only to the address they typed | Reads attendance and marks |

Nothing else. If your network blocks GitHub, the app still works: the update
check and the catalogue refresh both fail quietly and the bundled catalogue is
used. Portal sync is optional — everything can be typed or pasted in.

### About the portal

The student's portal password is held in a local variable for the duration of
one request. It is never written to disk, never put into application state,
never logged, and never sent anywhere except the login form on the address the
student entered. That is enforced by
`app/src/sync/__tests__/credential-containment.test.ts`, which puts a sentinel
password through a whole sync and searches for it by value in every outbound
call, the saved record, the export, and the text of a failed sync's error.

The session cookie lives in the Rust process, not in the web layer, so nothing
in the page can read it. TargetX only ever reads from the portal; it has no
code path that writes to one.

Sync has been validated against one college's etlab deployment. If yours lays
its pages out differently the sync fails and shows a description of what it
could not read — table shapes and headings with every digit blanked out, no
subject row at all — which you or the student can send with a bug report. It
will not silently record a half-read semester.

## Where the data lives

| | |
|---|---|
| Record | `state.json` under the OS application-data directory (`%APPDATA%\cv.codedrichy.targetx` on Windows — Roaming, so it follows a roaming profile) |
| Backups | Three rotating copies, taken once per launch |
| Logs | The app's log directory, `targetx.log`, 2 MB per file, 3 kept |
| Second copy | `localStorage` in the WebView profile |

Uninstalling leaves the data directory in place. Delete it to remove the
record. The Data screen inside the app has an export button that writes the
whole record as JSON, and an erase button that clears it.

Nothing in the record is transmitted anywhere. The log holds diagnostics, not
academic data and not credentials.

## Updates

The app checks for a new version on launch and offers it; the student accepts
or declines. Update payloads are signed, and a build only accepts an update
signed by the key compiled into it — an unsigned or wrongly signed update is
refused rather than installed. On Windows the update installs in `passive`
mode: a progress window, no prompts.

If you would rather control versions centrally, block
`github.com/CodedRichy/TargetX/releases` at the network and deploy new versions
the way you deploy anything else. The check fails quietly; nothing else in the
app depends on it.

## Signing

Read [`SIGNING.md`](SIGNING.md) for the detail. The short version:

- **Update payloads are signed** (minisign), and an installed copy verifies
  them against a key compiled into it.
- **The installers are not yet code-signed.** Windows SmartScreen will say the
  publisher is unknown. A certificate is on the list; until it is bought, every
  release publishes `SHA256SUMS-<platform>.txt` beside the installers so you
  can verify the download you received:

  ```powershell
  Get-FileHash .\TargetX_0.1.0_x64-setup.exe -Algorithm SHA256
  ```

  A checksum proves the file did not change in transit. It does not prove who
  built it. That is what the certificate is for, and this is not a substitute
  for it.

## Licence

BUSL-1.1. **Students use it free, forever, individually** — that grant is
written into the licence, not offered as a policy that could be withdrawn.
Institutional deployment is a commercial use. See [`LICENSE`](LICENSE) for the
exact wording, which is what governs.

## Accessibility and privacy

[`ACCESSIBILITY.md`](ACCESSIBILITY.md) states what has been measured, how, and
what is still short — including that a screen reader has not been run against
the packaged build. [`PRIVACY.md`](PRIVACY.md) states what is stored and what
leaves the machine. Both are written to be checked rather than believed.

## Reporting a problem

https://github.com/CodedRichy/TargetX/issues. A sync that cannot read your
portal is the most useful report you can file: include the diagnostic the app
shows, which carries no marks, no names and no numbers.
