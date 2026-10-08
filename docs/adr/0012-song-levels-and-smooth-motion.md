# 0012 — Several levels per song, a steady drawing clock and a centred play bar

- **Status:** proposed
- **Date:** 2026-10-08
- **Plan task:** P4-10 (review rounds), P4-16 to P4-18 of NEXT-PHASE.md

## Context

The maintainer's feedback on the first redesign build: the animation is choppy, the falling notes
look shrunk and strange on a wide window, the score cursor jumps at every bar line, the play bar
sits at 30 % so the right 70 % of the view is empty by the end, the score can be neither dragged nor
hidden behind a scroll bar, and the catalogue offers one short score per song at one level.

- `AudioContext.currentTime` advances in whole audio buffers. Read once per frame it gives uneven
  steps, which shows as judder at 60 and especially at 120 Hz.
- Wait mode eased the beat by a fixed fraction per frame, so the glide was twice as fast at 120 Hz.
- The keyboard was stretched over the full canvas width: at 2560 px, 22 white keys were 116 px wide
  and a few notes looked like huge, sparse blocks.
- A bar's closing cursor anchor sat on the barline, the next bar's first anchor on its first note a
  few pixels later, so the cursor stepped there and the scroll with it.

## Decision

1. **Drawing clock.** The session draws the falling notes (and the score cursor, which follows
   `session.beat`) from a steady clock: the display's timer, nudged toward the audio clock
   (`steadyClock` in `views/session.ts`). Judging, scheduling and the metronome still use the audio
   clock itself. Wait mode eases with `1 - exp(-dt * k)`, so it looks the same at any frame rate.
2. **Keyboard on wide windows.** A white key is at most 64 px wide. A wider window first shows more
   octaves (up to the piano's 88 keys), then centres the keyboard. Nothing changes below that width.
3. **Score cursor.** The closing barline anchor is dropped when the next bar is on the same row, so
   the cursor glides from the last note to the next bar's first note. Jumps remain at repeats and
   at system or page changes.
4. **Scrolling score.** The play bar stays in the middle of the view (supersedes decision 5 of
   ADR 0009, "30 % in from the left"). The score is moved with a transform, not `scrollLeft`: it is
   sub-pixel smooth, has no scroll bar, and can be dragged with a mouse or finger (with coasting) or
   a trackpad swipe. After a drag, following eases back to the bar once playing goes on. A second
   after a run ends the score returns to its start (page view: page 1).
5. **Page view.** The engraved page is at most 1100 px wide and centred; it is no longer stretched to
   the window.
6. **Levels of a song.** Option B of NEXT-PHASE.md: every level is its own piece folder with its own
   provenance record, `difficulty`, `verified` flag and progress, joined by two optional fields:
   `song` (a slug shared by the levels) and `variant` (what this level is called: "Melody",
   "Two hands", "Full"). The validator checks that levels of one song agree on composer, death year,
   traditional flag and lyricist, and that labels are unique. Home shows each level on the difficulty
   path at its own level and links the other levels of the song under the card.
7. **Long pieces.** Written with `tools/pipeline/arrange.py` where the tune is known exactly. Longer
   transcriptions and bulk content go through the PDMX pipeline and need a human reviewer (REVIEWING.md).

## Consequences

- Levels are reviewed separately, as REVIEWING.md assumes. A melody level generated from a two-hand
  arrangement is the same music with the left hand left out, so its review is short, but it is still
  a review.
- The steady clock is not a latency fix. Picture and sound can still differ by the output latency
  (Bluetooth); an output-latency offset for the picture is not done.
- With the play bar fixed in the middle, the first and last half view of the score are empty.
- Bella Ciao (P4-18) is **not** added: its origin is disputed and it needs the maintainer's legal
  decision first (NEXT-PHASE.md).

## Alternatives considered

- **One folder per song with a `variants` list** (option C): states the rights once, but `verified`,
  `difficulty` and progress become per variant, and every tool changes.
- **Folders grouped by name only** (option A): no code, but Home cannot link the levels.
- **Fixed centre until the score's end reaches the right edge**: no empty half at the end, more code
  and a play bar that moves; kept as a later option.
- **`scrollLeft` with a hidden scroll bar**: rounds to device pixels, so the cursor and the score
  disagree by up to half a pixel; a transform does not.
