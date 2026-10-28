# Phase 7 — Spaced review and hard bars

- **Status:** planned on 2026-10-26 by a contributor; the maintainer accepted it on 2026-10-28 and
  answered the questions in section 7, which ADR 0026 records. The tasks are P7-25 to P7-33 in
  [PLAN.md](../../PLAN.md#phase-7--chord-drills-planned-2026-10-22), item 3 of the queue's Later
  list; the contributor builds them and the maintainer reviews each pull request. The two pure
  pieces came first, as [#64](https://github.com/KunalGehlot/OpenTiles/pull/64) (P7-26) and
  [#63](https://github.com/KunalGehlot/OpenTiles/pull/63) (P7-28), so the idea could be judged on
  working code.
- **Where it came from:** [Discussion #62](https://github.com/KunalGehlot/OpenTiles/discussions/62),
  "Spaced review for the drills, and pieces that remember their hard bars", from a learner who wants
  the app to bring back what was hard, in drills and in pieces, rather than leave that to memory. It
  is the first, smallest step of a wider wish for practice that connects up, and builds only on what
  OpenTiles already records.
- **Read first:** [chord-drills.md](chord-drills.md) and [scales.md](scales.md) (the progress this
  reuses), [ADR 0015](../adr/0015-sight-reading-drills.md) (why sight-reading keeps no progress),
  [ADR 0022](../adr/0022-chord-drills.md), the [development guide](../development.md) and
  [architecture.md](../architecture.md).

## 1. What was asked

1. **Come back to what was hard, at the right time.** A chord that went wrong last week should come
   back this week; one that has been right for a month can wait a month. This is spaced repetition,
   the best-supported finding about practice that lasts (Cepeda et al. 2006; Dunlosky et al. 2013).
2. **Remember the hard bars of a piece.** The summary already says which bars were hardest in a run;
   the learner would like the piece to remember the bars that keep going wrong, show them before the
   next run, and loop them on request.
3. **Nothing that nags.** No reminders, badges or points; the app shows what is due when the learner
   opens the Drills page or a piece, and that is all (hard rule 6).

## 2. Facts that shape the plan

What the code does today, checked on `main` at `a29bfcd` and again at `69e56b6`:

- **Chords and scales keep rounds.** `chordStats` and `scaleStats` (settings, ADR 0022 and 0024) keep
  the last 200 rounds (`MAX_ROUNDS`), each with its time and, per kind (`pitchClass.quality` for
  chords), the attempts and the first tries. They are in the encrypted backup and go nowhere else.
- **"Weak" has no time in it.** `weakChords` and `weakScales` total every kept round and call a kind
  weak when it was tried at least three times and right at the first try under 80 % (`WEAK_SHARE`).
  So a chord that was weak a month ago and has been right since still counts by its old misses, and
  a chord that was right a month ago and not played since never comes back.
- **Sight-reading keeps no progress.** ADR 0015 decided that drills made up on the spot add to the
  day's practice time only (`recordPracticeTime`), because "there is no piece to come back to".
- **Pieces keep a summary, not their bars.** `Progress` (`storage/db.ts`) holds the best accuracy,
  the number of runs, when the piece was last played and the time spent. After a run the summary
  shows "Hardest bars" (`RunSummary.hardestMeasures`, the top three: from `summarise()` in
  play-along, from `wrongByMeasure` in wait mode) and the score marks them (`ScoreView`'s `hardest`
  prop). At the next run they are gone.
- **The tools to practise bars exist.** Loops with a speed-up after clean runs (`loop.ts`, P2-08) and
  step practice by phrases (`phrases.ts`, P3-04).
- **The backup merges progress field by field.** `mergeBackupData` keeps "the better of both" through
  `asProgress`, which reads today's fields only; a new field must be added there or a restore drops
  it.

## 3. What gets built, in short

- **A review schedule for chords and scales, from the rounds already kept.** Each kind of chord and
  each scale gets an SM-2 schedule (Woźniak, 1990; the rule behind most flash-card programs): right
  at the first try in 80 % of a day's attempts is a pass, and passes come back after 1, 6, then about
  15, 40 … days; a fail comes back the next day. Before a kind is due, a day with fewer than three
  tries of it is not graded as a fail, so one slip says little. At most 20 chords and 20 scales a
  day, counted over the day. The schedule is **replayed from the kept rounds**, so nothing new is
  stored, the backup carries it already, and old data works from the first day.
- **"Due for review" on the Drills page.** One quiet line above the cards when something is due:
  "Due for review: 3 chords, 1 scale", with **Review now**, which starts a chord or scale drill
  drawing only the due kinds at the learner's current setup. Nothing when nothing is due.
- **Hard bars that a piece remembers.** Each run of a library or catalogue piece (not each pass of a
  loop) adds the bars it played and its missed and wrong notes per bar (indices and counts only) to
  the piece's progress, the last ten runs. A bar is **hard** when at least two of the last three
  runs that played it had problems in it; it stops being hard once two clean runs out of three get
  through it. The score and the overview strip mark hard bars before a run, and **Practise the hard
  bars** loops them with a bar either side.
- **Optional, if the maintainer wants it (Q9):** sight-reading keeps first tries per note, so the
  notes a learner misreads come back more often, as weak chords do.

## 4. Order and parallel lanes

| Lane                 | Tasks        | Notes                                                                |
| -------------------- | ------------ | -------------------------------------------------------------------- |
| A — Pure packages    | P7-26, P7-28 | `packages/practice` only; no DOM. Offered as pull requests already.  |
| B — Review in drills | P7-27        | After P7-26; touches the Drills page and the drill setup only        |
| C — Hard bars        | P7-29, P7-30 | After P7-28; storage first, then the score marks and the loop button |
| Optional             | P7-31        | Only if Q9 is yes                                                    |
| Last                 | P7-32, P7-33 | Docs, German strings, then the maintainer's check                    |

Lanes B and C are independent; either can ship first.

## 5. Tasks

Sizes: S under a day, M a day or two, L several days.

### P7-25 (GOV) This plan, ADR 0026 and the maintainer's answers

This file, the tasks in PLAN.md and [ADR 0026](../adr/0026-spaced-review.md). The maintainer
answered section 7 on 2026-10-28; the ADR records the answers and is accepted. Done. Size: S.

### P7-26 (PRAC) The review schedule

**Why.** "Weak" says what was hard; a schedule says when to come back to it.

**Build.** `packages/practice/src/review.ts`, pure:

- `gradeOf(firstTry, attempts)`: a day's share right at the first try as an SM-2 grade, 0 to 5;
  passing starts at `WEAK_SHARE`, the weak-chords line.
- `review(state, item, grade, day, attempts)`: one SM-2 step. The ease factor starts at 2.5 and
  never drops below 1.3; passes come back after 1, 6, then interval × ease days; a fail resets to
  1 day and counts a lapse once the item was known. **Before the item is due, a pass changes
  nothing**, because chords turn up in ordinary drills all the time and counting those would push
  reviews out too fast, **and so does a fail on fewer than `MIN_ATTEMPTS` (3) tries** (Q3, Q4):
  `weakChords` needs three tries before it calls a chord weak, and at the higher levels a kind often
  gets one or two tries in a round, so one slip would decide. On or after the due day every review
  counts, as a flash card is graded on one answer.
- `replayReviews(events)`: the states replayed in time order, with **the rounds of one local day
  merged into one review** per item, so five rounds in an evening are one review.
- `dueReviews(states, now, limit)`: the due items, longest overdue first, then the hardest (lowest
  ease); at most `MAX_REVIEWS` (20) a day, **counted over the day** (Q5): `reviewedToday` counts
  the items reviewed today when they were due, and they come off the limit, so asking again after
  20 reviews brings no more that day. New kinds and early fails do not count, so a learner who meets
  20 new chords still gets their reviews. Chords and scales have 20 each.
- `chordReviewEvents(stats)`, `scaleReviewEvents(stats)`, `dueChordKinds(stats, now, allowed)` and
  `dueScaleKinds(...)`: the adapters from the kept rounds, with `allowed` as `weakChords` has it.

**Tests.** Grades at the edges; the ease formula; 1, 6, then interval × ease; an early pass ignored;
an early fail counted from three tries and ignored under them; one review a day; due order and the
limit; a secure chord due on day 24 that slips once in two tries on day 9 and keeps its schedule; a
second call on the same day after 20 reviews; chord and scale rounds replayed; and a simulated two
months (24 kinds of chord, four new a day, 85 % right) in which the due count settles to a few a day
while the mean interval passes six days. Size: M. **Pull request
[#64](https://github.com/KunalGehlot/OpenTiles/pull/64).**

**Watch.** Day boundaries are the learner's local days (`localDayNumber`), as `days` in the database
are (`localDay()` in `storage/db.ts`). Rounds older than the 200 kept drop out of the replay; for a
learner who plays a round a day that is more than half a year.

### P7-27 (APP) "Due for review" on the Drills page

**Why.** The schedule is of no use until the learner sees it, and the Drills page is where drills
start.

**Build.** On the Drills page, above the cards, when anything is due: "Due for review: 3 chords,
1 scale" and **Review now**. Review now opens the chord (or scale) drill with the learner's own
setup, drawing only `dueChordKinds(stats, now, allowed)` the way "Practise my weak chords" draws the
weak ones (`weakFocus` in `practice/chord-drill.ts`): the same path, a different list. When both are
due, chords first, then scales. On the chord and scale setup pages, the weak-chords line also says
how many are due. Nothing is shown when nothing is due; no badge on the navigation, no count on Home.

**Done when.** A learner with old rounds sees the line on the day their chords come due, Review now
draws only those, and after the round they are no longer due. Playwright: the line appears from
seeded `chordStats`, and Review now starts a drill with the due kinds. Size: M.

**Watch.** `allowed` must be the kinds the learner's current setup can draw, or Review now would
offer chords outside their level; say so on the page ("2 more are due outside this level") rather
than widening the level by itself.

### P7-28 (PRAC) Hard bars

**Why.** One bad run says little; the same bar going wrong run after run is what to practise.

**Build.** `packages/practice/src/hard-bars.ts`, pure:

- `BarRun { at, fromMeasure, toMeasure, problems }`: the bars a run played and its missed and wrong
  notes per bar index (Q7), without the bars that had none. Indices and counts only, never notes.
- `barRunOf(at, range, problems)`: the run as it is kept, from all bars' problems (not only the three
  the summary shows); problems outside the range dropped.
- `addBarRun`, keeping the last `MAX_BAR_RUNS` (10), and `normaliseBarRuns(unknown)` for stored
  data, with bar keys written the way `hardBars` looks them up and problems outside the run dropped.
- `hardBars(runs)`: a bar is hard when at least `HARD_IN` (2) of the last `HARD_OF` (3) runs **that
  played it** had problems in it. A run that starts at bar 5 says nothing about bar 1.
- `hardBarLoops(bars, lastMeasure)`: loop ranges around the hard bars with one bar either side,
  joined where they touch.

**Tests.** Ranges, repeats and stray bars in `barRunOf`; the limit of ten; malformed stored data,
and keys such as `"03"` read back as bar 3; two of three; runs that did not play a bar; bars that
stop being hard; loops at the ends of a piece and joined loops. Size: S. **Pull request
[#63](https://github.com/KunalGehlot/OpenTiles/pull/63).**

### P7-29 (STORE) Keep a piece's bar runs

**Build.** `Progress.barRuns?: BarRun[]`, an optional field, so there is no Dexie schema change (it
is not indexed). `recordRun` takes the run's `BarRun` and adds it with `addBarRun`. Drills record
nothing here, as today.

- **What counts** (Q7): missed and wrong (extra) notes per bar, not early or late ones. In
  play-along they come from the note results `summarise()` counts as missed or extra, every bar
  rather than the top three; in wait mode from `wrongByMeasure`, which counts wrong notes, so the
  two modes agree. Timing stays in the summary's "Hardest bars", which ranks the bars of one run;
  with ±75 ms on time at full speed, an absolute "any problem in 2 of 3 runs" would mark every bar
  in which a learner was slightly late twice.
- **Loop passes are not runs.** Each pass of a loop calls `recordRun` today (`Practice.tsx`,
  `addLoopListener`) for the practice time; it adds no `BarRun`. Only a run that ends as a run adds
  one, with the bars it played: from the bar it started at to the end of the piece. The loop is
  where the learner works on a bar, the run is where it is tested in context. So ten passes of a
  loop never push out the whole runs, the bars outside the loop keep their history, and a bar stops
  being hard when runs get through it, not when a loop does. (Summing a loop's passes, or keeping
  its last pass, would let two looped sessions clear a bar never played in context, and needs the
  end of a loop to be detected, which a closed tab does not report.)
- **The backup.** In `backup.ts`, `asProgress` reads `barRuns` through `normaliseBarRuns`, and a
  merge keeps the runs of the more recently played record.

**Done when.** Unit tests for the merge; a piece played three times with the same bad bar has it in
`hardBars(progress.barRuns)`; ten passes of a loop leave the runs as they were; a restore keeps the
runs. Size: S to M.

**Watch.** Re-importing a library piece with a different bar count (P1-07's trim) makes old indices
point at other bars. Drop the runs when the piece's measure count changes, the way the sheet map is
re-made.

### P7-30 (APP) Hard bars in the score and the loop button

**Build.**

- Before a run, the score (page and falling views) and the overview strip mark the hard bars the way
  the summary marks the hardest bars after a run (the `hardest` prop), with an outline or a pattern
  as well as the colour, so the colour is never the only sign (accessibility rules in
  architecture.md).
- The summary's "Hardest bars" line gains "(hard in 2 of your last 3 runs)" for bars that are hard,
  and a **Practise the hard bars** button. It sets the loop to the first range of `hardBarLoops`
  with the loop speed-up on; after that range is clean, the next one. The loop's passes add no bar
  runs (P7-29); the marks change with the next runs.
- Settings: "Mark hard bars" on by default, so a learner who finds the marks distracting can turn
  them off.

**Done when.** Playwright: a piece with seeded bar runs shows the marks and the button sets the
loop. A check by eye in the maintainer's dark-mode Chrome and at ⅓ of an iPad. Size: M.

### P7-31 (PRAC, APP) Misread notes come back (optional, Q9)

**Build.** If the maintainer agrees to change ADR 0015 for this: `noteStats`, the last 200
sight-reading rounds with first tries per clef and pitch (counts only, as `chordStats`), and the
generator in `drills.ts` drawing misread notes more often when "Practise the notes I misread" is on.
The review schedule of P7-26 takes these rounds as a third adapter. Size: M.

### P7-32 (GOV) Docs

User guide: "Coming back to what was hard" (what due means, why a chord comes back after a week,
the hard bars and the loop); README features; ADR 0026 accepted; German strings with the existing
read-through. Size: S.

### P7-33 (human) Checks with the maintainer

On the maintainer's own Chrome and an iPad: the due line on a day with due chords, Review now, the
hard-bar marks in both views and the loop button, the German texts. Size: S.

## 6. Sketch (proposal for P7-27 and P7-30)

```
Drills
  Due for review: 3 chords, 1 scale                         [ Review now ]
  [ Sight-reading ]  [ Chords ]  [ Scales ]
```

```
Summary
  92 % · 3 missed
  Hardest bars: 12, 13 (hard in 2 of your last 3 runs), 20
  [ Practise the hard bars ]  [ Again ]  [ Back ]
```

## 7. Questions for the maintainer, decided 2026-10-28

Each had a recommendation. The maintainer answered in
[Discussion #62](https://github.com/KunalGehlot/OpenTiles/discussions/62) and in the reviews of #63,
#64 and #65; ADR 0026 records the answers. Q3, Q4, Q5 and Q7 differ from the recommendation.

| #   | Question                                                                         | Recommendation                                                                   | Answer                                                                                                              |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Q1  | Is spaced review wanted, and where does "due" show?                              | Yes; one line on the Drills page only. No badge, no count on Home, no reminder   | Yes, as recommended                                                                                                 |
| Q2  | Replay the schedule from the kept rounds, or store a schedule of its own?        | Replay: nothing new to store or back up, and it works on old data from day one   | Replay                                                                                                              |
| Q3  | What is a pass?                                                                  | 80 % right at the first try over a day, the existing weak line (`WEAK_SHARE`)    | The 80 % line; but before a kind is due, a day with fewer than three tries (`MIN_ATTEMPTS`) is not graded as a fail |
| Q4  | Does a pass before the due day count?                                            | No; a fail counts whenever it happens                                            | No; an early fail counts once that day had three tries or more                                                      |
| Q5  | How many reviews a day at most?                                                  | 20; the rest waits, so a long break does not come back as a wall of reviews      | 20 a day, counted over the day rather than per list                                                                 |
| Q6  | Keep a piece's last ten runs as bar indices and problem counts, in the backup?   | Yes; never notes, and dropped when the piece's bar count changes                 | Yes, as recommended                                                                                                 |
| Q7  | When is a bar hard?                                                              | With problems in 2 of the last 3 runs that played it; tune after trying it       | 2 of the last 3 runs that played it, counting missed and wrong notes only, not early or late ones                   |
| Q8  | Mark hard bars before a run, on by default?                                      | Yes, with a pattern as well as colour, and a setting to turn the marks off       | Yes, as recommended                                                                                                 |
| Q9  | Change ADR 0015 so sight-reading keeps first tries per note (P7-31)?             | Yes, later; counts only, as `chordStats`. Can wait until the rest has been tried | Later, once the rest has been tried                                                                                 |
| Q10 | The wider idea (chords and drills from one's own pieces, theory in the score …)? | Separate Discussions, one at a time, after this has shipped                      | Agreed: one Discussion at a time, after this has shipped                                                            |

## 8. Out of scope, and why

- **Reminders and notifications:** a nag is a dark pattern (hard rule 6); the learner looks when
  they want to.
- **Points, levels for reviews, or a "review streak":** the existing day streak stays as it is; this
  plan adds no new pressure.
- **A daily practice plan** that portions the learner's time between pieces and drills: a larger
  idea from the same learner, for a later Discussion if this one works.
- **Drills made from the learner's own pieces** (chords, intervals or reading material from a hard
  bar): needs chords read from a `Song`, which ADR 0022 left for a separate decision.
- **Anything that leaves the device:** the schedule and the bar runs are local and in the encrypted
  backup only.

## 9. How to check it

- `pnpm check`; the new unit tests in `packages/practice/test/review.test.ts` and
  `hard-bars.test.ts`; Playwright for P7-27 and P7-30 with seeded stats and progress.
- By hand: change the system date (or seed `chordStats` with old rounds) to see chords come due; play
  a piece three times with the same wrong note to see a bar become hard, then twice cleanly to see
  it go; loop it and see the marks stay until the next runs.

## 10. Hard rules, checked

1. **No distribution path.** Nothing new is shared or exported; bar runs live with the piece's
   progress on the device.
2. **No imports from other sites.** None.
3. **Nothing leaves the device.** Scheduling and counting run in the browser.
4. **No copyrighted music.** Bar indices and counts are not music; fixtures are made in code.
5. **No tracking.** The data is the learner's own progress, like `chordStats`, not telemetry.
6. **No paywall, no dark patterns.** No reminders, badges or new streaks; the hard-bar marks can be
   turned off.
7. **Licences.** No new dependency. SM-2 is a published algorithm, written from its description.
