# Architecture

OpenTiles is a static, installable web app that does all music processing on the device. The
server side is only a CDN for the app and the public catalogue, plus (from phase 3) an optional
sync service that stores encrypted blobs it cannot read. See spec §6.

## Overview

```mermaid
flowchart LR
  subgraph Device["User's device (browser or iPad shell)"]
    direction LR
    subgraph Inputs
      MIDI["MidiInput<br/>Web MIDI"]
      MIC["MicInput<br/>getUserMedia → AudioWorklet → engine.wasm"]
      TOUCH["TouchInput<br/>on-screen keyboard"]
      NMIDI["NativeMidiInput<br/>CoreMIDI plugin (phase 3)"]
    end
    subgraph Import["Importers (run locally)"]
      MXL["MusicXML / .mxl"]
      SMF["MIDI + quantiser + hand split"]
      MSCZ["MuseScore via webmscore (phase 2)"]
    end
    SONG[("Song model<br/>packages/song-model")]
    PRAC["Practice engine<br/>packages/practice"]
    VIEWS["Views<br/>score · falling notes · keyboard"]
    AUDIO["Web Audio sampler"]
    DB[("IndexedDB (Dexie)<br/>private library + progress")]
    Inputs -- "NoteEvent stream" --> PRAC
    Import --> SONG
    SONG --> PRAC
    PRAC --> VIEWS
    PRAC --> AUDIO
    SONG <--> DB
    PRAC --> DB
  end
  CDN["Static CDN<br/>app + public-domain catalogue"] --> Device
  DB -. "encrypted blobs only (phase 3)" .-> SYNC["Sync API + EU object storage"]
```

Two seams keep the design simple:

- **Every input becomes the same stream of `NoteEvent`s.** Practice modes never know whether a
  note came from MIDI, the microphone or a tap.
- **Every file becomes the same `Song`.** The practice engine and views know one format.

## Packages

| Package               | Responsibility                                                                                  | Depends on              |
| --------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| `packages/song-model` | `Song` types, tempo map, MusicXML and MIDI parsing, quantiser, hand split, transpose            | `fflate` (unzip `.mxl`) |
| `packages/practice`   | `NoteEvent`, practice steps, `WaitMode`, `PlayAlongScorer`, tempo scaling                       | `song-model`            |
| `packages/engine`     | Rust detector compiled to `engine.wasm`; AudioWorklet processor and main-thread loader in `js/` | —                       |
| `packages/importers`  | Heavy, lazy-loaded converters (MuseScore, OMR, audio) — later phases                            | `song-model`            |
| `apps/web`            | React UI, canvas views, Web Audio, Web MIDI, IndexedDB, service worker                          | all of the above        |

`song-model` and `practice` are DOM-free (ADR 0004) so they run in tests, web workers and the iOS
shell unchanged.

## The `Song` model

Defined in `packages/song-model/src/types.ts` (ADR 0003).

- Musical time is in **quarter-note beats** from the start of the (unrolled) piece. Seconds are
  derived from the tempo map, so tempo changes and practice tempo scaling never touch note data.
- Each `SongNote` has `pitch` (MIDI number), `startBeat`, `durationBeats`, `hand`, `staff`,
  `voice`, optional `fingering` and `velocity`, the `measureIndex` it starts in, and a stable `id`.
  Tied notes are merged into one note; the original glyph references are kept in `sourceRefs` so the
  score view can colour every glyph of a tie.
- `measures` lists the playback order of bars after repeats are unrolled, each with its start beat,
  length and the original bar number.
- `tempoMap`, `timeSignatures` and `keySignatures` are beat-indexed event lists.

## The practice engine

- `buildSteps(song, { hands })` groups notes that start together into **steps** (chords).
- `WaitMode` holds the cursor at a step until every expected pitch has been played; it reports
  correct and wrong notes so the UI can colour them.
- `PlayAlongScorer` matches `NoteEvent`s against expected onsets: ±75 ms on time, ±150 ms early or
  late, otherwise missed. Windows widen at slower practice tempos and shift by the measured input
  latency.

## The note-detection engine

The microphone path is the riskiest part of the project (spec §7, §13), so it is built first
(Phase 0).

```text
mic ─▶ AudioWorklet (128-sample blocks) ─▶ engine.wasm
          │                                    ├─ ring buffer
          │                                    ├─ 2048-pt FFT every hop (~5 ms) → spectral flux
          │                                    ├─ adaptive-threshold peak picking → onsets
          │  expected pitches ◀── main thread   ├─ at each onset, after a short settle delay:
          │                                    │    expected-note test (harmonic score of partials,
          │                                    │    piano inharmonicity, local noise floor, novelty)
          │                                    │    wrong-note test (±1, ±2 semitones, ±12)
          ▼                                    └─ events → NoteEvent { pitch, time, confidence }
     main thread (practice engine)
```

Design rules:

- **Score-informed, not a transcriber.** The detector is told which pitches are expected next and
  only tests those plus a short list of likely mistakes (±1, ±2 semitones, ±12).
- **Harmonic evidence.** For a candidate pitch, the first 8 partials (12 for bass notes) are
  predicted with piano inharmonicity `fₙ = n·f₀·√(1 + B·n²)` and looked up in the post-onset
  spectrum. Each partial is rated by `match × level × freshness`: how close the nearest peak is to
  the prediction, how far it stands above the local floor, and how much louder it is than the
  loudest of three frames just before the onset. A second view, the power-difference spectrum
  (post minus twice the pre-onset maximum), catches new partials hidden next to louder ringing
  ones under the pedal; each partial keeps the better of the two.
- **Odd partials decide octaves.** A pitch's score is the geometric mean of the evidence over all
  partials and over its odd partials, which the octave above cannot supply. Partials that another
  expected note explains count less. If the octave _below_ shows fresh odd-partial energy, it was
  played: it is reported as a wrong note and the expected note is not accepted at that onset.
- **Freshness, not presence.** A note still ringing under the sustain pedal, or brightening as its
  strings beat, has little fresh energy, so it is neither re-accepted nor mistaken for a wrong note.
- **Two resolutions.** Pitches below C3 are evaluated on a 4096-sample window 66 ms after the
  onset; everything else on 2048 samples 36 ms after it.
- **Per-mode thresholds.** Wait mode errs towards accepting; play-along towards precision.
- **No allocation on the audio path; no JS imports.** The wasm module exports a C ABI and is
  instantiated inside the AudioWorklet from a `WebAssembly.Module` compiled on the main thread
  (ADR 0002).

Known weak spot: bass notes under heavy pedal (see the synthetic results below and P0-13).

Accuracy is measured by `cargo test` on a synthetic piano test set (smoke test) and by the
`evaluate` CLI on real recordings (gate). See [phase-0/test-set.md](phase-0/test-set.md).

Synthetic results at the time of writing (`cargo test --release -p opentiles-engine --test
synthetic_accuracy -- --nocapture`), single notes and 2–3 note chords between C2 and C7:

| Scenario                               | Correct notes accepted | Wrong notes accepted |
| -------------------------------------- | ---------------------- | -------------------- |
| Wait mode, no pedal, 48 kHz            | 98.3 %                 | 1.3 %                |
| Wait mode, heavy sustain pedal, 48 kHz | 87.8 %                 | 2.5 %                |
| Play-along mode, no pedal, 44.1 kHz    | 92.0 %                 | 0.2 %                |

Median decision latency is about 40 ms after the true onset (66 ms for notes below C3). These
numbers come from a synthesiser, not a piano in a room; the G0 gate is judged on real recordings.

## Storage

- **Private library:** IndexedDB via Dexie — original file bytes, the parsed `Song`, practice
  settings and progress. `navigator.storage.persist()` is requested on first import.
- **Backup (phase 2):** an encrypted `.zip` the user keeps.
- **Sync (phase 3):** a random 256-bit library key, wrapped with an Argon2id-derived key from the
  user's passphrase; every record (including titles) encrypted with AES-GCM before upload. The
  server sees only account email, blob count and size, and timestamps.

## Safari and iPad rules

These come from spec §5. Every item must hold before G1. A ticked item is done in code and, where
a desktop browser can show it, covered by the Playwright suite; each one still gets checked on
real devices in the device lab before a release.

- [~] Create or resume the `AudioContext` only from a user tap (`unlockAudio()` in
  `apps/web/src/audio/context.ts`, P1-18). Left: a visible "Tap to start" state while audio is
  still locked.
- [x] Request the microphone with `echoCancellation: false`, `noiseSuppression: false`,
      `autoGainControl: false` (`packages/engine/js/mic-detector.ts`).
- [x] Feature-detect Web MIDI; never show a broken MIDI option on WebKit (`midiSupported()`; the
      practice bar says MIDI is not available instead).
- [x] Handle split view and rotation; keep practice usable at ⅓ iPad width (P1-27). Below 640 px
      wide or 520 px high the practice bars turn compact (one-row top bar, smaller controls that
      wrap, secondary hints hidden), the canvas takes the rest of the height, the on-screen
      keyboard never takes more than 40 % of it, and the canvas keeps clear of the home indicator
      and notch (`env(safe-area-inset-*)`). No page scrolls sideways at 320 px.
      `apps/web/e2e/layout.spec.ts` checks every page at 320 × 768, practice at 320 × 768, and
      resizing 1180 × 820 → 820 × 1180 → 375 × 820 → 820 × 375 with a key tap after each step.
      Still needs a real iPad: Split View and Slide Over at ⅓ and ½ width, Stage Manager windows,
      rotating mid-run, taps near the home indicator in a Home Screen app. The scrolling score
      (P1-15) must pass the same ⅓-width check when it lands. At 320 px the on-screen keyboard's
      white keys are 11–21 px wide, depending on the piece's range (two to four octaves): they
      register taps, but MIDI or the microphone are the better inputs there.
- [ ] Ship a WebAssembly SIMD build and a non-SIMD fallback (P0-12).
- [ ] Sound playback uses a Web Audio sampler, never Web MIDI output. (Playback is Web Audio
      today, with a synthesiser; the sampler is P1-17.)
- [x] Request persistent storage on first import and prompt iPad users to Add to Home Screen
      (Safari can delete script-written data after seven days without a visit). `persist()` runs
      on first import; the Library shows the hint after an import and the Home page shows a
      dismissible hint to iPad and iPhone users in a browser tab (dismissal kept in
      `localStorage`).
- [x] Work fully offline after the first visit and install as an app (P1-23). See below. Still
      needs a real device: Add to Home Screen from Safari's Share menu, launch from the Home Screen
      in flight mode, practise a catalogue piece and a library piece, and confirm the library is
      still there after more than seven days without opening Safari.
- [ ] Device lab before each release: older iPad (A12-class), current iPad, iPhone, Android tablet,
      low-end Windows laptop.

### Offline and installation

`vite-plugin-pwa` (Workbox `generateSW`, configured in `apps/web/vite.config.ts`) builds the web
app manifest and a service worker that precaches everything a practice session needs on the first
visit: the app shell, the engine `.wasm` and its AudioWorklet, the catalogue index and scores, and
the piano samples in `apps/web/public/samples/piano/`. The private library is in IndexedDB, not
in the cache. The worker takes control of the first page at once (`clientsClaim`) so a tab that
goes offline without reloading can still open catalogue pieces, but an update never activates by
itself: `apps/web/src/pwa/` shows a small "Update available" bar with Reload and Dismiss, so a
practice run is never interrupted. While the app is open it looks for a new version when it
returns to the foreground, at most hourly, and only on its own origin. App icons are rendered from
`public/icon.svg` by `pnpm --filter @opentiles/web icons`; iOS uses the full-bleed 180 px
`apple-touch-icon.png`.

## Deviations from the spec's repository layout

- `packages/practice` was added for the practice engine (ADR 0004).
- `packages/engine` also holds the AudioWorklet processor and loader (`js/`) so the wasm module and
  the code that drives it are versioned together.
