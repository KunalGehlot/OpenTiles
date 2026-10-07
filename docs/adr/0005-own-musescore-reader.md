# 0005 — Read MuseScore files with our own code, not webmscore

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P2-10

## Context

Users should be able to import the `.mscz` files MuseScore saves by default (spec §8), not only
MusicXML exports. The specification suggested webmscore, MuseScore's engraving library compiled to
WebAssembly, with the condition "confirm the licence fits AGPL-3.0 first".

It does not. webmscore is built from MuseScore 3.x source code, which is licensed **GPL-2.0-only**
(MuseScore 4 moved to GPL-3.0, but webmscore tracks the 3.x code base). GPL-2.0-only is not
compatible with GPL-3.0 or AGPL-3.0: code under "version 2 only" cannot be relicensed to version 3,
and the AGPL's terms cannot be applied to it. Shipping webmscore inside OpenTiles, even as a
lazy-loaded chunk of the same web app, would combine the two in one program and violate one licence
or the other. Loading it from a third-party CDN at runtime would also break hard rule 5 (no
third-party requests).

webmscore is also large (several megabytes of WebAssembly plus fonts), which matters on iPads.

## Decision

Write our own reader for the MuseScore file format in `packages/importers`
(`src/musescore.ts`), loaded with a dynamic `import()` only when a MuseScore file is imported.

- `.mscz` is a zip; the reader finds the main `.mscx` through `META-INF/container.xml` (or the first
  `.mscx` outside `Excerpts/`) and unzips it with `fflate` (MIT), which the app already uses.
- `.mscx` is XML. The reader understands the MuseScore 3.x and 4.x layouts and the common parts of
  2.x: parts and staves, measures (with `len` for pickups), voices, chords and rests,
  `durationType` and dots, tuplets (inline and by reference), time and key signatures, tempo,
  fingering, ties, repeats, voltas and section breaks.
- It produces raw measures and hands them to the shared Song builder in `packages/song-model`
  (`assembleSong`), the same code the MusicXML and ABC importers use, so ties, hands and repeat
  unrolling behave the same for every notation format. Repeats follow MuseScore's own playback
  rules (a backward repeat returns to the last start repeat; open volta lines reach to the next end
  repeat).
- It reads only what practice needs. Layout, lyrics, chord symbols, dynamics and articulations are
  ignored. D.C./D.S./coda jumps are reported as a warning, as for MusicXML.

The reader was written from the file format as MuseScore writes it; no MuseScore source code was
copied. Test fixtures are generated in code.

## Consequences

- No new dependency and no licence risk; the reader is a few hundred lines of AGPL code.
- The main bundle does not grow: the reader is its own chunk.
- We must follow format changes ourselves. MuseScore keeps old formats readable and changes
  slowly; new versions add elements we can ignore. Unknown elements are skipped, not fatal.
- Rendering a MuseScore file exactly as MuseScore does is out of scope; the score view (P1-15)
  renders the resulting `Song`/MusicXML instead.
- MuseScore 1.x files are rejected with a message asking the user to re-save them in a current
  MuseScore or export MusicXML.

## Alternatives considered

- **webmscore (GPL-2.0-only):** licence incompatible with AGPL-3.0, and large. Rejected.
- **Asking users to export MusicXML from MuseScore:** works today, but is the friction spec §8
  wanted to remove; kept as the fallback advice for files the reader cannot handle.
- **Converting on a server:** breaks hard rule 3 (no user music leaves the device unencrypted).
