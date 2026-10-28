# Phase 0 test set — recording protocol

The G0 gate (PLAN.md) is judged on real recordings, not on the synthetic smoke test. This document
says what to record, how, and in which format, so results are comparable across contributors.

## What to record

- **20 short passages** (10–30 seconds each) on **one acoustic and one digital piano** — 40 files in
  total for the first gate. More pianos and rooms are welcome afterwards.
- Only **public-domain or self-written music.** Recordings are kept out of git
  (`packages/engine/testdata/recordings/` is ignored) and shared with maintainers privately unless
  the performer releases them as CC0.
- Cover the gate's scope: single notes and 2–3 note chords between **C2 and C7**, at slow and
  moderate tempos, with and without the sustain pedal. Suggested mix:

| #     | Content                                              | Pedal    |
| ----- | ---------------------------------------------------- | -------- |
| 1–4   | Scales and arpeggios, right hand, C4–C6              | off      |
| 5–6   | Scales, left hand, C2–C4                             | off      |
| 7–9   | Melody with repeated notes (e.g. _Ode to Joy_ theme) | off / on |
| 10–12 | Two-note intervals: seconds, thirds, octaves         | off      |
| 13–15 | Three-note triads and inversions across the range    | off / on |
| 16–17 | Melody + bass (two hands), simple accompaniment      | on       |
| 18    | Very high register (C6–C7)                           | off      |
| 19    | Very low register (C2–C3)                            | off      |
| 20    | Soft playing (pp) of a simple melody                 | off      |

## How to record

1. Use **Detector Lab → 5. Test recordings and timing → Record** in the web app on an **iPad in
   Safari** (this captures with echo cancellation, noise suppression and auto-gain switched off,
   exactly as the app will). Place the iPad on the music stand as a learner would.
2. Note the device model, iOS version, piano make/model and room in the file name or a side note:
   `acoustic-yamaha-u1_ipad-9gen_17-1_p13.wav`.
3. The recorder saves a 16-bit mono WAV at the device sample rate.

## Answer keys

Each recording needs an answer key with the notes actually played (not the notes in the score, if
they differ), as CSV with a header:

```csv
onset_s,pitch,duration_s
0.512,60,0.45
0.512,64,0.45
1.020,62,0.40
```

- `onset_s` — seconds from the start of the WAV.
- `pitch` — MIDI note number (C4 = 60).
- `duration_s` — optional; used only for reporting.

Ways to produce it:

- **Digital piano:** record its MIDI output on a laptop at the same time (any DAW), export the MIDI,
  convert with `cargo run -p opentiles-engine --bin midi2csv -- take.mid > take.csv` and shift by the
  offset of the first note (the evaluator's `--align` option estimates it).
- **Acoustic piano:** play a known passage; label the onsets in Sonic Visualiser or Audacity (label
  track → export), and fill in pitches from the score. Correct any notes you played differently.

## Running the evaluation

```sh
cargo run --release -p opentiles-engine --bin evaluate -- take.wav take.csv
cargo run --release -p opentiles-engine --bin evaluate -- --dir packages/engine/testdata/recordings
```

For each recording the evaluator replays the audio through the detector the way wait mode would:

- **Correct notes:** before each chord, the expected pitches are set to the chord actually played;
  the share of those pitches accepted is the acceptance rate (target ≥ 95 %).
- **Wrong notes:** the run is repeated with one pitch of each chord replaced by a likely mistake
  (±1, ±2 semitones, ±12) as the expected pitch; the share of those accepted is the false
  acceptance rate (target ≤ 3 %).
- It also reports onset timing error and decision latency.
