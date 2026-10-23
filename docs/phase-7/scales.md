# Phase 7 — Scale drills

- **Status:** planned on 2026-10-23 (P7-14); the maintainer handed the questions in section 7 over
  the same day, so the recommendations stand and [ADR 0024](../adr/0024-scale-drills.md) records
  them. The tasks are P7-15 to P7-24 in
  [PLAN.md](../../PLAN.md#phase-7--chord-drills-planned-2026-10-22), built on the chord drills'
  pieces ([chord-drills.md](chord-drills.md), ADR 0022).
- **Where it came from:** [issue #47](https://github.com/KunalGehlot/OpenTiles/issues/47), "New
  section scale/chords training". The chord drills answered half of it; the maintainer's reply on
  2026-10-23, when they went live, says "Scales are next, built on the same pieces". The issue is
  closed; this plan does not reopen it.
- **Read first:** [chord-drills.md](chord-drills.md) and [ADR 0022](../adr/0022-chord-drills.md)
  (the pieces this reuses), [ADR 0015](../adr/0015-sight-reading-drills.md) (generated MusicXML),
  [PLAN.md](../../PLAN.md) and [architecture.md](../architecture.md).

## 1. What was asked

1. **From the issue:** practise scales and chords so that a learner can spot the same patterns in
   any song, with falling bars over a keyboard "for visual learners".
2. **From the chord drills (Q4, 2026-10-22):** scales come after chords, on the same pieces: the
   Drills hub, the seeded generator, the two displays (sheet and falling keys), wait or tempo, a
   result worth reading and progress kept on the device.

What a scale drill adds to a chord drill is **order, fingering and evenness**: the notes come one
after another in a fixed order, the fingers that play them are the point of practising them, and a
good scale is an even one.

## 2. Facts that shape the plan

Checked on the branch `P5-19-loose-ends` at `068be86` (the drill code is the same as on
`main` at `89d5b89`; the line numbers are this branch's), with throwaway tests and Verovio 6.3 in Node:

- **The app's suggested fingering is wrong for most scales.** `suggestFingering`
  (`packages/practice/src/fingering.ts`) was run on two-octave scales in all twelve major keys,
  hands together. The right hand is right in C, G, D, A, E and B major (1 2 3 1 2 3 4 …) but puts
  the thumb on a black key in B♭, D♭, E♭, A♭ and F♯ major (B♭: 1 2 1 2 3 …, against 4 1 2 3 1 2 3
  4), and in F major ends 1 2 3 4 5 where the standard is 1 2 3 4 1 2 3 4. The left hand is right in
  E major only (C: 5 4 3 2 1 2 1 3 …, against 5 4 3 2 1 3 2 1). The Viterbi search judges each
  step by its cost and knows nothing about the 3 + 4 finger groups that scales are built from.
  **Scales need their fingering written in, not suggested** (P7-16).
- **Written fingering goes through as it is.** `parseMusicXml` reads `<technical><fingering>` into
  `SongNote.fingering` (`packages/song-model/src/musicxml.ts:217`), `prepareSong` keeps it with the
  `written` choice (`apps/web/src/practice/prepare.ts`), the falling view draws finger numbers on
  the bars and keys (`views/renderer.ts`, P4-08), and Verovio draws all four marks in a test bar.
  Today drills force fingering off (`routes/Practice.tsx:374`, `drill ? 'off' : …`); a scale drill
  needs its own case there.
- **Key signatures work up to seven.** Verovio draws seven sharps and seven flats, and
  `parseMusicXml` reads F♯ (66) and C♭ (59) right from `<alter>`. Verovio draws an accidental only
  from `<accidental>`, never from `<alter>` alone (ADR 0022 found the same), so a scale with a key
  signature writes `<accidental>` only on notes outside it: the raised sixth and seventh of the
  minors, the blue note, a natural that cancels. The sight-reading drills offer −3 to 3; their
  `keyAccidental` and `stepPitch` already work to ±7.
- **Hands together already pairs the notes.** `buildSteps` puts a left-hand note and a right-hand
  note that start together into one step, so a two-octave scale with both hands is 29 steps of two
  pitches. Wait mode waits for both, in either order; play-along judges each note on its own, and
  the chord layer of P7-03 (`judgeTogether`, a spread of 120 ms) can judge each pair as "together".
  A **contrary-motion** scale starts and ends with both thumbs on one key: `buildSteps` keeps one
  pitch in the step, which is right, since a keyboard sends it once.
- **The microphone has not been measured on octaves.** Hands together in parallel motion play
  octaves (or two octaves) apart, and the lower note's second harmonic is the upper note. The
  score-informed detector expects both, so a missing upper note may be heard as present. Contrary
  motion plays thirds, sixths and tenths. Neither is in the synthetic harness
  (`packages/engine/tests/synthetic_accuracy.rs`) yet (P7-22).
- **Routing.** `Practice.tsx:213` loads a chord drill when the id starts with `chords` and reads any
  other drill id as sight-reading (ADR 0022). A `scales.` id must be caught before that fallback.
  `DrillPage` (`lib/router.ts:26`) is `'sight-reading' | 'chords'`; the hub (`routes/Drills.tsx`)
  has two cards.
- **Length.** A two-octave scale up and down is 29 notes, 7¼ bars of crotchets. A round of four
  scales is about 30 bars, against 16 bars of whole-note chords in a chord round. Readable at ⅓ of
  an iPad is a check for P7-20, at 320 px with Verdana (Linux CI fonts are wider).

## 3. What gets built, in short

A third card, **Scales**, on the Drills page.

- **Random scales from a set the learner chooses**, as chords are: a level or a custom set of kinds
  (major, the three minors, and later modes, pentatonics, blues, chromatic) and keys. A round is a
  few scales (four by default), each one in its key with its name above it and its fingering
  written in, one or two octaves, up and down. Seeded, so a link plays the same round again.
- **Three displays, as chords have.**
  - **Sheet:** the scale written out with its key signature and fingers, no falling notes.
  - **Name only:** the name and the key signature, the notes hidden until played. This is how
    scales are asked for in lessons and exams: from memory. Recommended as the default once a
    learner is past level 1 (Q4).
  - **Falling keys:** the bars with finger numbers on them, the keys lit (all, the tonic only, or
    none, as the chord hints are).
- **Hands:** right, left, together in parallel motion an octave apart, and later contrary motion.
- **Speeds:** wait, or a tempo (crotchets or quavers) with the count-in, as chords have.
- **A result worth reading:** scales right at the first try, wrong notes and where (which degree,
  going up or coming down), the usual causes (the key's sharp or flat forgotten, the wrong form of
  minor), and **evenness**: how steady the notes were, in wait mode too. Kept on the device, so
  "Practise my weak scales" can bring them back.

Everything is generated in code and judged in the browser, so hard rules 2, 3 and 4 hold by
construction (section 10).

## 4. Order and parallel lanes

| Lane              | Tasks               | Notes                                                                  |
| ----------------- | ------------------- | ---------------------------------------------------------------------- |
| A — Pure packages | P7-15, P7-16, P7-17 | `packages/practice` only; P7-16 needs P7-15; P7-17 needs both          |
| B — Judging       | P7-18               | Parallel with P7-17 once P7-15 is in                                   |
| C — Web app       | P7-19, P7-20        | Setup page, then the practice screen: sheet first (the first playable) |
| D — Progress      | P7-21               | After P7-18 and P7-20                                                  |
| E — Microphone    | P7-22               | Any time; independent of B to D                                        |
| Last              | P7-23, P7-24        | Docs, German strings and the release, then the maintainer's checks     |

The first playable is P7-20 on the sheet: a round of major scales, one octave, one hand, in wait
mode, with a MIDI keyboard or the on-screen keys. Everything after that adds a display, a hand, a
speed or a measurement.

## 5. Tasks

Sizes: S under a day, M a day or two, L several days.

### P7-14 (GOV) This plan, the maintainer's answers and the ADR

Done: this file and the tasks in PLAN.md. Left: the answers to section 7, then **ADR 0024 "Scale
drills"** (copy `docs/adr/0000-template.md`) with the decisions, and this file's status line. A new
ADR rather than an edit of 0022, because 0022 is proposed and about chords; 0024 points to it for
the shared pieces. Size: S.

### P7-15 (PRAC) Scale vocabulary

**Why.** One agreed meaning of "a scale": its notes, their spelling and the key signature it is
written with.

**Build.** `packages/practice/src/scales.ts`, pure, beside `chords.ts` and reusing its `PitchName`,
`SpelledPitch` and `Letter`:

- `ScaleKind`: `major`, `natural-minor`, `harmonic-minor`, `melodic-minor` first; then `dorian`,
  `phrygian`, `lydian`, `mixolydian`, `locrian`, `major-pentatonic`, `minor-pentatonic`, `blues`
  and `chromatic` (which of these, Q1). Each kind has its steps in semitones **and letters**, so
  spelling is right (E♭ major is E♭ F G A♭ B♭ C D, never D♯ …), and melodic minor has a different
  way down (Q3).
- `Scale { tonic: PitchName, kind }`, `tonicFor(pitchClass, kind)` picking the spelling with the
  fewer sharps or flats (D♭ major, C♯ minor), ties to the common one, never more than six (F♯ major
  and E♭ minor are the six; G♭ major and D♯ minor only if Q2 says so). Same rule as
  `rootFor` for chords.
- `keySignatureOf(scale)`: the `fifths` the scale is written with. Majors and minors take their own
  key; modes take their parent major's (D dorian with no sharps) or the tonic's (Q2); pentatonics
  take the major or minor key; blues takes the minor key with its ♭5 as an accidental; chromatic is
  written in C with sharps going up and flats coming down.
- `scaleNotes(scale, { octaves, start })`: the spelled notes up and down, with which notes need an
  `<accidental>` against the key signature.

**Tests.** Every kind on all twelve tonics: the right intervals, seven letters once each (five or
six for pentatonic and blues), no double sharps or flats in a scale the levels offer, the key
signature right, apart from the one double sharp the note below names; melodic minor down equals
natural minor down (if Q3 picks the classical form).
**Watch.** Harmonic minor in G♯ minor needs F𝄪 (G♯ A♯ B C♯ D♯ E F𝄪): either spell the key as A♭
minor (seven flats) or allow the double sharp. Chords chose to respell; a scale written with a key
signature cannot respell one note without breaking the pattern of letters. The recommendation is
to keep G♯ minor and write F𝄪, as scale books do (Q2). Size: M.

### P7-16 (PRAC) Scale fingering

**Why.** The fingering is what a learner practises a scale for, and the suggested fingering is
wrong for most keys (section 2).

**Build.** `packages/practice/src/scale-fingering.ts`. Not a table copied from a book: the fingers
are worked out from the rules every scale book follows, so they are facts in code (hard rule 4).
For the seven-note kinds, each hand plays groups of three and four fingers (1 2 3, 1 2 3 4); the
thumb never takes a black key; the thumb comes on the first white key after a black one where it
can; the fourth finger falls once an octave. Those rules give most of the fingerings scale books
print, and a short list of named exceptions covers the rest, the test table deciding: the right hand 4
on B♭ in the flat keys, the left hand 4 on the second degree in G, D, A and E major, and the
left hand's 4 3 2 1 4 3 2 1 from the tonic in B major. Where common practice has two
fingerings (F♯ major in the left hand, the minors where the raised sixth or seventh is black), the
code chooses one and the comment names the other. Pentatonics and blues have no single standard;
offer them without fingering at first, or with the rule's best guess marked as suggested (Q5).
Chromatic: 1 and 3, with 2 on F and C (right hand going up), the usual form.

Write the fingers into the MusicXML as `<technical><fingering>` (P7-17), so the score, the falling
bars and the keys show the same fingers.

**Tests.** A table of known fingerings for all twelve majors and the harmonic minors, both hands,
one and two octaves (the top note is played once, at the turn: 5 in the right hand, 1 in the left); the thumb
never on a black key; the same fingers up and down. **Watch.** Two octaves are not one octave twice:
the joint in the middle gets the thumb, not 5 (right hand going up). Size: M.

### P7-17 (PRAC) The scale drill generator

**Why.** Seeded, repeatable, drawn from the same text it is judged on (ADR 0015).

**Build.** `packages/practice/src/scale-drills.ts`, beside `chord-drills.ts`, reusing
`seededRandom` and the drawing rules of `drawEntries` (each scale of the set once before any comes
again, never the same scale twice running):

- `ScaleDrillOptions`: `level` or `custom` (kinds and tonics), `hands` (`right`, `left`,
  `together`, later `contrary`), `octaves` (1 or 2), `rhythm` (`crotchets`, `quavers`, Q6),
  `count` (scales in a round, default 4), `tempo` (in crotchet beats, 40 to 160), `focus` (weak
  scales, P7-21), `seed`. `normaliseScaleDrillOptions` clamps anything.
- `generateScaleDrill(options, name?)` returns `{ options, scales, musicxml }`. Each scale starts a
  new bar with its key signature (a key change in the middle of the round is normal MusicXML; Verovio
  draws the new signature without cancelling naturals, checked from four sharps to three flats, as
  much modern engraving does, so whether to add `<cancel>` is a check for this task), its name above as `<direction><words>` in the
  learner's label style (as chord names are, ADR 0022), the fingering on every note, and a
  double bar and a crotchet rest at its end, so the tonic at the top and the next scale's start do
  not run together. The last bar is filled with rests.
- Placement: the right hand from the tonic nearest C4, the left hand an octave lower (from the
  tonic nearest C3), so hands together are an octave apart; both inside C2 to C7. Two staves for
  hands together.
- `scaleDrillId` and `parseScaleDrillId`: `scales.l2.hr.o1.rq.n4.t80.s12345`, fields of a letter
  and a value as chord ids are; a custom set writes kinds and tonics as bit masks. `isScaleDrillId`
  is `id === 'scales' || id.startsWith('scales.')`.

**Tests.** Same options and seed, same MusicXML; every level uses only its scales; the round trip
through `parseMusicXml` gives the scale's pitches in order, one step a note (two with both hands);
fingers on every note match P7-16; accidentals drawn exactly where the key signature does not cover
a note; ids round-trip; old sight-reading and chord ids are unaffected. Size: M.

### P7-18 (PRAC) Judging a scale

**Why.** Chords are judged a chord at a time; a scale is judged as a run, and order and steadiness
matter.

**Build.** `packages/practice/src/scale-tally.ts`, a layer above wait mode and play-along as
`ChordTally` is (pieces never use it):

- Per scale: right at the first try (no wrong key from its first note to its last), the wrong
  notes with where they came (degree, going up or coming down), and a **cause** for each:
  `key` (the natural played for the key's sharp or flat, or the other way round), `form` (a minor's
  sixth or seventh raised where it should not be, or not raised: natural for harmonic, the classical
  melodic minor's way down), `skip` (a later note of the scale played early), `other`.
- **Evenness:** the spread of the times between notes, as a share of their median (in wait mode the
  learner's own pulse; at a tempo the offsets play-along already measures). Shown as words on the
  result card ("very even", "even", "uneven around the thumb") rather than a number, and the place
  where it was least even: in a scale that is nearly always where the thumb passes under.
- Hands together: each pair judged with `judgeTogether` (the chord spread of P7-03), so "hands not
  together" is a result of its own.
- Per scale kind and tonic, the counts P7-21 needs.

**Tests.** Table-driven outcomes for each cause; evenness on recorded event lists (even, rushed at
the thumb, slowing at the top); hands together within and outside the spread; wait mode's own
suite unchanged. Size: M.

### P7-19 (APP) The Scales setup page

**Build.**

- A third card on the hub, `#/drills/scales`; `DrillPage` gains `'scales'`.
- The page, built like `ChordDrills.tsx`: **Level** with one line each, a **custom set** (kinds as
  checkboxes, the twelve tonics as buttons), **Hands**, **Octaves**, **Show** (Sheet, Name only,
  Falling keys), **Pace** (Wait for me, Tempo with crotchets or quavers), **Scales per round**
  (2, 4, 8), "Practise my weak scales". Remembered in a `scaleDrillPrefs` setting.
- `practice/scale-drill.ts` beside `practice/chord-drill.ts`: preferences, `scaleDrillRoute`,
  `loadScaleDrill` returning `{ song, musicxml, scales, names, title }`.
- Scale names: `scaleName(scale, style, language)` in `lib/notes.ts`. Two settings meet here, which
  chord names never needed: the **tonic** follows the note-name style (letters, German, fixed-do)
  and the **words** follow the interface language. English: "B♭ harmonic minor", "Si♭ harmonic
  minor". German: the key as German books write it, "b-Moll harmonisch" and "H-Dur", the tonic in
  lower case for a minor key only when the tonic is a German letter (a key name, not a chord
  symbol, so the chord drills' Q9 does not apply); "Si♭-Moll harmonisch" with fixed-do;
  "B♭-Moll harmonisch" with letters. Q10 asks whether that mix is right. German strings for every
  label, keyed by the English text (ADR 0014).

**Tests.** Component tests for the page; `scaleName` in all three styles over the twelve tonics;
the hub's old links still work. Size: M.

### P7-20 (APP) The practice screen: sheet, name only, falling keys

**Build.** In `Practice.tsx`'s drill branch, a `kind: 'scales'` beside `'chords'`:

- `isScaleDrillId` checked before the sight-reading fallback; title and subtitle "Scales".
- Fingering: `written` for a scale drill (today `drill ? 'off'`), with the Options choice to hide
  it ("Show fingers", on by default).
- **Sheet:** the page view, `guide: 'none'` (or `'keys'`), wait mode or tempo.
- **Name only:** the notes of the scales still to come hidden with the same CSS class chord drills
  use, the key signature and the name left in sight; each note appears once it is played, "Show me"
  shows the scale and counts it as a miss. **Watch:** Verovio draws fingering marks as `<g
class="fing">` outside the note groups (checked), so the chord drills' class does not hide them,
  and their places give the notes away. Hide the coming fingers too, unless Q4 keeps them as a
  memory aid.
- **Falling keys:** `guide: 'full'`, the hint (all keys, the tonic, none) through `keyHint`, the
  scale's name drawn on the canvas over its first bar (the `chordLabels` path, renamed or reused).
- The readout: notes a minute and the share of scales right at the first try; the result card
  from P7-21.

**Done when.** A learner can play a round of four major scales, one octave, right hand, from the
sheet and from memory, on a fake MIDI keyboard and on the on-screen keys, and see the result.
Playwright covers level 1 in each display and hands together (`scale-drills.spec.ts`), and the
sight-reading and chord e2e still pass. **Watch.** ⅓ of an iPad at 320 px with Verdana: a key
signature of six and the finger numbers make the bars wide; two bars a system is fine, overlapping
fingers are not. Size: M to L.

### P7-21 (STORE, APP) Scale progress and weak scales

**Build.** A `scaleStats` setting like `chordStats` (P7-08): per finished round the time, the
scales, first tries, notes a minute and evenness, and per scale (`pitchClass.kind`) the attempts,
first tries, main cause and evenness, for the last 200 rounds. Never a title; nothing else. In the
encrypted backup like `chordStats` if Q7 says so (it is not a `device.` or `sync.` key, so it is in
by default). The result card shows this round against the last five and the scale that was least
even; "Practise my weak scales" weights the draw, never starving a scale. The tempo ladder of
chord drills (off by default) applies here too.

**Tests.** As P7-08: the update and the cap, the weighting, a backup round trip. Size: S to M,
since `chord-stats.ts` is the model.

### P7-22 (ENG) Hands together on the microphone

**Build.** Add scale runs in octaves (and two octaves) and in contrary motion to the synthetic
harness, in wait mode and play-along, with and without pedal, and report the numbers against the
targets (95 % accepted, at most 3 % wrong accepted). Until they meet them, a scale drill with both
hands and the microphone shows the hint "Hands together work best with a MIDI keyboard or the
on-screen keys", as four-note chords do (P7-10). Never loosen a threshold to pass. Real recordings
join the Phase 0 set (P0-04, G0). Size: M.

### P7-23 (GOV) Docs, German strings and the release

User guide: a "Scale drills" section (levels, the three displays, fingering, evenness, weak
scales); the README feature list; the About page if it lists drills; German strings reviewed with
the existing read-through (P2-14). Bump the minor version and ask before pushing the tag. Size: S.

### P7-24 (human) The maintainer's checks

On the maintainer's own Chrome in dark mode, with a real MIDI keyboard through `midi-test/`, and on
an iPad (added to the [iPad device checklist](../../PLAN.md#ipad-device-checklist), which never
blocks merging): each display, each level, hands together, the fingering against what they would
teach, the German names. Size: S.

## 6. Sketch of the setup page (proposal for P7-19)

```
Drills
  [ Sight-reading ]  [ Chords ]  [ Scales ]

Scales
  Level        [ 2 · Majors up to two sharps or flats ▾ ]   or  Custom set…
  Hands        ( ) Right  ( ) Left  ( ) Together
  Octaves      ( ) One  ( ) Two
  Show         ( ) Sheet   ( ) Name only   ( ) Falling keys
  Pace         ( ) Wait for me   ( ) Tempo [ 80 ] beats a minute   ( ) Crotchets ( ) Quavers
  Scales       [ 4 ▾ ]   2 · 4 · 8
  [ ] Practise my weak scales

  [ ▶ Start ]
```

Result card: scales right at the first try, notes a minute, evenness in words, the scale with the
most wrong notes and why ("E♭ major: A natural for A♭, twice"), and "Again" and "Next level".

A level ladder to start from (Q1; tune after playing it):

| Level | Scales                                                   | Octaves | Hands    |
| ----- | -------------------------------------------------------- | ------- | -------- |
| 1     | C, G, F major; A minor (natural)                         | One     | One      |
| 2     | Majors up to two sharps or flats; their minors, harmonic | One     | One      |
| 3     | All twelve majors                                        | One     | One      |
| 4     | All twelve minors, harmonic and melodic                  | One     | One      |
| 5     | Everything above                                         | Two     | One      |
| 6     | Everything above                                         | Two     | Together |
| 7     | Modes, pentatonics and blues (if Q1 keeps them)          | Two     | One      |
| 8     | Chromatic and contrary motion (if Q1 keeps them)         | Two     | Together |

"One" is the right hand unless the learner picks the left. As with chords, the Hands and Octaves
selectors override a level's default.

## 7. Questions for the maintainer, decided 2026-10-23

Each had a recommendation. The maintainer, who has little music theory, handed the decisions over
("go ahead with best of your knowledge"), so every recommendation was taken; ADR 0024 records
them.

| #   | Question                                                                                                                                                                                                                                   | Recommendation                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Q1  | Which scales: major and the three minors only, or modes, pentatonics, blues and chromatic too?                                                                                                                                             | Major and minors first (levels 1 to 6), the rest as levels 7 and 8 in the same round of work               |
| Q2  | Spelling: the twelve keys with at most six sharps or flats (F♯ major, E♭ minor), or G♭ major and D♯ minor too? G♯ harmonic minor with its F𝄪? Modes with the parent's key signature (D dorian, no sharps) or the tonic's with accidentals? | At most six, one spelling a tonic; G♯ minor with F𝄪 as books print it; modes with the parent's signature   |
| Q3  | Melodic minor: the classical form (raised going up, natural coming down) or the jazz form (raised both ways)?                                                                                                                              | Classical; jazz melodic minor later as its own kind if asked                                               |
| Q4  | Displays: sheet, name only (from memory) and falling keys. Which is the default? In name only, are the coming fingers hidden too?                                                                                                          | Sheet at level 1, name only from level 2, falling keys for whoever picks it; fingers hidden with the notes |
| Q5  | Fingering for pentatonics and blues, which have no single standard: none, or the rule's best guess marked as suggested?                                                                                                                    | None at first; the seven-note scales and chromatic get the standard fingers                                |
| Q6  | Rhythm: crotchets only, or quavers at a tempo too (twice the notes a beat)?                                                                                                                                                                | Both: crotchets by default, quavers as a choice under Pace                                                 |
| Q7  | Keep scale progress like chord progress, and include it in the encrypted backup?                                                                                                                                                           | Yes, as `chordStats` is                                                                                    |
| Q8  | Hands together: parallel motion only, or contrary motion too?                                                                                                                                                                              | Parallel first (level 6); contrary at level 8                                                              |
| Q9  | Evenness on the result card: words ("even", "uneven around the thumb") or a number?                                                                                                                                                        | Words, with the place it was least even; a number would invite chasing it                                  |
| Q10 | Scale names in German: "b-Moll harmonisch", "H-Dur" (the German way), with the tonic in the learner's note-name style ("B♭-Moll", "Si♭-Moll" for letters and fixed-do)?                                                                    | Yes; the words follow the interface language, the tonic the note-name style                                |

## 8. Out of scope, and why

- **Arpeggios and broken chords:** the natural next drill after scales and chords, and the
  generator could make them, but they have their own fingerings and levels; a separate item if the
  maintainer wants it.
- **Scales in thirds, sixths, or with rhythms beyond crotchets and quavers:** exam material for later
  grades; later if learners ask.
- **Watching which finger played a note:** no input tells the app which finger was used (MIDI does
  not, nor does the microphone; touch could guess but would guess wrong). Fingering is shown, not
  judged; evenness around the thumb is the nearest proxy.
- **Exam syllabuses** (ABRSM, Trinity, the German Musikschule lists): their lists and required tempos
  belong to the boards; the levels here are our own.
- **A `Song.scales` field:** as with chords, the drill keeps its own list; the song format stays as it
  is.

## 9. How to check it

- `pnpm check` and the Playwright suite, including the new `scale-drills.spec.ts` for each display
  and hands together, and the old sight-reading and chord drills.
- `cargo test --workspace` for P7-22, with before and after numbers in the PR.
- By hand: the fake MIDI keyboard in `midi-test/`; a real keyboard on Chrome; WebKit for the
  on-screen keys. Look at it in the maintainer's own dark-mode Chrome and at 320 px with Verdana
  before calling the layout done.

## 10. Hard rules, checked

1. **No distribution path.** A drill link holds options and a seed; no music, no title, no export.
   Progress stays on the device and in the encrypted backup.
2. **No imports from other sites.** None.
3. **Nothing leaves the device.** Generation, judging and statistics run in the browser.
4. **No copyrighted music.** Scales are generated; scale names and fingering rules are facts. The
   fingering is worked out by rules in code, not copied from a book's tables. Test fixtures are
   generated.
5. **No tracking.** The statistics are local and are not telemetry.
6. **No paywall, no dark patterns.** The tempo ladder stays off by default and says what it did.
7. **Licences.** No new dependency is planned. If one is needed, name its licence in the PR.
