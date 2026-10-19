# 0021 — Expressive playing in the Player

- **Status:** proposed
- **Date:** 2026-10-19
- **Plan task:** P6-16 (amends ADR 0020 for the Player; plan Q12)

## Context

On 2026-10-19 the maintainer heard the Player on their own digital piano, over MIDI, and found it
"very flat", missing a fuller sound, and asked whether the sustain pedal or the force of the keys
was missing. Both were. None of the 81 catalogue scores has a pedal mark, a dynamics mark or a
hairpin (`arrange.py` writes none), so ADR 0020's "the pedal as the file says" sent no pedal at all,
and natural touch (P6-11) kept every note between about 59 and 89. A pianist adds both from the music
itself. The brief (`docs/phase-6/player-piano.md` §5.3) planned the phrasing half; the pedal half
is new.

## Decision

- **One switch, "Play expressively"**, in the Player's options, on by default and kept with the
  settings (`player.expressive`). Practice never uses it (Q12): Listen, play-along and the learner's
  own pedal stay as the file says.
- **Touch** (`expressiveVelocities`, `packages/practice`): for notes the file leaves unshaped (no
  velocity, or one velocity for every note, as a typed-in MIDI file has) the melody (top right-hand
  note of each onset) sings about 14 above a base of 66, the bass carries, inner notes stay back
  (−8 right hand, −13 left), the metre adds natural touch's accents, and each phrase (from
  `splitPhrases`) rises from −8 to +12 at its highest melody note and falls to −12 at its end, the
  accompaniment following at 0.6. A phrase sung higher than the piece's average is a little louder.
  Clamped to 24–112. A performance's own velocities are kept.
- **Pedal** (`autoPedal`), only when the file has no sustain pedal of its own:
  - Harmony changes are read over whole pulses of at least 0.4 s within a bar: the bass moving to
    another note at or below where it was, or two new pitch classes in the accompaniment (three in
    all). An Alberti or waltz bass stays one harmony.
  - The pedal changes at each new harmony as a legato pedal: up as the new notes start, down again
    0.1 s later, so the old harmony is cleared and the new one caught.
  - It also changes where holding on would smear two notes into one sound: a semitone anywhere, or
    a whole tone that the melody or a voice moves by (from what its hand played just before). A
    tone between chord notes further apart (a G7's seventh against its root) rings as harmony.
  - It comes up a little into a rest of every key (at most a quarter beat), and at the end.
  - It goes down only where it can stay down at least 0.3 s before it must change again, looking
    ahead; faster than that a pianist keeps the foot up.
  - The events are ordinary `PedalEvent`s in beats, so the held lengths for this device's piano,
    the control changes for a keyboard, seeking and the pedal light all work unchanged.
- **Endings:** a lift exactly where the played range ends is now sent, and the transport lifts every
  pedal as a piece ends, so nothing is held into the gap or the next piece.
- Applied at playback, never stored (ADR 0003).

Measured over the catalogue with the rules above (2026-10-19): no piece has a semitone that only
the pedal makes ring with its neighbour for more than 150 ms, and at most 5.6 such whole tones a
minute (a Bach invention). The pedal is down 79 % of the time on average: about 90–96 % in hymns,
lullabies and Chopin's Prelude in E minor, 18–78 % in the Bach inventions. Velocities spread over
about 30 steps between the 10th and 90th percentile (39–106 in all), against 59–89 before.

## Consequences

- The catalogue sounds played on a digital piano: pedalled, with a singing melody and phrases.
- The rules are guesses a pianist might make, not a pianist's choices. Some pieces will want
  different pedalling (the Bach inventions are often played with none). The switch turns it off;
  a per-piece hint could come later.
- A file's own pedal marks or recorded velocities always win, so imported performances are not
  touched.
- The slowing at the end, the held last chord and dynamics marks from imported MusicXML (the rest
  of §5.3) are still to do: they change the timing, which the transport, the seek bar and the media
  controls all read.

## Alternatives considered

- **Pedal at every bar line.** Simple, but smears every bar with a passing note and misses harmony
  changes inside a bar.
- **No automatic pedal, phrasing only.** The maintainer's complaint was the missing fullness; a
  piano without its sustain pedal stays dry however the touch is shaped.
- **Write pedal marks into the catalogue scores.** It helps only the catalogue, needs a pianist's
  edit of 81 scores, and would put guesses into the engraved score as if the composer wrote them.
