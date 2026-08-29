# Signing and release

TargetX carries **two unrelated signatures**, and conflating them is the
easiest way to ship something that looks fine and is not.

| | What it proves | Without it |
|---|---|---|
| **Update signature** (minisign) | That an update came from you, so an installed TargetX will accept it | The updater silently refuses every update. No error, no warning — students just stay on an old build |
| **Code signature** (Authenticode / Apple) | That the *operating system* should trust the installer | Windows SmartScreen says the publisher is unknown and advises against running it. macOS Gatekeeper refuses outright |

You need both. Neither substitutes for the other.

---

## 1. Update signing — already set up

The keypair exists at:

```
~/.tauri/targetx-updater.key           private — never commit this
~/.tauri/targetx-updater.key.pub       public half, already in tauri.conf.json
~/.tauri/targetx-updater.password
```

Add both of these as repository secrets under **Settings → Secrets and
variables → Actions**:

| Secret | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the full contents of `targetx-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the contents of `targetx-updater.password` |

> **If you lose that private key you cannot update anyone who has already
> installed TargetX.** Their build trusts only the matching public key, which
> is compiled into it. There is no recovery and no override — you would have to
> get every existing user to manually download a new build. Back the file up
> somewhere you will still have in three years.

## 2. Windows code signing — not yet set up

Get an **OV code-signing certificate** (DigiCert, Sectigo, SSL.com and others
sell them; expect roughly $200–400 per year — confirm current pricing). EV
certificates additionally require a hardware token, which does not fit an
unattended CI build without extra work.

**Azure Trusted Signing** is usually cheaper and is designed for CI. If you use
it, set `bundle.windows.signCommand` in `tauri.conf.json` and provide
`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET` and `AZURE_TENANT_ID` as secrets
instead of the two below.

For a conventional certificate, export it as a `.pfx`, then:

```powershell
# Base64 the pfx; paste the result into the WINDOWS_CERTIFICATE secret.
certutil -encode certificate.pfx cert-b64.txt
```

| Secret | Value |
|---|---|
| `WINDOWS_CERTIFICATE` | the base64 text from above |
| `WINDOWS_CERTIFICATE_PASSWORD` | the .pfx export password |

Then add the thumbprint to `app/src-tauri/tauri.conf.json` under
`bundle.windows`:

```json
"certificateThumbprint": "<thumbprint from the certificate's Details tab>",
"digestAlgorithm": "sha256",
"timestampUrl": "http://timestamp.digicert.com"
```

The release workflow already contains the certificate-import step. It is
skipped when `WINDOWS_CERTIFICATE` is empty, so releases keep building
unsigned until you add it — nothing breaks in the meantime.

**Timestamping is not optional.** Without `timestampUrl` every signature stops
verifying the day the certificate expires, including on builds people installed
years earlier.

## 3. macOS signing and notarisation — not yet set up

Requires an Apple Developer account ($99/year — confirm current pricing) and a
"Developer ID Application" certificate. Secrets, all already wired into the
release workflow:

`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD` (an app-specific password, not your Apple ID
password), `APPLE_TEAM_ID`.

---

## Cutting a release

1. Bump `version` in **`app/src-tauri/tauri.conf.json`**. That is the version
   the updater compares against — not the one in `package.json`.
2. Add the release to `CHANGELOG.md`. Students read it to decide whether an
   update matters.
3. Commit, then tag and push:

   ```
   git tag v0.2.0 && git push origin v0.2.0
   ```

4. **Publish the draft release.** The workflow deliberately leaves it as a
   draft so a bad build cannot reach students automatically — but GitHub does
   not treat a draft as "latest", so `releases/latest/download/latest.json`
   keeps serving the *previous* release until you press publish. Nothing fails
   and nothing warns. If a release appears to have shipped and nobody is being
   offered it, check this first.

## Verifying a release actually works

Signing failures are quiet by design, so check rather than assume:

- Download the installer on a machine that has never built this project. If
  Windows names the publisher, Authenticode worked.
- Install an **older** version, then launch it. It should offer the new one
  within a few seconds. If it does not, the update signature or `latest.json`
  is wrong — not the app.
