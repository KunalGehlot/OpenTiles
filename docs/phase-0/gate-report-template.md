# G0 gate report — microphone recognition on iPad

- **Date:**
- **Author:**
- **Engine commit:**
- **Decision:** GO / NO-GO (MIDI-first, microphone beta)

## Test set

| Piano | Room | Device (chip, iOS) | Passages | Notes |
| --- | --- | --- | --- | --- |
| | | | | |

## Accuracy (wait mode, C2–C7, single notes and 2–3 note chords)

| Set | Correct notes accepted (target ≥ 95 %) | Wrong notes accepted (target ≤ 3 %) |
| --- | --- | --- |
| Acoustic | | |
| Digital | | |
| **All** | | |

Breakdown by register (C2–C3, C3–C6, C6–C7), chord size and pedal use:

## Latency

| Stage | Older iPad (A12-class) | Current iPad | Target |
| --- | --- | --- | --- |
| Audio input latency | | | ≤ 20 ms |
| Window + hop / decision delay | | | ≤ 50 ms |
| wasm processing per hop | | | ≤ 2 ms |
| Visual feedback | | | ≤ 16 ms |
| **Total, microphone** | | | **≤ 100 ms** |

How measured:

## Thresholds used

Mode, accept threshold, novelty threshold, wrong-note margin, decision delays.

## Failures and what they tell us

## Decision and next steps
