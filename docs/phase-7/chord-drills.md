# Phase 7 — Chord drills

- **Status:** planned on 2026-10-22. Nothing is built. The tasks are P7-00 to P7-14 in
  [PLAN.md](../../PLAN.md#phase-7--chord-drills-planned-2026-10-22). Start after the Phase 6
  human checks (P6-13) or in parallel with them: this phase touches the drills, not the Player.
- **Where it came from:** [issue #47](https://github.com/KunalGehlot/OpenTiles/issues/47), "New
  section scale/chords training", from a visual learner. The maintainer answered on 2026-10-22 that
  they will "probably build that into the drill section to practice chords as well".
- **Read first:** the [development guide](../development.md) (hard rules), [PLAN.md](../../PLAN.md),
  [ADR 0015](../adr/0015-sight-reading-drills.md) (the drills this extends) and
  [architecture.md](../architecture.md). Each task below says why it exists, what the code does
  today, what to build, when it is done and what to watch out for.

## 1. What was asked

1. **From the issue:** practise scales and chords (major, minor, diminished, augmented and so on) so
   that a learner can spot the same patterns in any song. Falling bars above a piano keyboard, as
   in the two screenshots the author linked, "would help a lot for visual learners".
2. **From the maintainer (2026-10-22):** a feature in the drill mode that gives **chords at random**
   to press and practise, in two displays: **blind, with the sheet notes**, and **with the falling
   keys**, each at **different difficulties and speeds**.

Scales are in the issue's title but not in the maintainer's description. This plan does chords and
leaves scales as P7-14, built on the same pieces (see Q4).

## 2. Facts that shape the plan

What the code does today, checked on `main` at `d5d35c5`:

- **Drills are generated MusicXML.** `packages/practice/src/drills.ts` makes a drill from options and
  a seed (mulberry32). The MusicXML is drawn by Verovio and read by `parseMusicXml` into the `Song`
  the session judges, so the picture and the notes cannot disagree (ADR 0015). The id is a link:
  `#/practice/drill/treble.0.1.notes.8.12345`.
- **The drill is the normal practice screen with less help.** `PracticeSession.guide` is `full`
  (falling notes, lit keys, names), `keys` (the key to press lights up) or `none` (the drill
  default). `routes/Practice.tsx` sets wait mode, both hands and the page view for a drill, and
  hides the overview, fingering and transpose control.
- **Chords already work as steps.** `buildSteps` groups notes starting within 0.001 beat into one
  `Step` with `pitches`. `WaitMode` waits until every pitch of the step has been played, in any
  order; a wrong key is counted and shown but does not block. `PlayAlongScorer` judges each note on
  its own against ±75 ms (hit) and ±150 ms (early or late), widened at slower tempos.
- **Speed already has two controls.** Wait mode paces itself; play-along runs at the practice tempo,
  a factor of 0.25 to 1.5 of the written tempo (`practice/prefs.ts`). The falling view shows
  `lookahead` beats (6 by default, `views/renderer.ts`), so the fall speed is the tempo times the
  lookahead. A drill's MusicXML carries a tempo of 60.
- **Scoring is per note.** `LiveTally` (P5-07) counts perfect (right at the first try), good,
  missed and wrong notes; the drill's readout is right notes a minute. There is no per-chord result
  (was the whole chord right at the first try, how long did it take, which note was missing).
- **No chord names anywhere.** The `Song` has no chord symbols, and `lib/notes.ts` names single
  pitch classes only. It does know the three label styles the learner can choose (letters,
  German, fixed-do), which chord names must follow.
- **Microphone limits.** The detector is score-informed and its targets are set for single notes and 2 to 3
  note chords (95 % of correct notes accepted, at most 3 % of wrong notes accepted; spec, "Accuracy
  targets and test set"). The numbers so far come from a synthesiser; the gate on real recordings
  (G0) is still open. Four
  notes (seventh chords) and more are "best effort". A chord drill above triads should therefore
  say "use MIDI or touch" until P7-10 has measured it.
- **On-screen keyboard.** Touch input exists (`input/touch-input.ts`). Whether several fingers can
  press a chord at once, and how that behaves at ⅓ of an iPad, is not covered by a test (P7-11).

## 3. What gets built, in short

A second kind of drill, **Chords**, next to Sight-reading on the Drills page.

- **Random chords from a set the learner chooses.** A chord is a root and a quality (major, minor,
  diminished, augmented, suspended, sevenths) in an inversion, in a hand or both hands. Eight
  difficulty levels climb from "C, F, G major and A, D, E minor in root position" to sevenths, inversions and
  both hands, and a custom set lets the learner pick the roots and qualities. Chords are drawn by a
  seeded generator, so a link replays the same drill, as for sight-reading.
- **Two displays, as the maintainer asked.**
  - **Sheet (blind):** the practice screen's page view, no falling notes, no lit keys. The score
    shows the chord, with or without its name above it, so the learner reads the notes, or reads the
    name and finds the notes. The third option, **name only**, hides the notes and tests recall
    (see Q2).
  - **Falling keys:** the falling-notes view over the keyboard, with each chord's name on its bars,
    the keys lit as hints, and a hint that fades with the level (all keys, then only the root, then
    none).
- **Speeds.** **Wait** (the next chord comes when the last one is right; the readout is chords a
  minute) or **Tempo** (a chord every bar at 40 to 120 beats a minute, with a count-in, scored by
  play-along). Falling speed follows the tempo. An optional ladder raises the tempo after a few
  clean rounds.
- **A result worth reading.** Chords right at the first try, time to complete a chord, the chords
  that went wrong most often and what was wrong (a missing note, an extra note, major played for
  minor). Kept on the device so "weak chords" can be drilled next.

Everything is generated in code and judged in the browser, so hard rules 2, 3 and 4 hold by
construction (section 10).

## 4. Order and parallel lanes

| Lane              | Tasks                      | Notes                                                           |
| ----------------- | -------------------------- | --------------------------------------------------------------- |
| A — Pure packages | P7-01, P7-02, P7-03        | `packages/practice` only; no DOM. P7-02 and P7-03 are parallel. |
| B — Web app       | P7-04, P7-05, P7-06, P7-07 | Setup page, sheet mode first (the first playable), then falling |
| C — Progress      | P7-08                      | After P7-03 and P7-05                                           |
| D — Input checks  | P7-10, P7-11               | Any time after P7-02; independent of B                          |
| Last              | P7-09, P7-12, P7-13        | Levels and pace wired together, docs, then the human check      |

The first playable is P7-05: a chord drill in wait mode on the sheet, with MIDI and the on-screen
keyboard. Everything after that adds a display, a speed or a measurement.

## 5. Tasks

Sizes: S under a day, M a day or two, L several days.

### P7-00 (GOV) This plan, ADR 0022, and the maintainer's answers

Done on branch `P7-00-chord-drills-plan`: this file and the Phase 7 section in PLAN.md. Left: the
maintainer's answers to section 7, then **ADR 0022 "Chord drills"** (copy
`docs/adr/0000-template.md`) recording the choices in tasks P7-01 to P7-09. Size: S.

### P7-01 (PRAC) Chord vocabulary

**Why.** Everything else needs one agreed meaning of "a chord".

**Build.** `packages/practice/src/chords.ts`, pure like the rest of the package:

- `ChordQuality`: `maj`, `min`, `dim`, `aug`, `sus2`, `sus4`, `maj7`, `dom7`, `min7`, `m7b5`, `dim7`,
  later `add9`, `six`, `mMaj7`. Each has its intervals above the root in semitones **and in letter
  steps**, so spelling is right: E♭ major is E♭ G B♭, never D♯ G A♯.
- `Chord { root: { letter, alter }, quality, inversion }` and `chordNotes(chord, octave)` giving
  spelled pitches (`{ step, alter, octave, midi }`), for any of the twelve roots, with the sharp or
  flat spelling that musicians use (D♭ not C♯ for a major chord; F♯ and G♭ both allowed, chosen by
  the key a learner picks or by fewer accidentals).
- `chordSymbol(chord)` returning **parts** (root letter, accidental, quality suffix, bass note for
  inversions written as slash chords if wanted), not a string. The web app turns the parts into
  text in the learner's label style (P7-04). German writes B for B♭ and H for B; fixed-do writes Do,
  Re, Mi. A pure package must not know about the language.
- `invert(notes, n)` and `voicing(chord, range)` which place the chord inside a range and say which
  inversion that is.

**Tests.** Every quality on all twelve roots gives the right intervals and spellings; inversions keep
the pitch classes; `chordNotes` agrees with `stepPitch` in `drills.ts` for a handful of cases;
no double flats or sharps in any chord the generator offers (G♯ augmented would need a double sharp,
so it is offered as A♭ augmented, A♭ C E).

**Watch.** Diminished sevenths and augmented chords produce double accidentals on some roots. Prefer
the root with fewer accidentals and list the roots excluded in the code comment. Size: M.

### P7-02 (PRAC) The chord drill generator

**Why.** The drill must be seeded, repeatable and drawn from the same text it is judged on.

**Build.** `packages/practice/src/chord-drills.ts`, beside `drills.ts`, reusing `seededRandom`:

- `ChordDrillOptions`: `level` 1 to 8 or `custom` (roots, qualities, inversions), `hands`
  (`right`, `left`, `both`), `count` (default 16 chords), `display` is a web concern and is not here,
  `seed`. `normaliseChordDrillOptions` clamps anything, as `normaliseDrillOptions` does.
- `generateChordDrill(options)` returns `{ options, chords, musicxml }`. One chord per bar of 4/4 as a
  whole note, so there is one accidental context per chord and the page stays readable. Two staves
  for "both hands": the right hand plays the chord; the left hand plays the root, the root and fifth,
  or the same chord an octave lower, by level. Accidentals are written explicitly, with a C major key
  signature, because chord roots jump around.
- A `<harmony>` element per chord (root, kind, bass) so Verovio draws the chord symbol above the
  staff when the learner wants it, and so the file is a normal lead sheet. Whether Verovio's
  MusicXML import draws `<harmony>` and honours `print-object="no"` on pitched notes (needed for
  "name only") must be tried first; the existing drills use `print-object="no"` on rests only. If it
  does not, draw the name with a `<direction><words>` instead, and hide notes by leaving them out of
  the picture and keeping them in the `Song`.
- Rules for "random": no chord twice in a row; no more than two of the same quality in a row; each
  chord of the set appears before any repeats, so a short drill covers the set; at levels 4 and up
  a mode that keeps hands near (the next chord is the inversion nearest the last) is a separate
  option, off by default, because it teaches voice leading, not recognition.
- `chordDrillId` and `parseChordDrillId`: `chords.<level>.<hands>.<count>.<seed>` for the levels, and
  `chords.custom.<roots-mask>.<qualities-mask>…` for a custom set. Ids that start with a clef
  (`treble`, `bass`, `both`) keep meaning sight-reading, so old links do not break.

**Tests.** Same options and seed give the same MusicXML; every level only uses its chords; the
round trip through `parseMusicXml` gives the chord's pitches as one step per bar (hands, beats and
pitches match); no repeats; ranges stay inside C2 to C7 and a hand's reach (a tenth for the right
hand); an unknown id falls back to defaults.

**Watch.** Do not add the chord list to the `Song`; the drill keeps it (`Drill.chords`) and passes it
on (P7-04). A `Song.chordSymbols` field would also help imported lead sheets, but widens the song
format for one feature; left for a later phase. Size: M to L.

### P7-03 (PRAC) Judging a chord

**Why.** Wait mode and play-along judge notes. A chord drill needs "was the chord right, and if not,
what was wrong".

**Build.** `packages/practice/src/chord-tally.ts`:

- `ChordTally` fed by the same `WaitOutcome`s as `LiveTally`: per step, the time from the step
  starting to its last note, whether any wrong key came first, and then a **cause** for a miss:
  `missing` (stopped short), `extra` (a key outside the chord), `quality` (the wrong third or fifth:
  major for minor, a diminished fifth for a perfect one), `inversion` (right notes, wrong bass).
- Per chord kind and root, the counts needed for P7-08 and for the result screen.
- **Chord spread** for play-along: today each note is judged against ±75 ms by itself. A learner
  rarely lands four keys inside 150 ms on a touch screen. Count a chord as together when its notes
  fall inside a spread of 120 ms (a setting under Options, "Strict chords" at 60 ms), scored by the
  chord's median offset. Keep the per-note scorer as it is and add a chord layer above it, so
  pieces are unaffected.

**Tests.** Table-driven outcomes for each cause; spread edge cases; a replayed recorded event list
gives the same tally; wait mode behaviour unchanged (run the existing suite).

**Watch.** `WaitMode` lets a wrong key through without blocking. For a chord drill, "right at the
first try" means no wrong key before the chord completes, so the tally needs to look at the order of
events, not only the counts. Size: M.

### P7-04 (APP) The Drills hub and the Chords setup page

**Why.** Learners find drills on one page; chords should be one click away.

**Build.**

- `routes/Drills.tsx` becomes a hub with two cards, **Sight-reading** (today's page, unchanged
  behind it) and **Chords**; a link to scales appears with P7-14. `#/drills` stays the hub and
  `#/drills/sight-reading` and `#/drills/chords` are the setup pages. `lib/router.ts` and the
  nav keep working with the old `#/drills` link.
- The Chords setup page: **Level** (1 to 8, with one line saying what each adds), a **custom set**
  (roots as 12 buttons, qualities as checkboxes, inversions on or off), **Hands**, **Show**
  (`Sheet`, `Falling keys`), **Chord names** (`Shown`, `Hidden`, `Name only`), **Pace** (P7-09),
  **Chords per round** (8, 16, 32, endless). Remembered in a `chordDrillPrefs` setting, as
  `drillPrefs` is.
- `practice/chord-drill.ts` beside `practice/drill.ts`: preferences, `chordDrillRoute`, `loadChordDrill`
  returning `{ song, musicxml, chords, title }`.
- Chord names in the learner's label style. A `chordName(parts, style)` in `lib/notes.ts` using the
  existing `NoteLabelStyle`: letters (`B♭maj7`), German (`Bmaj7` for B♭, `Hmaj7` for B), fixed-do
  (`Si♭ maj7`). German strings for every new label are added once, keyed by the English text (ADR
  0014), with British spelling in English ("practise", "colour").

**Tests.** Component tests for the page; unit tests for `chordName` in all three styles over all
twelve roots; the old drill links still open sight-reading. Size: M.

### P7-05 (APP) Sheet (blind) mode, the first playable

**Why.** This is the first thing the maintainer described and needs the least new drawing.

**Build.** A chord drill opens the practice screen as drills do (`drill?` prop in `Practice.tsx`),
with `guide: 'none'` (or `'keys'` if the learner chose "Show the key to press"), wait mode, the page
view, hands as the drill set them. Differences from sight-reading, all in one place in
`Practice.tsx`'s drill branch:

- Source `'drill'` with an id that starts `chords.` loads `loadChordDrill`.
- The score shows the chord name above each chord according to "Chord names". For **name only**,
  the staff is shown without the notes of the chord to come and the notes appear after it is played
  or after a "Show me" button (counted as a miss).
- The readout becomes **chords a minute** and the share right at the first try, from `ChordTally`.
- The end of a round shows the result card of P7-08.

**Done when.** On a desktop with a fake MIDI keyboard, and on the on-screen keyboard, a learner can
play a round of 16 random triads from the sheet and see the speed and the share right at the first
try. Playwright covers level 1 and level 6 (e2e: `chord-drills.spec.ts`, modelled on
`drills.spec.ts`), and the old sight-reading e2e still passes.

**Watch.** The page view must stay readable at ⅓ of an iPad: one chord per bar means four to six
bars per system at the narrowest width; test 320 px with Verdana (Linux CI fonts are wider). Size: M.

### P7-06 (APP) Falling keys mode

**Why.** The issue's author and the maintainer asked for falling bars and a keyboard.

**Build.** The same drill with `view: 'falling'` and `guide: 'full'`:

- Falling bars over the keyboard in the hand's colour, the keys lit as the chord arrives. In wait
  mode the chord stops at the line until it is played, as pieces do today.
- **Chord names on the bars.** The renderer (`views/renderer.ts`) gets an optional `labels` list
  (`{ beat, text }`) drawn above each chord's bars on the canvas, from the drill's `chords`, in the
  learner's label style. This stays on the canvas and out of React, as AGENTS.md requires.
- **Hint fade** by level: all keys lit; only the root lit; none lit (the bars fall, the learner
  finds the keys). This is `guide` extended, or a separate `hint` on the session; decide in the PR
  and put the choice in ADR 0022.
- **Speed.** Tempo mode sets the fall speed through the practice tempo and `lookahead` (P7-07).
  Reduced motion: follow the app's existing setting (already read by `views/renderer.ts`) and
  check what the falling view does with it today before deciding whether this display needs a
  fallback to the sheet.

**Done when.** Both displays play the same drill, so the choice `Show: Falling keys` changes only the
picture, not the chords or the id. Playwright checks the label drawn and the key lit. Size: L.

### P7-07 (APP) Speeds: wait, tempo and the ladder

**Why.** "Different speeds" is half the request.

**Build.**

- **Wait:** the next chord is shown when the last is right (today's wait mode). The readout is
  chords a minute and median time to complete a chord.
- **Tempo:** a chord every bar, 40 to 120 beats a minute in steps of 5 (the bar is four beats, so
  60 is a chord every four seconds), a one-bar count-in with the metronome (`practice/metronome.ts`),
  and `PlayAlongScorer` with the chord spread of P7-03. Chords the learner misses are counted and
  the cursor moves on.
- **Ladder (off by default):** after three rounds in a row with at least 90 % right at the first
  try, the tempo rises one step; after a round under 60 %, it falls one step. Shown plainly, never
  as a nag: one line on the result card, and a switch to turn it off.

**Tests.** The ladder as a pure function with table tests (in `packages/practice`); the tempo
mapping to `lookahead`; the count-in. Size: M.

### P7-08 (STORE, APP) Chord progress and weak chords

**Why.** A random drill hides what is hard. Seeing "diminished sevenths, 40 %" tells the learner what
to practise.

**Build.** A `chordStats` setting: for each quality (and, if the data supports it, each root), the
attempts, first-try rights and a moving median time, over the last 200 rounds at most. Never the
drill's notes, never a title, never sent anywhere. The result card shows this round against the last
five; the setup page gets "**Practise my weak chords**" which weights the generator towards the
chords under 80 %. The backup (`backup/backup.ts`) already carries the `settings` table except keys
that `isDeviceSetting` marks as this device only, so a `chordStats` setting is in the encrypted
backup unless it is listed there. Ask the maintainer (Q3); the recommendation is to include it,
because it is the learner's own data and the backup is the only export (hard rule 1).

**Tests.** The statistics update and the cap; the weighting never starves a chord; backup round trip
if it is included. **Watch.** ADR 0015 chose to keep no progress for sight-reading drills, because
nothing comes back to look at. Chords are different: the point is coming back. Say so in ADR 0022. Size: M.

### P7-09 (APP) Pace and difficulty controls

**Build.** Wire the pace and the level selectors from P7-04 to P7-07, and the difficulty ladder:

| Level | Adds                                                                       | Hands |
| ----- | -------------------------------------------------------------------------- | ----- |
| 1     | Major and minor triads, root position: C, F, G major; A, D, E minor        | Right |
| 2     | Every white-key root, major and minor                                      | Right |
| 3     | All twelve roots (sharps and flats)                                        | Right |
| 4     | First and second inversions                                                | Right |
| 5     | Diminished, augmented, sus2 and sus4                                       | Right |
| 6     | Seventh chords in root position: maj7, 7, m7, m7♭5, dim7                   | Right |
| 7     | Seventh chord inversions, add9, sixth chords                               | Right |
| 8     | Left hand root and fifth under any of the above, then both hands in chords | Both  |

Levels are a starting point for the maintainer to tune after trying them (Q5). A custom set sits
beside them. Size: S, since most of the parts exist by then.

### P7-10 (ENG) Four-note chords on the microphone

**Why.** Levels 6 and up have four notes. The detector's targets (spec, "Accuracy targets and test set") cover two and three notes.

**Build.** Add 4-note chords to `packages/engine/tests/synthetic_accuracy.rs` (the same scenarios:
wait mode with and without pedal, play-along), report before and after numbers, and record a few
real four-note chords for the Phase 0 set (P0-04). Until the numbers meet the 95 % and 3 % targets,
a chord drill with the microphone at level 6 or higher shows the hint "Four-note chords work best
with a MIDI keyboard or the on-screen keys." Never loosen thresholds to make the number pass. Size: M.

### P7-11 (APP) The on-screen keyboard with several fingers

**Build.** Check `input/touch-input.ts` and the keyboard view for pressing three or four keys at
once (pointer ids, no lost `pointerup`, no stuck keys when a finger slides). Add a test that
presses a chord with several pointers; check at ⅓ of an iPad and after rotation. WebKit needs a
manual check (AGENTS.md): say how in the PR. Size: S to M.

### P7-12 (GOV) Docs

User guide: a "Chord drills" section (what each level adds, the two displays, the speeds, weak
chords), the README feature list, the About page if it lists features, and the shortcut list in
Settings if drills gain keys. German strings reviewed together with the existing read-through. Size: S.

### P7-13 (human) Checks with the maintainer

On the maintainer's own Chrome in dark mode (as in earlier rounds), a real MIDI keyboard through
`midi-test/`, and an iPad: both displays, each level, the speed ladder, the chord names in German,
the result card. Then, with the maintainer's approval, reply on issue #47 that it is live. Do not
comment before. Size: S.

### P7-14 (PRAC, APP) Scales (optional follow-on, see Q4)

The issue also asks for scales. A scale drill reuses the same hub, the generator pattern, the two
displays and the tally: the "chord" is an ordered run of notes in a key (major, the three minors,
modes, pentatonic, blues), one or two octaves, hands separately or together, with the fingering
`packages/practice/src/fingering.ts` already suggests. Order matters, so it uses play-along or wait
mode per note rather than per step. Plan it properly (a section here and its own tasks) once chords
are live and the maintainer has played with them. Size: L.

## 6. Sketch of the setup page (proposal for P7-04)

```
Drills
  [ Sight-reading ]  [ Chords ]

Chords
  Level        [ 3 · All twelve roots ▾ ]      or  Custom set…
  Hands        ( ) Right  ( ) Left  ( ) Both
  Show         ( ) Sheet, no help   ( ) Falling keys
  Chord names  [ Shown ▾ ]   Shown · Hidden · Name only
  Pace         ( ) Wait for me   ( ) Tempo  [ 60 ] beats a minute   [ ] Speed up as I improve
  Chords       [ 16 ▾ ]   8 · 16 · 32 · Endless
  [ ] Practise my weak chords

  [ ▶ Start ]
```

Result card: chords a minute, right at the first try, the three hardest chords with what went wrong
("A♭ aug: one note missing, 3 times"), and "Again" and "Next level".

## 7. Open questions for the maintainer

Each has a recommendation so work can start.

| #   | Question                                                                             | Recommendation                                                                          |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Q1  | Where does it live?                                                                  | A second card on the Drills page (hub), so sight-reading links keep working             |
| Q2  | Add "Name only" (see the name, find the notes) to the two displays you named?        | Yes: it is the one that teaches recall, and the issue's author wants patterns           |
| Q3  | Keep chord progress, and include it in the encrypted backup?                         | Yes, on the device and in the backup; nothing leaves otherwise                          |
| Q4  | Scales now or after chords?                                                          | After (P7-14), on the same pieces                                                       |
| Q5  | The level ladder in P7-09: right order?                                              | Start as written, tune after trying it                                                  |
| Q6  | Four-note chords on the microphone before P7-10 has numbers?                         | Allowed with a hint to use MIDI or touch                                                |
| Q7  | Tempo ladder on or off by default?                                                   | Off                                                                                     |
| Q8  | One chord per bar for every level, or two chords per bar at the highest speeds?      | One per bar; revisit if players want faster                                             |
| Q9  | Chord symbols for German users: write B and H (German), or B♭ and B (international)? | Follow the existing note-name setting (P5-03); German by default for a German interface |

## 8. Out of scope, and why

- **Importing lead sheets or chord charts** and a `Song.chordSymbols` field: a wider change to the
  song format; separate decision.
- **Chord detection from audio** ("what chord am I playing?"): the detector is score-informed and
  stays that way (AGENTS.md); the drill always knows the expected chord.
- **Sharing a drill or a score** with another person: a drill link carries only options and a seed,
  never music from the learner's library; no server, hard rule 1.
- **Progressions and songs by the chord changes** (I–V–vi–IV, twelve-bar blues): a good next step
  after P7-14; they need a rhythm and a left-hand pattern, which this phase leaves out.
- **Playing a backing track** or accompaniment: Phase 6's sampler could, but it is another feature.
- **Jazz voicings, extended chords above the ninth, and slash chords:** later, if learners ask.

## 9. How to check it

- `pnpm check` and the Playwright suite (`pnpm --filter @opentiles/web e2e`), including the new
  `chord-drills.spec.ts` for both displays and for the old sight-reading drills.
- `cargo test --workspace` for P7-10, with before and after accuracy numbers in the PR.
- By hand: the fake MIDI keyboard in `midi-test/`; a real keyboard on Chrome; WebKit for the
  on-screen keyboard and audio unlock (Safari rules in architecture.md).
- Look at it in the maintainer's own dark-mode Chrome and at 320 px with Verdana before calling the
  layout done.

## 10. Hard rules, checked

1. **No distribution path.** A drill link holds options and a seed; no music, no title, no export.
   Progress stays in the device (and the encrypted backup).
2. **No imports from other sites.** None.
3. **Nothing leaves the device.** Generation, judging and statistics run in the browser.
4. **No copyrighted music.** Chords are generated; chord names are facts, not works. Fixtures are
   generated in tests.
5. **No tracking.** The chord statistics are local and are not telemetry.
6. **No paywall, no dark patterns.** The tempo ladder is off by default and says what it does.
7. **Licences.** No new dependency is planned. If P7-02 needs one, name its licence in the PR.
