# 0009 — Score views with Verovio, linked to the `Song` by measure, onset and pitch

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P1-15, P2-11, P2-12, P1-24

## Context

The spec (§6, §8 table "Notation rendering") picks Verovio to engrave MusicXML and ABC in the
browser. Practice needs more than a picture: each `Song` note must be linked to its glyph so the
score can show the expected, correct and wrong notes, a cursor that follows `session.beat`, and the
hardest bars after a run. Constraints:

- **Licence.** Verovio is LGPL-3.0-or-later, compatible with the app's AGPL-3.0-or-later.
- **Size and offline use.** The npm package embeds its WebAssembly in one ~7.3 MB ES module
  (`verovio/wasm`). The app must work offline after the first visit and make no third-party
  requests (hard rules 3 and 5).
- **Repeats.** The `Song` unrolls repeats into playback order (ADR 0003); the score shows them
  once. Verovio's timemap also unrolls them, naming later passes `<id>-rend2`, but the two readers
  need not unroll every score the same way.
- **Original files.** Library items keep their original bytes (`LibraryItem.bytes`); MIDI and audio
  imports have no notation; Verovio cannot read MuseScore files.

## Decision

1. **Lazy chunk, precached.** `apps/web/src/views/score/verovio.ts` imports `verovio/wasm` and
   `verovio/esm` with dynamic `import()`, so the main bundle does not grow. Vite emits one chunk of
   about 8 MB; the service worker precaches it (Workbox's per-file limit is raised to 16 MiB), so
   the score views work offline even if they were never opened online. Verovio's fonts are built
   in; it fetches nothing.
2. **Render the original file.** Catalogue pieces render their score file; library items render
   `LibraryItem.bytes` (MusicXML, `.mxl` unzipped with the song model's `unzipMxl`, ABC), with
   Verovio's `transpose` option set to the import's transposition. MIDI, audio and MuseScore pieces
   keep the falling-notes view and say why next to the view switch.
3. **Link by (source measure, onset in measure, pitch).** From Verovio's timemap each rendered note
   gets its measure (document order, which is `Measure.sourceIndex`), its onset within the measure
   and its MIDI pitch (`getMIDIValuesForElement`). A `Song` note has the same three values, so both
   passes of a repeat link to the same glyph. Fallbacks: same measure and onset with the closest
   pitch (octave signs), then the unrolled onset and pitch (bars numbered differently). Tied notes
   also take the glyphs of their continuations. The matcher is pure (`glyph-map.ts`) and tested
   with a synthetic timemap and with the real Verovio in Node.
4. **Cursor from anchors.** Per playback measure: the barline, each linked note head and the end
   barline give (beat, x) anchors; the cursor interpolates between anchors of the same system, so
   it glides through a bar and jumps back at a repeat (`cursor-map.ts`).
5. **Two layouts, one controller.** The scrolling score renders one long system (`breaks: none`)
   that scrolls under a cursor kept 30 % in from the left (the play bar is now in the middle, ADR 0012). The page view renders pages sized to the
   view, turns pages automatically when the cursor reaches another page, and turns them with the
   page buttons or the keys a Bluetooth page-turn pedal sends (PageDown/PageUp, arrows, Space in
   wait mode) while no timed run is playing. `ScoreController` does all DOM work from
   `requestAnimationFrame`; React only mounts it (docs/development.md).
6. **Feedback marks in the session.** `PracticeSession.marks` records per note `correct` or `wrong`
   (a wrong key while the note was expected, or a miss in play-along). The score colours from it.
7. **Fingering.** Verovio draws MusicXML fingering itself. Its ABC reader ignores fingering, so
   when a drawing has no fingering but the `Song` has, the controller adds the numbers above (right
   hand) or below (left hand) the note heads.

## Consequences

- First visits download about 8 MB more (about 2.4 MB gzipped) for offline use. If that becomes a
  problem, the chunk can move to a runtime cache filled the first time a score view opens.
- Engraving runs on the main thread when a score view opens (and again when the page view is
  resized). Very long scores may need a worker that returns SVG strings; measuring stays in the
  DOM.
- Scores whose bars Verovio and the song model count differently fall back to the unrolled onset;
  notes that still do not match are simply not coloured.
- The view choice is stored per device (`settings.practiceView`). (Since P5-17 the page view has no
  tab of its own: it is the Sheet tab of a piece without a PDF, ADR 0018, and a stored `page` is
  read as `sheet`.)

## Alternatives considered

- **OpenSheetMusicDisplay** (spec §8): BSD-3, has a cursor, but is larger, slower on iPad and its
  cursor walks the score itself instead of following our `Song`.
- **Matching by Verovio's unrolled time only:** simpler, but breaks as soon as the two readers
  unroll repeats or count a pickup bar differently.
- **Runtime caching of the Verovio chunk:** smaller first visit, but the score would be missing
  offline for anyone who had not opened it online.
