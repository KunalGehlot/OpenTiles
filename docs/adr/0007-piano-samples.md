# 0007 — Piano sound: Salamander Grand Piano samples, synth as fallback

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P1-17

## Context

The app plays notes for listen mode, accompaniment, count-ins and the on-screen keyboard. Until now
it used a small additive synthesiser, which sounds like an organ more than a piano. The spec asks
for a Web Audio sampler with an openly licensed grand piano (spec §5: sound through Web Audio,
never Web MIDI output). The constraints:

- **Licence.** The samples ship inside an AGPL app and are copied to every user. They must allow
  redistribution and modification, and must not be non-commercial-only or share-alike in a way
  that would bind the code.
- **No third-party requests at runtime** (hard rule 5) and local-first: the samples are served
  from our own origin and the app must still make sound when they are not available.
- **Safari and iPad.** Every browser must decode the format with `decodeAudioData`, including
  older Safari, which has only the callback form. Download size and decoded memory matter on iPad.
- **Timing.** The practice session schedules notes on the audio clock and the Detector Lab
  measures latency, so a note's attack has to start when it is scheduled.

## Decision

1. **Sample set: Salamander Grand Piano V3 by Alexander Holm, CC BY 3.0**, taken from the original
   release on the Internet Archive (SHA-1 checked), not a mirror. CC BY only asks for credit and a
   note of changes, which we give on the About page and in
   `apps/web/public/samples/piano/README.md`, next to the licence text.
2. **A compact subset**, built reproducibly by `tools/samples/build_piano_samples.py`: one velocity
   layer (10 of 16, the release's sample for velocities 73–80), every minor third from A0 to C8
   (30 notes, as recorded), mono, at most 8 s with a fade-out, levels evened out between
   neighbouring samples (up to ±6 dB), VBR MP3. About 1.8 MB in total; about 41 MB once decoded
   at 48 kHz.
3. **Sampler** (`apps/web/src/audio/sampler.ts`): each note plays the nearest sample (at most a
   semitone away) with `playbackRate`; velocity sets gain (square law, about 32 dB from velocity 20
   to 127) and, below the recorded layer, a low-pass filter for a softer tone; release is an
   exponential fade whose length follows the damper (slower in the bass, none above E6);
   at most 64 voices, the oldest released first. The pure maths lives in `samples.ts` and is
   unit-tested.
4. **Onsets measured, not assumed.** MP3 encoders add padding before the audio and browsers differ
   in whether they remove it. After decoding, the sampler finds the attack in each buffer and
   starts playback 1 ms before it. In Chromium a note sounds within about 3 ms of its scheduled
   time (measured); a decoder that keeps the padding is handled the same way.
5. **One instrument object with a fallback.** `synthFor(ctx)` returns a `Piano` that plays the
   additive synth until the samples have loaded and then switches to them; callers keep the same
   object. Loading starts only after a user gesture has unlocked audio (spec §5). If it fails (an
   offline first visit), the synth keeps playing and loading is retried at most every 30 s. The
   count-in click stays an oscillator in both cases, so the latency test is unaffected.

6. **Amended 2026-10-19 (P6-17, the maintainer's Q11: the richer piano by default).** Two more
   layers beside layer 10: layer 5 in `soft/` (velocities 33–40, cut at 5 s) and layer 14 in
   `loud/` (105–112, 8 s), built by the same script (`--layer`, `--max-seconds`); layer 10's
   files are unchanged. Each layer is normalised on its own and the script prints its level; the
   app takes the difference to layer 10 off (`SampleLayer.levelDb`), so loudness still follows
   `velocityGain` and the layer changes only the tone. A note plays with the layer recorded nearest
   its velocity (soft up to 55, layer 10 from 56 to 91, loud from 92), and the low-pass darkens it
   only below that layer. Rendered offline in Chromium, a note one velocity either side of a
   boundary differs from the curve by at most 0.9 dB (C2 to C6), so no crossfade is needed. The
   original set loads first and plays at once; the soft layer, then the loud one, follow and join
   as they arrive. The service worker precaches all three (its glob takes every `.mp3`).

## Consequences

- The practice session and Detector Lab needed no change: `PianoSynth` is now the `Instrument`
  interface both sound sources implement.
- About 1.8 MB is fetched the first time audio starts. The service worker (P1-23) should precache
  `samples/piano/*.mp3` (`sampleFileNames()` lists them) so the piano works offline after the first
  visit; until then the browser's HTTP cache usually covers it.
- One velocity layer means loud and soft notes differ in level and brightness only, not in the
  character a real piano's hammer gives. More layers would multiply size and memory.
- Notes held longer than 8 s fade out early. The samples keep the piano's recorded, stretched
  tuning: the top octave measures roughly 20–60 cents sharp of equal temperament, as is normal
  for a grand.
- Anyone redistributing the app must keep the credit and licence file, which ship in the build
  output next to the samples.

- With the 2026-10-19 layers: about 4.7 MB of samples in all (1.2 MB soft, 1.6 MB loud), and
  about 70 MB more once decoded at 48 kHz (some 110 MB for all three), which matters on an iPad,
  the one device where this piano is what the learner hears through a keyboard's speakers. The
  soft layer is cut at 5 s to keep it smaller.

## Alternatives considered

- **Keep only the additive synth:** no download, but a poor piano sound for a piano trainer.
- **Tone.js's hosted copy of Salamander** (`tonejs.github.io/audio/salamander`): same licence and
  convenient, but it documents neither which velocity layer nor what processing it used, and
  serving from it at runtime would break the no-third-party-requests rule. Building from the
  original release keeps the provenance exact.
- **Other openly licensed pianos:** not evaluated in depth. Salamander was the approved choice; it
  is widely used, covers the full range and states its licence plainly in the release.
- **Ogg Vorbis or Opus:** smaller at the same quality, but older Safari cannot decode them with Web
  Audio. **AAC (.m4a):** also Safari-friendly; MP3 was chosen because every target browser decodes
  it and the free tooling (ffmpeg with LAME) is everywhere.
- **Stereo samples:** about twice the decoded memory for a width few users hear through tablet
  speakers.
- **All 16 velocity layers or longer notes:** hundreds of megabytes; not suitable for a web app
  that must work on iPad.
