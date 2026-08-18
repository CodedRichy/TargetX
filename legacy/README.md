# legacy/ — the Python build

This is the original TargetX: a customtkinter desktop app plus its etlab scraper
and KTU importers. It is no longer the product. Everything it did now lives in
`app/` as Tauri + SolidJS + TypeScript.

It is kept rather than deleted for two reasons, both load-bearing:

**1. `targetx.py` is the correctness oracle.** `tools/parity_dump.py` imports it,
generates 612 course cases and 60 semester rollups from a seeded corpus, and
`app/src/engine/__tests__/parity.test.ts` asserts the TypeScript engine produces
byte-identical output. Deleting the Python engine would not just remove old code,
it would remove the proof that the new one is right. The parity suite fails
immediately if this directory goes.

**2. `curriculum_import.py` still regenerates `curriculum.json`.** It reads KTU's
published scheme PDFs and emits the bundled catalogue the app ships with. There
is no TypeScript replacement because it is a build-time tool, not a runtime one.

Nothing else here is used. `etlab_sync.py`, `ktu_import.py`, `targetx_check.py`
and the two test files are reference material — when the TypeScript ports of the
scraper and grade-card parser hit a portal shape they mishandle, this is the code
that got it right first.

## Running it

```
python legacy/targetx.py          # the old GUI
python -m pytest legacy/          # the old test suite
python tools/parity_dump.py       # regenerate the parity fixture
```

`legacy/targetx.py` needs `customtkinter`; the parity dump does not (it stubs the
import, so the fixture regenerates on a machine with no display server).
