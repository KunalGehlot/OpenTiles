# packages/importers (phase 2+)

Heavy converters that are loaded only when a user imports a file that needs them, so they never
weigh down the main bundle:

| Format            | Converter                                                     | Plan task                                 |
| ----------------- | ------------------------------------------------------------- | ----------------------------------------- |
| MuseScore `.mscz` | webmscore (MuseScore compiled to WebAssembly) → MusicXML      | P2-10 (check licence fits AGPL-3.0 first) |
| PDF / photo       | Optical music recognition model in the browser (experimental) | P4-01                                     |
| Audio recording   | Basic Pitch audio-to-MIDI model, in `packages/audio-import`   | P4-02                                     |

Every converter runs on the user's device and produces a `Song` via `packages/song-model`.
Nothing is uploaded for processing.
