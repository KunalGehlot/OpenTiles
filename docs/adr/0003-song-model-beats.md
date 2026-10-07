# 0003 — The `Song` model stores musical time in quarter-note beats

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P1-01

## Context

Every importer (MusicXML, MIDI, later ABC and MuseScore) must produce one internal model
(spec §8). Practice modes need seconds; notation needs beats and bars; tempo can be changed by the
user (25–150 %) and by the score itself.

## Decision

- Notes, bars, tempo, time and key signatures are positioned in **quarter-note beats** from the
  start of the unrolled piece (repeats expanded into playback order).
- Seconds are derived on demand from the beat-indexed tempo map (`beatToSeconds`,
  `secondsToBeat`); the practice tempo factor scales seconds, never the stored data.
- Tied notes are merged into one `SongNote`; references to every original glyph are kept in
  `sourceRefs` so the score view can still colour each one.
- Hands are explicit (`'left' | 'right'`) on each note so the import review screen can change the
  split without re-parsing.

## Consequences

- MusicXML maps directly (divisions → beats). MIDI ticks map directly (ticks / PPQ).
- Tempo edits are cheap and lossless.
- Fractional beats (triplets) are stored as floating-point numbers; comparisons use a small epsilon
  (`BEAT_EPSILON`).

## Alternatives considered

- **Seconds:** natural for MIDI and audio, but every tempo change would rewrite all notes, and bar
  positions would be lost.
- **Rational numbers for beats:** exact, but heavier in every consumer; floating point with an
  epsilon is enough at the precision MusicXML and MIDI carry.
