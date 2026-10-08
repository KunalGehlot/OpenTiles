# 0010 — Hearing a run back, and saving it as a WAV file only for catalogue pieces

- **Status:** proposed
- **Date:** 2026-10-08
- **Plan task:** P4-09

## Context

P4-09 asks for a timing teacher: show when to press and how long to hold, give feedback, and let
the learner hear their run back, both exactly as played and "polished" (their notes and dynamics,
but exactly in time and held for the written length), plus a WAV download.

Hearing a run back raises no legal question: it happens inside the app, on the device, like the
listen mode that already plays every piece. A WAV file is different. For a library piece the
polished version is in effect a full rendition of the user's imported score, and the file can be
passed on outside the app. The legal guardrails (docs/legal-guardrails.md, "No distribution path
exists in the code") say the only export of library items is the user's own encrypted backup, and
hard rule 1 of the development guide forbids export paths for library items.

Holds can only be judged where the input reports key release: MIDI, the on-screen keyboard and the
computer keyboard. The microphone hears a note start but not the key coming up.

## Decision

- Every run in wait mode and play-along is recorded on the device (key down and up, velocity).
  After a run, "Listen to your performance" plays it back through the app's piano, as played or
  polished, for every piece.
- "Save as WAV" is offered only for catalogue pieces, which are public domain. Library pieces can
  be heard back but not saved as a file. The file is rendered in the browser with an
  `OfflineAudioContext` and the same piano samples; nothing is uploaded.
- Wait mode is polished by playing order (the learner sets the pace there, so onsets do not line
  up with the written times); play-along is polished by onset time.
- Hold feedback is given only for inputs with key release. In wait mode only "too short" is
  flagged: holding on while finding the next note is normal there. Play-along also flags "too
  long" once a note is held well past its length.

## Consequences

- The no-distribution rule stays simple to review: no code path writes a library piece, or a
  rendering of it, to a file other than the encrypted backup.
- Learners practising their own pieces cannot keep a recording outside the app. If the maintainer
  wants WAV files for library pieces too, that needs a legal check first (P2-18) and a new ADR.
- Long pieces make large WAV files (about 10 MB a minute, stereo 44.1 kHz) and rendering holds the
  whole buffer in memory; fine for the catalogue's short pieces, worth watching on older iPads.

## Alternatives considered

- **WAV for every piece.** Simplest for learners, but it adds an export path for library items,
  which the guardrails rule out until a lawyer has looked at it.
- **No WAV at all.** Safest, but drops part of the maintainer's request for pieces where it is
  plainly fine.
- **Record the audio output with MediaRecorder.** Real-time only (a three-minute piece takes three
  minutes) and the format differs by browser; offline rendering is faster and gives the same file
  everywhere.
