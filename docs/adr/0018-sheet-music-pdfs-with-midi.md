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
3. **Drawing.** pdf.js (`pdfjs-dist` 6.4.299, Apache-2.0) renders the pages
   (`apps/web/src/views/sheet/`).
   - **Legacy build.** The modern build calls `Map.prototype.getOrInsertComputed`,
     `Math.sumPrecise`, `Promise.try` and `URL.parse` without polyfills, which Safari 16.4 lacks;
     the legacy build brings core-js polyfills for them (checked by reading both builds, not on an
     old Safari).
   - **Loading.** The Sheet view and the reader are a chunk loaded with a piece that has a sheet
     (not `React.lazy`, whose first reveal React holds back about 300 ms), and pdf.js is imported
     when they open; a piece without a sheet requests none of it (e2e test).
     Vite bundles the worker (`?worker`), so it is a file of the app's own origin, and the service
     worker precaches the chunks for offline use.
   - **Network.** No fonts or character maps are served or fetched: a missing standard font falls
     back to a system font, and sheet music rarely has text that needs a CJK map. The image
     decoders for scanned pages, JBIG2 (PDFium, BSD-3-Clause) and JPEG 2000 (OpenJPEG,
     BSD-2-Clause), are WebAssembly files that `vite.config.ts` copies to `pdfjs/wasm/` with their
     licences; pdf.js fetches them from there (`wasmUrl`) only for such pages. The colour-profile
     decoder is left out: pdf.js uses it only when it may fetch from its worker, which it does not
     here, and falls back to the alternate colour space.
   - **No eval, no CSP change.** pdf.js 6 has no `isEvalSupported` option any more: its PostScript
     functions run in an interpreter, not `new Function`. The Content-Security-Policy is unchanged
     (`script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self' blob:`, `connect-src 'self'`).
   - **Pages.** The pages are drawn lazily, at the size shown and the device pixel ratio (at most 8
     million pixels a page), near the visible part of the document only; canvases far from it are
     shrunk to nothing (Safari keeps a canvas's memory otherwise). Pages stay paper-white in dark
     mode. The fitting width is at most 1100 CSS px, with a zoom from 50 % to 300 %.
   - **Following.** The bar being played is highlighted, with a thin cursor moving through it from
     its first note head to its end, from `requestAnimationFrame` and not through React. When the
     bar leaves the view, the view scrolls (smoothly unless Reduce motion is on) so its system sits
     near the top with the next ones below; for 2.5 s after the learner scrolls or zooms it leaves
     the scrolling to them. A tap on a bar goes there (`PracticeSession.seek`) while no run plays.
4. **Finding the bars.** `packages/sheet` reads pdf.js's operator list into straight strokes and
   filled outlines (`drawingFromOperatorList`, every transform and form applied; thin filled
   rectangles count as strokes) and finds, with every threshold in staff spaces:
   - staves: five equally spaced horizontal lines of the same length (at least six spaces long, so
     stacks of ledger lines are not staves); pieces of one line are joined first;
   - systems: staves joined by a vertical line or a brace at their left;
   - barlines: vertical strokes whose ends lie on a staff's top and bottom lines and that together
     cross every staff of the system (stems end anywhere and stay in one staff); strokes within
     1.3 spaces form one barline, read as single, double, final (thin and thick), or a repeat
     (thin and thick with dots in the second and third spaces of every staff; dots without a thick
     line are dotted notes);
   - endings: a horizontal line above the top staff with a hook down at its left that starts at a
     barline and covers most of its first bar (a triplet bracket starts at a note and is short); one
     running on into the next system or page continues without a hook. The printed number is an
     outlined glyph and is not read: a bracket right after another is the next ending, any other
     is the first;
   - note heads per bar: curved outlines of a head's size and shape on a line or space of the
     nearest staff (the hole of a half note is the same outline's inner contour, not a head).
     A page with no bars that paints a page-sized image is a scan: it is drawn at 150 dpi and read
     from the image (long dark runs; tilted lines are joined across their steps). Scans give staves,
     systems and barlines only: no heads, no repeat dots, no endings.
5. **Following the song.** `alignSong` unrolls the written bars by their repeat signs and endings
   with the song model's own `playbackOrder` (both conventions of where a repeat goes back to) and
   adds the written order (a MIDI file exported without its repeats) and, for a song read from a
   score, its own measure order. Each candidate is aligned with the song's measures by dynamic
   programming: a measure on a bar costs the difference between the notes the measure should show
   (notes starting in it, and notes held into it, which are written again as ties) and the heads
   found in the bar; a bar not played, a measure staying on the bar before (multi-bar rests,
   missed barlines), two measures on one bar, or one measure over two bars (an extra barline) cost
   a fixed amount more. The cheapest alignment wins and becomes `SheetMap.barOfMeasure`. Where
   heads cannot be counted (scans, or heads drawn as font text), bars are matched by order alone.
   The map records the analyser version (`ANALYSER_VERSION`, now 1).
6. **First analysis and saving.** The first time a piece with a sheet is shown, its pages appear at
   once and the bars are found in the background: pdf.js parses in its worker and the geometry
   takes a few milliseconds a page on the main thread, page by page with a yield between pages, so
   no worker of our own is needed (measured: 7 pages in about 0.1 s in Chromium and WebKit). The
   map is saved on the item by key path (`sheet.map`), only while the item still holds the PDF
   that was analysed and never over a corrected map. A map whose measure count no longer matches
   the song (notes added to a sheet-only piece, a new MIDI file) is aligned again from its stored
   bars, corrections to the bars kept.
7. **Corrections ("Adjust bars").** The bars found are outlined and numbered. "From this bar on, the
   highlight is a bar ahead / a bar behind" moves every measure from the current one on by one bar.
   A tap on a barline removes it; a tap elsewhere in a bar goes there and marks the place, and
   "Add a barline here" splits the bar (its heads shared by width); either matches the song again.
   Undo steps back; "Find the bars again" forgets the corrections. A corrected map is marked
   `edited` and is never overwritten by a newer analyser.
8. **Sheet-only pieces.** A piece with `format: 'pdf'` (or no notes) opens as a reader: the pages,
   page turns and zoom, and the text "Add the MIDI file of this piece to practise it with falling
   notes and feedback." with a slot for the button that adds it (P5-15).
9. **Privacy and backup.** The PDF and its map stay in IndexedDB on the device and travel only
   inside the encrypted backup, like the rest of the library item.

## Consequences

- A learner with a PDF and a MIDI file practises from their own sheet with the cursor on it, and
  gets the falling notes and feedback from the MIDI.
- pdf.js adds lazy chunks to the offline cache: 476 KiB of library and 1.2 MiB of worker
  (143 KiB and 369 KiB gzipped), 346 KiB of image decoders, and 41 KiB for the Sheet view and the
  reader; the precache grows from 15.6 to 17.6 MiB. The first load grows by about 3 KiB. Pieces
  without a sheet load none of it.
- The bar map is only as good as the detection and alignment. Measured on one real 7-page
  MuseScore export (the maintainer's, kept off the repository): every system and every one of its
  237 bars was found on every page, from the drawing and also from 150 dpi images of the pages,
  and every measure of its MIDI file was matched to its own bar. That piece has no repeats or
  endings, so those are covered by generated tests only.
- Known limits, for the learner's corrections: D.C., D.S. and coda jumps are not followed (the
  alignment then skips or stays on bars); a multi-bar rest is one written bar; heads drawn as
  font text (common in exports from other engravers) are not counted, so such sheets are matched
  by bar order only; a pickup that the MIDI file plays as a full first measure (no time signature
  for it) leaves the highlight a fraction of a bar off, which `barOfMeasure` cannot express;
  scans give no repeats or endings; two systems side by side on one line, ossia and cue staves
  are not handled.
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
