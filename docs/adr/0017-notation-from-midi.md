# 0017 — A printed score for MIDI files, written from the song

- **Status:** proposed
- **Date:** 2026-10-11
- **Plan task:** P5-13

## Context

Many learners get their pieces from score-sharing sites that offer a PDF, a MIDI file and audio,
but rarely MusicXML or MuseScore files. Imported on its own, a MIDI file gave falling notes only:
ADR 0009 draws the original file, and a MIDI file has no notation to draw. Learners asked for the
scrolling and page score views for these pieces too, with the cursor and the right and wrong note
marks working as they do for MusicXML.

What MIDI exports from notation software (MuseScore in particular) look like, from files checked
locally (they are not in the repository):

- one track per staff (upper staff first), all on one channel, 480 ticks per beat;
- key and time signature events at the start and at every change, repeated on each track;
- many tempo events, because ritardandos and fermatas are played as tempo changes;
- every onset exactly on a beat division, but most notes sounding for about 95 % of their value
  (some for all of it), rolled chords starting a few ticks apart, and repeats written out;
- no sign of a pickup bar: the time signature gives the full metre from the first note.

Two problems followed. First, the MIDI quantiser (spec §8: the coarsest grid that keeps 95 % of
onsets within ±30 ms) moved the few per cent of triplets and 32nds of such files to the common
grid; on those two files it chose a half-beat and a quarter-beat grid. Its tolerance is in seconds,
so it also depends on the tempo. Second, nothing could draw notation from a `Song`.

Constraints: all processing stays on the device (hard rule 3); `song-model` stays pure (no DOM);
the score views link glyphs to notes by source bar, onset in the bar and pitch (ADR 0009).

## Decision

1. **Notated MIDI keeps its written rhythm.** `midiToSong` treats a file as notated when nine
   onsets in ten sit exactly on a beat division (binary down to 1/32 of a beat, triplets down to
   1/24); played files land there about one time in ten at 480 ticks per beat. Notated files are
   quantised in ticks (`quantiseNotated`): onsets on a division are kept; an onset off them joins
   the chord it is rolled from (a note of the same track that starts up to half a beat earlier and
   ends with it), or moves to the nearest division; each end moves to the written value the note
   sounded for, the division point after the sounding end that best fits a 95 % or full-length
   sound, with a small cost per finer division so long notes end on beats. Tempo changes play no
   part. Played files keep the spec §8 rule, which this ADR does not change. Key and time
   signatures are kept once per change.
2. **Pickup bars from later barlines.** Notation software writes key and time changes on barlines.
   When every key change in the first metre, and the first time change, falls the same part of a
   bar after the barlines counted from the start, the piece opens with a pickup that long
   (`pickupBeats`; bar 0, then bar 1). Without such a change no pickup is assumed: the notes alone
   do not show one reliably.
3. **A writer in `song-model`.** `songToMusicXml(song)` writes the song as a piano score
   (MusicXML 4.0, one part on two staves, string building only): bars one to one with
   `song.measures` (implicit when shorter than their time signature); key and time signatures;
   staff 1 notes on the upper staff and the rest on the lower; a clef per bar chosen by ledger
   lines, changed only when the other clef is clearly better for two bars with notes; pitches
   spelled for the key (each key gets twelve neighbouring positions on the line of fifths: its own
   notes, the lowered third and seventh, the raised fourth, first and fifth; minor keys, from the
   file or from the last bass note, raise their leading note) with accidentals written per bar and
   line, Verovio does not derive them from `<alter>`; voices for overlapping lines, the highest with
   stems up, the longest-sounding showing all its rests; ties at barlines, at the next beat for
   notes off the beat and at the middle of a 4/4 bar; rests where their value falls in the bar;
   beams per beat (written out, as Verovio does not beam MusicXML itself); triplets per beat, or
   over two beats for quarter-note triplets; the first tempo as a metronome mark and later tempo
   changes as sound-only events.
4. **The score is a view of the song, and the ids line up by construction.** Every song note is
   written in its own bar, at its own onset and pitch, so ADR 0009's matching would find it. The
   writer goes further: each written `<note>` gets the ref `parseMusicXml` would give it
   (`p0-m{bar}-n{index}`) as its `id`, Verovio keeps that as the glyph's id, and the writer returns
   the song with each note's `sourceRefs` set to its head and tie continuations. The score views
   link a written score straight from those refs (`linkByRefs`) instead of the timemap and a pitch
   query per glyph, which took most of the time on a long piece. The practice session uses the song
   the learner reviewed on import, with those refs added, not the score read back: reading it back
   would take the hands from the staves (undoing "Swap hands"), drop velocities and take the
   durations from the drawing. ADR 0015 chose one text for drills; here the round-trip test
   (`parseMusicXml` of the output gives the same notes, bars, signatures, tempos and refs) and a
   Verovio test (linking by ref gives the very glyphs the timemap matching finds, transposed too)
   keep the two sides in step.
5. **Written when the piece opens.** The score is written from the stored song every time the
   practice screen loads (about 14 ms for 2,346 notes in Node), so it follows the import review
   (transposition, hands) and later writer improvements without a storage change. It is drawn with
   no transposition of its own; shifting the piece during practice transposes it like any score.
   A line under the score says it was made from the MIDI file and may differ from the printed
   music.
6. **MIDI only.** Audio imports keep the falling-notes view: their notes are seconds on a fixed
   120 bpm grid with no beat, and would be written as 128th notes and ties. MuseScore imports keep
   it too: their songs unroll repeats, so a written-out score would not match their bars, and a
   real conversion of the MuseScore file would keep its own notation.

## Consequences

- MIDI pieces get both score views, the cursor, note colours, tied-note colours, hardest bars and
  the transpose control. On a 2,346-note MuseScore export (237 bars) the round trip is exact,
  every note links to a glyph of its own pitch, and on the two pages compared by eye the engraving
  matches the printed edition in rhythm, bars, keys, metre changes, ties, chords and accidentals.
- Opening the scrolling score of that piece blocks the main thread for about 0.6 s in Chromium
  (1.2 s before linking by ref); the page view about 0.5 s. That cost is Verovio's engraving and
  the controller's DOM work, the same as for a MusicXML file of that size. Moving Verovio into a
  worker (ADR 0009) is the next step if it matters.
- Not drawn: dynamics, slurs, pedal, articulation, text and arpeggio signs (a MIDI file does not
  keep them); grace notes appear as short notes, because notation software plays them in time;
  written-out ornaments appear as fast notes; quintuplets and other tuplets than triplets are
  approximated with short values; repeats are written out; voices, clefs and enharmonic spelling
  come from rules, not from the original; clef changes are at barlines only.
- Library items imported before this change keep the song quantised the old way until they are
  imported again, so their scores show the old rhythms.
- The spec §8 quantisation rule now applies to played MIDI files only.

## Alternatives considered

- **Converting on a server** (MuseScore's command line, or a web service). Rejected: the user's
  music must not leave the device unencrypted (hard rule 3), and the app has no server.
- **Practising with the score read back** (one text, as for drills, ADR 0015). Simpler to prove,
  but it loses the hand choices, velocities and exact durations of the import, see decision 4.
- **Matching by measure, onset and pitch only** (ADR 0009 as it is). It works for written scores
  too, and the Verovio test shows both give the same glyphs, but it needs the timemap and a pitch
  query per glyph: about half of the main-thread time on a long piece.
- **Storing the written MusicXML with the library item.** Rejected: a storage change for something
  that takes milliseconds to write, and stored scores would not pick up writer improvements.
- **A third-party MIDI-to-notation converter.** Verovio does not read MIDI files. Any converter
  would still have to keep every onset exact and report which glyph draws which note; that is most
  of the work, so the writer is our own, in the package that already owns the `Song`.
- **Recognising grace notes and writing them as such.** Deferred: the parser skips grace notes,
  so they would need their own linking, and guessing them wrongly would change what the learner
  practises.
