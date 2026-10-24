# 0025 — Dynamics marks as note velocities

- **Status:** accepted (the maintainer chose this option, 2026-10-24)
- **Date:** 2026-10-24
- **Plan task:** P6-16 (completes ADR 0021's "rest of §5.3")

## Context

ADR 0021 gave the Player phrasing, a pedal and an ending, but left out the score's own dynamics:
an imported MusicXML file's p, f, hairpins and accents were read for the engraving only, so a
piece marked pp played as loud as one marked ff. None of the catalogue's 81 scores has a mark, so
this is about the scores people import.

The queue said "a `Song` model change; ask first". Two ways were put to the maintainer: a new list
of dynamics in the `Song`, read at playback, or the importer setting each note's `velocity`, the
field a MIDI file already fills.

## Decision

The importer sets each note's `velocity` from the marks (`packages/song-model/src/dynamics.ts`).
No new field in the `Song`.

- **Levels** are MuseScore's playback values: ppp 16, pp 33, p 49, mp 64, mf 80, f 96, ff 112,
  fff 126. Where a mark has a `<sound dynamics>` (a percentage of forte at 90), that wins: it is
  how the file played where it was written.
- **Hairpins** (`<wedge>`) and the words "cresc." / "dim." grow or fade note by note, from the
  level where they start to the mark at, or up to a beat after, their end. Without such a mark
  they move one step on the ladder and the music stays there. A "cresc." with no end runs to the
  next mark.
- **Accents:** sf, sfz, sffz, fz, rf and rfz lift the notes that start under them 32 above the
  music around them; fp plays forte and then piano; sfp and sfpp accent and then drop.
- **Which notes a mark is for:** a mark written for one staff is that staff's own when that
  staff has marks of its own, so each hand of a grand staff can have its own dynamics; a staff
  with none follows every mark of its part, as a piano's one line of marks between the staves
  does. A part with no marks is left alone. Repeated bars repeat their marks; a tied note keeps
  the loudness it started with; notes before the first mark are mezzo-forte.
- **Playback keeps shaping:** natural touch and the Player's expressive touch lean into the
  melody, the downbeat and the phrase around the marked level, exactly as they do around
  mezzo-forte in a score without marks (an mf mark plays as no mark). "Even" plays the marks as
  they are.
- **A score is never a recording.** `isNotated(format)` (MusicXML, MXL, ABC, MuseScore) tells a
  score's velocities, its marks, from a MIDI file's. Without that, a long hairpin in a melody
  would spread more than twelve velocities and ADR 0021's test would take the score for a
  performance and switch shaping off.

## Consequences

- One loudness model for every source: the Player, Listen and the keyboard output read `velocity`
  as before, and a marked MusicXML file and its MIDI export now sound alike in level.
- `velocity` on a score's note now means "the written level", not "how a pianist struck it".
  Code that wants a file's own touch must check `isNotated` first; `isPerformance` and the touch
  functions do.
- Pieces imported before this change keep their stored song until they are imported again.
- Dynamics in MuseScore files read natively (`.mscz`) and in ABC (`!p!`, `!crescendo(!`) are not
  read yet; they can feed the same `RawDynamic` list later.
- Loudness is not judged in practice; if a later feature needs the marks themselves (a dynamics
  drill, say), it can add them to the `Song` then, from the same parser. The score view already
  engraves them from the file.

## Alternatives considered

- **A dynamics list in the `Song`, applied at playback.** Cleaner if features need the marks
  themselves, but a model change with twice the work, and the Player would need a second path
  beside the one MIDI exports already use. Kept for when such a feature comes.
- **Absolute accent values (MuseScore's sf = 112).** An sf in a pp passage would then jump to
  nearly fortissimo; an accent is relative to the music around it, so it lifts by a fixed amount.
- **Counting only hairpins with a stop.** Many scores write "cresc." in words, with or without
  dashes; treating the words as a hairpin to the next mark covers them.
