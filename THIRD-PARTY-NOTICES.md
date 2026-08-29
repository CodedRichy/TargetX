# Third-party notices

TargetX is distributed under the Business Source License 1.1 (see `LICENSE`).
It bundles the components below, each under its own terms. This file exists
because two of those terms — Apache-2.0 and the SIL Open Font License —
require their notices to travel with the binary.

Every licence named here was read from the shipped package's own manifest,
not from memory.

## Fonts (SIL Open Font License 1.1)

The OFL requires that the copyright notice and licence text ship with the Font
Software. Both faces are pulled in through `@fontsource` and bundled into the
application by Vite.

- **Space Grotesk** — Copyright 2020 The Space Grotesk Project Authors
  (https://github.com/floriankarsten/space-grotesk)
- **JetBrains Mono** — Copyright 2020 The JetBrains Mono Project Authors
  (https://github.com/JetBrains/JetBrainsMono)

Full licence text ships in `app/node_modules/@fontsource/*/LICENSE` and is
published at https://openfontlicense.org/. The OFL permits bundling,
embedding and redistribution with software, including software that is sold.
It forbids selling the fonts on their own.

## JavaScript

| Component | Licence |
|---|---|
| `pdfjs-dist` (Mozilla PDF.js) | Apache-2.0 |
| `solid-js` | MIT |
| `@tauri-apps/api` | Apache-2.0 OR MIT |
| `@fontsource/space-grotesk` | OFL-1.1 |
| `@fontsource/jetbrains-mono` | OFL-1.1 |

Apache-2.0 requires that a copy of the licence and any NOTICE file accompany
redistribution: https://www.apache.org/licenses/LICENSE-2.0

## Rust

`tauri`, `tauri-plugin-log`, `reqwest`, `serde`, `serde_json`, `tokio` and
`log` are each distributed under `Apache-2.0 OR MIT`.

Run `cargo tree` in `app/src-tauri` for the resolved transitive set; the list
above names only the direct dependencies declared in `Cargo.toml`.
