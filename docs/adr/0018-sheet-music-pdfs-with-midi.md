# 0018 — Sheet-music PDFs kept with a piece, followed by its MIDI

- **Status:** proposed
- **Date:** 2026-10-10
- **Plan task:** P5-14, P5-15

## Context

Learners find most pieces on score-sharing sites that offer only a PDF, a MIDI file and a
recording; MusicXML or MuseScore files are rarely available. OpenTiles imports the MIDI file
(falling notes and feedback; P5-13 adds a score generated from it), but the learner wants to read
their own sheet, the edition they downloaded, while they practise.

Two findings shape the design (checked on the maintainer's own downloads, which stay off the repo):

- A PDF exported by MuseScore is an engraved vector drawing: staff lines and barlines are plain
  straight path segments, and every glyph (noteheads, clefs, text) is an outlined path. It has no
  text and no images. Where the bars are can be read exactly from the drawing.
- The MIDI file from the same site is notation-exact: one track per staff, 480 ticks per quarter,
  key and time signature events, repeats played out in order.

Reading notes from a PDF (optical music recognition) is a much larger problem and stays P4-01.

Hard rules that apply: imports take local files only (no URL import, no fetching from any site);
all processing stays on the device; library items have no way out except the encrypted backup.

## Decision

1. **A PDF is kept beside a piece, never read for notes.** `LibraryItem.sheet` holds the PDF's
   bytes, its file name and, once analysed, a `SheetMap` (`packages/sheet`). The notes, the
   feedback and the falling notes come from the piece's song as before.
2. **Pairing.** Importing a `.mid` and a `.pdf` with the same base name together (as the sites name
   them) makes one piece. A PDF can be added to, replaced on, or removed from an existing piece. A
   PDF imported on its own becomes a "sheet only" piece (`format: 'pdf'`, empty song) that can be
   read but not practised until a MIDI or score file is added to it.

   How the library applies this (P5-15): files picked or dropped together are grouped by base name,
   ignoring case, spacing and the extension. A score file pairs with the PDF of the same name; when
   a name has several of either, the first of each pairs and the others are pieces of their own.
   Recordings are never paired, since their notes are a guess. When exactly one score file and one
   PDF are picked under different names, the learner is asked whether they are one piece. Adding
   notes to a sheet-only piece keeps its sheet but drops the map unless the learner corrected it;
   replacing the PDF always drops it. A PDF must have a PDF header and be at most 60 MB.

3. **Drawing.** pdf.js (`pdfjs-dist`, Apache-2.0) renders the pages, loaded only when a piece has a
   sheet, with its worker and any font or character-map data served from the app's own origin
   (`connect-src 'self'`; no `eval`). Pages are rendered lazily at the size shown, so long PDFs stay
   light on an iPad.
4. **Finding the bars.** `packages/sheet` finds staves, systems and barlines (with repeat signs and
   endings where it can) and gives written bars in reading order (`SheetLayout`). Vector PDFs are
   read from pdf.js's operator list; scanned PDFs fall back to the rendered page image.
5. **Following the song.** The song's measures are in playback order, the sheet writes a repeated
   passage once. An alignment maps each played measure to a written bar (`SheetMap.barOfMeasure`),
   following repeat signs and endings and checked against the notes per bar. The practice screen's
   "Sheet" view shows the learner's pages with the current bar highlighted and turns pages itself.
6. **Corrections.** The learner can fix the map (which bar a measure is, a missed or extra
   barline). A corrected map is marked `edited` and never overwritten; unedited maps are redone
   when the analyser version rises.
7. **Privacy and backup.** The PDF and its map stay in IndexedDB on the device and travel only
   inside the encrypted backup, like the rest of the library item.

## Consequences

- A learner with a PDF and a MIDI file practises from their own sheet with the cursor on it, and
  gets the falling notes and feedback from the MIDI.
- pdf.js adds a large lazy chunk (and its worker) to the offline cache. It must not load for
  pieces without a sheet.
- The bar map is only as good as the detection and alignment. Unusual layouts (multi-bar rests,
  D.C./D.S. jumps, cue staves, scans) will need the learner's corrections.
- Library items get bigger (PDFs are often 1–5 MB); the import limits and the backup must allow
  for that.

## Alternatives considered

- **Optical music recognition of the PDF** (P4-01): would remove the need for the MIDI file, but
  reliable OMR in the browser is a research project; the MIDI is already exact.
- **Showing only a score generated from the MIDI** (P5-13): done as well, but it is not the
  edition the learner reads, and loses fingering, dynamics and layout.
- **Converting on a server:** breaks the rule that music never leaves the device unencrypted.
- **Rasterising the PDF on import and keeping images:** larger, blurry when zoomed, and loses the
  vector drawing the bar detection relies on.
