# 0015 — Sight-reading drills: generated MusicXML, the practice screen with nothing given away

- **Status:** proposed
- **Date:** 2026-10-10
- **Plan task:** P5-05

## Context

P5-05 asks for sight-reading drills: random notes or short phrases on a staff, with a choice of
clef and key signature, note names on or off, and a speed readout, played with MIDI, the microphone
or the on-screen keys. The material must be free to use (hard rule 4), and nothing may leave the
device (hard rule 3).

Two questions needed a decision: where the drills come from and how they become something the app
can show and judge, and what the practice screen may show while a learner is reading. The practice
screen normally helps as much as it can: falling notes, the key to press lit in the hand's colour,
names on the notes and the keys, an overview of the whole piece. In a drill each of those gives the
answer away, so the learner would be matching colours rather than reading the staff.

## Decision

- **Generated in code, seeded.** `packages/practice/src/drills.ts` makes a drill from its options
  (clef: treble, bass or both; a key from three flats to three sharps; three ranges: around middle C,
  the whole staff, with ledger lines; single notes or short phrases; a number of bars) and a seed,
  with a small seeded generator (mulberry32). The same options and seed always give the same drill,
  so a link (`#/practice/drill/treble.1.1.notes.8.12345`) is a drill that can be played again. Notes
  stay in the key, one at a time, a quarter each: the drill tests reading pitches, not rhythm.
  Phrases move mostly by step and start and end on the tonic. Everything is made by this code, so it
  is CC0 by construction and needs no provenance record.
- **MusicXML is the one text.** The generator writes MusicXML (one part, one staff or two); Verovio
  engraves it, and song-model's MusicXML parser turns the same text into the `Song` the session plays
  and judges. The score's glyphs and the song's notes therefore match by measure, onset and pitch, as
  for any MusicXML piece. With both clefs, each beat has a note on one staff and a hidden rest on the
  other. Note names, when chosen, are lyrics, written in the learner's note-name style (P5-03). A
  unit test reads every clef and key back through the parser and checks the pitches, hands and
  beats.
- **The practice screen, with a guide level.** A drill opens the normal practice screen in wait mode
  with both hands, in the page view, which shows the whole drill so the learner can read ahead, and
  gives it the room the falling notes would take. `PracticeSession.guide` says how much the screen
  gives away: `full` for pieces, `keys` (the key to press lights up; a first step a learner can
  choose) or `none`, the default for drills (no falling notes, no lit key, no names on the keys). The
  overview strip, the transpose control and suggested fingers are left out of drills. The learner's
  choices for pieces (mode, hands, tempo, view) are not changed by a drill.
- **Scoring.** The speed readout is right notes a minute over the run, and the share of notes right
  at the first try, from the live tally (P5-07): in wait mode a note right at the first try counts as
  perfect, one found after a wrong key as good. Drills add to the day's practice time and the streak,
  but keep no progress record, because there is no piece to come back to.
- **Endless.** With "Endless" on, the next drill (a new seed, the same choices) starts a moment after
  one ends. "Next drill" does the same by hand.

## Consequences

- No new screen to build or keep in step: inputs, wait mode, the score cursor, live stats, the
  metronome and the microphone work in drills as they do everywhere.
- Drills depend on song-model's MusicXML parser and Verovio's MusicXML import agreeing; the
  round-trip unit test and the end-to-end tests (both staves drawn, the expected note marked) watch
  that.
- A drill's range is fixed per level and clef; a learner cannot yet choose exact notes or add
  accidentals beyond the key signature. Rhythm reading is left for later.
- Wait-mode speed is a fair measure only when the learner plays as soon as they have read a note;
  play-along mode at a set tempo is the stricter test and works with drills unchanged.

## Alternatives considered

- **A separate drill screen drawing its own staff.** More control over the look, but a second staff
  renderer, cursor and input path to maintain. Rejected: the practice screen already has all of it.
- **ABC as the one text.** Shorter to write, and song-model reads it well, but Verovio's ABC import
  does not support simultaneous voices: it placed the bass staff's notes after the treble staff's,
  so grand-staff drills could not be drawn or linked. Tried first and dropped.
- **Generating a `Song` and the notation separately.** Two outputs that must agree, written by
  hand. Rejected: one text read by both sides cannot disagree.
- **Recording drills as progress entries (`drill:…` keys).** Backup and sync ignore keys that are not
  catalogue or library pieces, and Home would never show them. Rejected: practice time is what
  matters for drills, and that is kept.
- **Using the falling-notes view for drills.** It shows where to play, which is what sight-reading
  practice must take away.
