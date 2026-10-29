# 0026 — Spaced review and hard bars: a schedule replayed from kept rounds, bars kept per piece

- **Status:** accepted (the maintainer answered the plan's questions, 2026-10-28)
- **Date:** 2026-10-26
- **Plan task:** P7-25 (decisions for P7-26 to P7-31; the plan is
  [docs/phase-7/spaced-review.md](../phase-7/spaced-review.md))

## Context

Chord and scale drills keep their last 200 rounds on the device (ADR 0022, 0024), and "Practise my
weak chords" draws the kinds whose first-try share over all kept rounds is under 80 %. That answers
"what was hard" but not "when to come back to it": a weak chord that has since become secure keeps
its old misses, and a secure chord that has not been played for a month never returns. In pieces,
the summary names the three hardest bars of a run and the score marks them, but the next run starts
from nothing, so a bar that goes wrong every time looks the same as a one-off slip.

Spacing practice over growing intervals is the best-supported way to make it last (Cepeda et al.
2006; Dunlosky et al. 2013). The constraints are OpenTiles' own: nothing leaves the device, no
dark patterns (no reminders, no new streaks), pure logic in `packages/practice`, and the encrypted
backup as the only copy elsewhere.

## Decision

Each point names the question in the plan it answers. The maintainer's answers
([Discussion #62](https://github.com/KunalGehlot/OpenTiles/discussions/62) and the reviews of #63
to #65) changed Q3, Q4, Q5 and Q7 from the proposal; the points below are as decided.

- **SM-2, replayed** (Q2, `packages/practice/src/review.ts`). Each kind of chord and each scale has
  an SM-2 schedule (Woźniak, 1990): an ease factor from 2.5, never below 1.3; a pass comes back
  after 1, 6, then interval × ease days; a fail comes back the next day. The schedule is not stored.
  It is replayed from the kept rounds whenever it is needed, so there is nothing new to save, back
  up or migrate, and a learner's existing rounds give a schedule on the first day.
- **A pass is the weak line** (Q3). A day's share right at the first try of 80 % (`WEAK_SHARE`) or
  more passes (grade 4, or 5 from 95 %); under it fails.
- **One review a day; early passes and early slips ignored** (Q3, Q4). The rounds of one local day
  count as one review of each item they touched. Before the due day a pass changes nothing, since
  chords appear in ordinary drills all the time, and so does a fail on fewer than `MIN_ATTEMPTS`
  (3) tries: `weakChords` needs three tries before it calls a chord weak, and at the higher levels a
  kind often gets one or two tries in a round, so one slip would send a secure chord back to the
  start. An early fail on three tries or more counts. On or after the due day every review counts,
  as a flash card is graded on one answer.
- **Twenty a day, counted over the day** (Q5). At most `MAX_REVIEWS` (20) reviews of due items a
  day, for chords and for scales each, the longest overdue first. The items reviewed today when
  they were due come off the limit, so asking again the same day brings no more, and a long break
  comes back spread over several days. New kinds and early fails do not count against it.
- **Shown once, on the Drills page** (Q1, P7-27): "Due for review: 3 chords, 1 scale" and Review now,
  which draws only the due kinds through the same path as the weak chords. No badge, no count on
  Home, no reminder.
- **Hard bars are kept per piece** (Q6, Q7, `packages/practice/src/hard-bars.ts`, P7-29). A piece's
  progress keeps its last ten runs as the bars played and the missed and wrong notes per bar index,
  never notes themselves. A bar is hard when at least two of the last three runs that played it had
  any. Early and late notes do not count: on time is ±75 ms at full speed, which suits "Hardest
  bars" ranking the bars of one run, but an absolute rule would mark every bar in which a learner
  was slightly late twice. Wait mode's `wrongByMeasure` counts wrong notes, so the two modes agree.
  The runs are dropped when a piece's bar count changes.
- **Loop passes are not runs** (P7-29). A pass of a loop counts as practice time, as today, but
  adds no bar run; only a run that ends as a run does. The loop is where a bar is practised and the
  run is where it is tested in context, so a loop's passes neither push out the whole runs nor
  clear a bar that has not been played in context.
- **Hard bars are marked before a run** (Q8, P7-30), with a pattern as well as the colour, and
  **Practise the hard bars** loops them with a bar either side; a setting turns the marks off.

## Consequences

- No new store and no schema change for chords and scales; pieces gain one optional field in
  `Progress`, which `asProgress` in the backup must learn.
- The schedule forgets what the 200 kept rounds forget. For a learner who plays a round a day that
  is more than half a year; for one who plays ten a day, three weeks, after which an untouched chord
  simply comes back as new.
- Replaying 200 rounds is cheap (a few thousand events) but should be memoised per stats object in
  the app rather than run on every render.
- Bar runs grow a piece's progress record by a few hundred bytes at most.

## Alternatives considered

- **A stored schedule per item.** Exact over any length of history, but a new store to back up,
  merge across devices and migrate, for little gain over 200 rounds.
- **Leitner boxes.** Simpler to explain, but coarse: the intervals are fixed per box and do not
  follow how easy each chord is for this learner.
- **FSRS** (the newer scheduler in Anki). Better fitted on large review logs, but it needs many
  parameters fitted on data a drill does not produce; SM-2 is enough for minutes-long drills.
- **The hardest bars of the last run only** (today). Cannot tell a slip from a habit.
- **Every bar that ever had a problem.** Never forgets; a bar that has been fixed should stop
  being marked.
- **Early and late notes as problems.** Fine for ranking one run's bars, too strict for an absolute
  rule over three runs.
- **A loop session as one run** (its passes summed, or its last pass). Would let looping clear a bar
  never played in context, and needs the end of a loop to be detected, which a closed tab does not
  report.
- **Twenty per list.** Simpler, but a second visit the same day would bring another twenty.
