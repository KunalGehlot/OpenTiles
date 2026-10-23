# 0024 — Scale drills: generated scales with written fingering, judged as runs

- **Status:** proposed
- **Date:** 2026-10-23
- **Plan task:** P7-14 (decisions for P7-15 to P7-23; the plan is
  [docs/phase-7/scales.md](../phase-7/scales.md))

## Context

Issue #47 asked for scale and chord practice. The chord drills (ADR 0022) built a Drills hub, a
seeded MusicXML generator, sheet and falling-keys displays, a judging layer and progress kept on the
device; scales were left for after them, "on the same pieces" (Q4 of the chord plan). A scale adds
three things a chord does not have: a key signature, a fingering that is the point of practising
it, and a run whose steadiness matters. The plan's ten questions went to the maintainer on
2026-10-23, who has little music theory and handed the decisions over ("go ahead with best of your
knowledge"), so the recommendations were taken as they stood.

## Decision

- **Where:** a third card, Scales, on the Drills hub (`#/drills/scales`). A drill id that starts
  with `scales` is a scale drill, one that starts with `chords` a chord drill, anything else
  sight-reading, so old links keep working.
- **Scales** (Q1, `packages/practice/src/scales.ts`): major; natural, harmonic and melodic minor;
  the five other modes (dorian, phrygian, lydian, mixolydian, locrian); major and minor pentatonic;
  blues; chromatic. Eight levels: C, G and F major and A minor; the keys up to two sharps or flats
  with their harmonic minors; all twelve majors; all twelve minors in their three forms; the same
  in two octaves; hands together; modes, pentatonics and blues; chromatic and contrary motion. Each
  level keeps what the ones below it have, and a level only sets the hands and octaves it starts
  with.
- **Spelling** (Q2): every scale is written with a key signature of at most six sharps or flats,
  one spelling a tonic: F♯ major, E♭ minor (not D♯), D♭ major, C♯ minor. The minors take their
  relative major's signature, the modes their parent major's (D dorian, no sharps), the pentatonics
  their major or minor key, blues its minor key; a mode whose tonic would be E♯, B♯, C♭ or F♭ takes
  the other six-accidental parent (F locrian, not E♯ locrian). G♯ harmonic and melodic minor keep
  the double sharp (F𝄪) as scale books print it. Blues writes its blue note as the flattened fifth,
  or as the raised fourth where the fifth would need a double flat (E♭ blues: A, not B𝄫). The
  chromatic scale is written in C with sharps going up and flats coming down.
- **Melodic minor** (Q3): the classical form, raised going up and natural coming down. It is left
  out of contrary motion, where its two forms would sound against each other.
- **Fingering** (Q5, `scale-fingering.ts`): written into the MusicXML as `<fingering>`, not
  suggested, because the suggested fingering puts thumbs on black keys in most keys. The fingers
  come from the rules scale books follow, in code, not from a book's table: groups of three and
  four fingers, no thumb on a black key, a white tonic under the thumb, otherwise the thumb on the
  white key just after a black one in the direction it passes under, and the next finger instead
  of the thumb at the top of the right hand and the bottom of the left (5 or 4); a right hand that
  would start on 4 starts on 2 (B♭ major). These rules give the standard fingering of every major
  and harmonic minor in both hands, which the tests hold; where books differ the rules pick one
  (G♯ harmonic minor, left hand 3 2 1 4 3 2 1 3). The chromatic scale takes 3 on black keys, 1 on
  white and 2 where two white keys meet. Pentatonics and blues have no single standard and get no
  fingers.
- **Placement:** each hand's run sits nearest the middle of its staff (the right hand from G3 up),
  so two-octave runs keep few ledger lines; together, the left hand plays an octave or two below
  the right; contrary motion starts both hands on the tonic nearest middle C.
- **The score:** each scale starts a bar, with its key signature when it changes, its name in
  words above it (as chord names are, ADR 0022), its fingers, a double bar at its end and rests to
  fill the bar. Accidentals are written where a note differs from the key signature or from an
  accidental earlier in its bar, and as a courtesy after the bar before altered the same note.
  Crotchets, or quavers beamed in pairs (Q6).
- **Displays** (Q4): sheet, name only (the name and the key signature, the notes and their fingers
  hidden until played, as scales are asked for in lessons) and falling keys with the fingers on the
  bars. Sheet is the default at level 1, name only from level 2.
- **Judging** (`scale-tally.ts`, a layer above wait mode and play-along that pieces never use): a
  scale is right at the first try with no wrong key from its first note to its last, and at a tempo
  every note played and both hands within 120 ms. A wrong key has a cause: the key's sharp or flat
  (`key`), a minor's sixth or seventh (`form`), a later note (`skip`), or another key. **Evenness**
  is the spread of the gaps between notes as a share of their median, in wait mode too (the
  learner's own pulse); the result card says it in words, very even, even or uneven, and where it
  was least even: the thumb passing, the turn at the top or elsewhere (Q9).
- **Progress** (Q7): a `scaleStats` setting like `chordStats`: per round the time, the scales, the
  first tries, notes a minute and evenness, and per scale the attempts, first tries and main cause,
  for the last 200 rounds. In the encrypted backup (it is not a `device.` or `sync.` key) and
  nowhere else. "Practise my weak scales" draws those three times as often. The tempo ladder of
  the chord drills, off by default, works here too, 40 to 160 crotchets a minute.
- **Names** (Q10): the tonic follows the note-name setting and the words the interface language;
  in German a key is named as German books do ("Es-Dur", "b-Moll harmonisch", the tonic in lower
  case for a minor key when it is a German letter).
- **Microphone** (P7-22): until hands together are measured, a scale drill with both hands and the
  microphone says that a MIDI keyboard or the on-screen keys work best, as four-note chords do.

## Consequences

- No new screen: the practice screen's drill branch gains a scale case beside the chord case, and
  the session a scale judging layer beside the chord one.
- Drills no longer always hide fingering: a scale drill shows the fingers it writes.
- Generated scores are longer than chord rounds (a two-octave scale is eight bars); a round is four
  scales by default.
- Fingering is shown, not judged: no input says which finger played a note. Evenness around the
  thumb is the nearest measure.
- The rules may meet a fingering a teacher would not choose (modes, melodic minors); a later table
  of exceptions can override the rules for a scale without changing the rest.

## Alternatives considered

- **The suggested fingering (fingering.ts):** wrong for most keys (thumbs on B♭, E♭, F♯ and so on).
  Rejected after trying it.
- **A table of fingerings copied from a scale book:** facts, but a book's tables are its own
  selection; rules in code avoid the question and cover every kind. The tests hold the standard
  table to keep the rules honest.
- **No key signatures, every accidental written (as chord drills do):** chords jump between keys
  every bar; a scale stays in one key for several bars, and reading the key signature is part of
  the skill.
- **Hands together a fixed octave apart:** keeps the left hand's two-octave runs high above the
  bass staff; an octave or two, by the staff, reads better.
- **Melodic minor in contrary motion with both hands in the right hand's form:** not what any book
  asks for; left out instead.
