# 0022 — Chord drills: generated chords on the drill pages, judged a chord at a time

- **Status:** proposed
- **Date:** 2026-10-23
- **Plan task:** P7-00 (decisions for P7-01 to P7-09; the plan is
  [docs/phase-7/chord-drills.md](../phase-7/chord-drills.md))

## Context

Issue #47 asks for chord and scale practice with falling bars over a keyboard; the maintainer asked
on 2026-10-22 for random chords in the drill section, blind on the sheet and with falling keys, at
different difficulties and speeds. The sight-reading drills (ADR 0015) already make seeded MusicXML
that Verovio draws and song-model reads, and open the normal practice screen with less help. Chords
need more than that: a spelling that musicians accept, names in the learner's label style, a result
per chord rather than per note, and progress worth coming back to. The questions of the plan (Q1 to
Q9) were decided on 2026-10-22; this record holds those decisions and the ones the build made.

## Decision

- **Where:** the Drills page becomes a hub with two cards, Sight-reading and Chords (Q1). `#/drills`
  is the hub; `#/drills/sight-reading` and `#/drills/chords` are the setup pages. Old sight-reading
  links (`#/practice/drill/treble.…`) keep working: a drill id that starts with `chords` is a chord
  drill, anything else is read as sight-reading.
- **Vocabulary** (`packages/practice/src/chords.ts`): fourteen qualities (major, minor, diminished,
  augmented, sus2, sus4, maj7, 7, m7, m7♭5, dim7, add9, 6, m6). Every interval has a size in
  semitones and in letter steps. A root is spelled the way that needs the fewest accidentals for
  that quality (D♭ major, C♯ minor, A♭ augmented), ties going to the common spelling (F♯ major,
  E♭ minor); roots are never B♯, E♯, C♭ or F♭. **A note that would need a double accidental is
  written as the natural it sounds as** (C dim7 is C E♭ G♭ A, not B𝄫), as chord books do, rather
  than leaving those roots out of the levels. add9 and the sixth chords come in root position only;
  triads and sevenths come in every inversion. Names are returned as parts (root, suffix, bass) and
  the web app writes them in the learner's label style (Q9): letters (B♭maj7), German (Bmaj7 for
  B♭, Hmaj7 for B) or fixed-do (Si♭ maj7, with a space so "Do m" does not read as a word). Minor
  keeps the `m` suffix in every style. Inversions are
  named as slash chords (C/E).
- **Generator** (`chord-drills.ts`): one chord a bar as a whole note in 4/4 (Q8), C major key
  signature, every accidental written (Verovio does not draw an accidental from `<alter>` alone), and
  a courtesy natural when the same letter was altered in the bar before on that staff. Both hands
  use two staves: the right hand plays the chord; the left hand plays the root (levels 1 to 7), the
  root and fifth (level 8), or the same chord lower (custom set only, Q5). Each kind of chord in the
  set comes once before any comes again; never the same chord twice running; never three of one
  quality running. A set too small for a rule (one chord, one quality) relaxes the rule instead of
  stopping. "Practise my weak chords" puts those chords into the draw three times instead of once,
  so nothing is starved. The voice-leading mode (the inversion nearest the last chord) is off by
  default.
- **Chord names are words, not `<harmony>`.** Tried first: Verovio draws `<harmony>` but writes the
  root's letter from `<root-step>` and ignores both its `text` attribute and `print-object="no"`, so
  German and fixed-do names could not be drawn and a name could not be hidden. Names are a
  `<direction><words>` above the staff in the learner's style, written only when shown.
- **"Name only"** (Q2): the drill's MusicXML is the same; the practice screen hides the notes of the
  chords still to come (and the ledger lines) with a CSS class on the score, and each chord's notes
  appear once it is played. "Show me" shows the chord to come and counts it as a miss. Verovio and
  the parser were checked to keep a note's pitch whatever the drawing does, so the `Song` judged and
  the picture still come from one text (ADR 0015).
- **Ids** are fields of a letter and a value: `chords.l3.hr.n16.t60.s12345` (level 3, right hand,
  16 chords, 60 beats a minute, seed); a custom set writes roots and qualities as bit masks
  (`chords.lc.r161.q3.i0.br…`). New fields can be added without breaking old links. The tempo is in
  the id because it is written into the score.
- **Judging** (`chord-tally.ts`): a layer above wait mode and play-along. A chord is right at the
  first try when every note was played with no wrong key before it was complete; at a tempo, also
  when its notes land within a spread of 120 ms (60 ms with "Strict chords"), scored by the median
  offset. A miss has a cause: a note missing, an extra key, the wrong quality (a key a semitone from
  the third, fifth or seventh) or the wrong inversion (a chord tone in another octave). Pieces never
  use this layer.
- **Hints in falling keys** are a separate session setting, not another `guide` value: `guide` says
  whether falling notes are drawn at all (`full`, `keys`, `none`, ADR 0015); `keyHint` filters
  which of the chord's keys light up (all, the root only, none), so the bars can fall with no key
  lit. The chord's name is drawn on the canvas above its bars (AGENTS.md: timing-critical drawing
  bypasses React).
- **Speeds:** wait (the next chord when the last is right) or tempo (a chord every bar, 40 to 120
  beats a minute in steps of 5, scored by play-along). Tempo drills use the practice screen's 3, 2, 1
  count-in (P6-20) instead of a count-in of their own; wait-mode chord drills start at the first chord
  as sight-reading drills do. The tempo ladder is off by default (Q7) and says what it did on the
  result card.
- **Progress** (Q3): unlike sight-reading drills (ADR 0015), chord drills keep a `chordStats` setting:
  per finished round, the time, the chords, the first tries, chords a minute, and per kind of chord
  (`pitchClass.quality`) the attempts, first tries, seconds and main cause, for the last 200 rounds.
  Never a drill's notes or a title. The point of chord practice is coming back to what was hard, so
  the record is worth its space. It is in the encrypted backup (it is not a `device.` or `sync.`
  setting) and goes nowhere else.
- **Microphone** (Q6): four or more notes at once are allowed with the microphone; when a drill's
  chords sound more than three notes together (counted from the drill, not from the level), the
  practice screen says that MIDI or the on-screen keys work best, until P7-10 has real numbers.

## Consequences

- No new screen: inputs, wait mode, play-along, the score cursor, the count-in and the falling view
  work in chord drills as everywhere; the drill branch of the practice screen grows a few cases.
- Chord names on the score depend on Verovio drawing `<words>`, as it does for tempo and expression marks;
  imported lead sheets with `<harmony>` still draw Verovio's own letter names.
- Respelled double accidentals (C dim7 with A) are what a learner reads on the page; the name above
  says dim7, and the keys are the same. A theory-strict spelling would need a later option.
- The statistics grow with use, but are capped at 200 rounds (a few tens of kilobytes).
- The chord layer adds a second scoring path for the drill readout; the live per-note tally stays,
  so the streak and the counts work as before.

## Alternatives considered

- **A `Song.chordSymbols` field** for the names: would also serve imported lead sheets, but widens
  the one song format for one feature. Left for a later phase; the drill keeps its own chord list.
- **`<harmony>` with Verovio's names:** right for letters, wrong for German and fixed-do, and cannot be
  hidden. Rejected after trying it.
- **Leaving out roots whose chords need double accidentals:** would drop C, F, B♭, E♭ and A♭ from
  dim7 at level 6. Rejected; the enharmonic natural is what most chord books print.
- **Hiding the notes in the MusicXML for "Name only"** (`print-object="no"`): Verovio honours it, but
  the notes could then only appear by drawing the score again after every chord. A CSS class on the
  drawn score does the same with no redraw.
- **Two chords a bar at the fastest speeds:** faster, but halves the reading time and crowds the page
  at ⅓ of an iPad. Kept at one a bar (Q8); revisit if players want more.
- **A count-in of one bar with the metronome for tempo drills,** as the plan first said: the practice
  screen has had its own 3, 2, 1 count-in since P6-20, and two kinds of count-in would confuse.
