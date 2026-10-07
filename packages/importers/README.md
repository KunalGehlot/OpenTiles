# packages/importers

The single entry point for importing a file, `importAnyScore(fileName, bytes)`, and the converters
that are loaded only when a user imports a file that needs them, so they never weigh down the main
bundle.

```ts
const { importAnyScore } = await import('@opentiles/importers');
const song = await importAnyScore(file.name, new Uint8Array(await file.arrayBuffer()));
```

`importAnyScore` recognises the format by extension and content. MusicXML, `.mxl`, MIDI and ABC go
to `importScore` in `packages/song-model`; MuseScore files go to the lazy-loaded reader here.

| Format                     | Converter                                                     | Plan task    |
| -------------------------- | ------------------------------------------------------------- | ------------ |
| MuseScore `.mscz`, `.mscx` | Own reader (`src/musescore.ts`), see ADR 0005                 | P2-10 (done) |
| PDF / photo                | Optical music recognition model in the browser (experimental) | P4-01        |
| Audio recording            | Audio-to-MIDI model                                           | P4-02        |

Every converter runs on the user's device and produces a `Song` via `packages/song-model`.
Nothing is uploaded for processing.

## MuseScore reader

Reads MuseScore 3.x and 4.x files and the common parts of 2.x: parts and staves (a two-staff part
gives the hands by staff), measures and pickups, voices, chords, rests, dots, tuplets, time and key
signatures, tempo, fingering, ties, repeats, voltas and section breaks. Percussion parts are left
out. Repeats are unrolled with MuseScore's own rules. D.C./D.S./coda jumps are not followed yet
and produce a warning.

The reader was checked locally against MuseScore's own regression files for repeats and for the
2.x → 3.x format conversion. Those files are GPL-licensed and are not part of this repository; the
unit tests use fixtures generated in code (`test/fixtures.ts`).
