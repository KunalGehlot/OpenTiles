# OpenTiles — Implementation Plan

This is the working plan for building OpenTiles, the free, open-source piano trainer described in
the [project specification](docs/spec/project-plan.md). The spec says **what** and **why**; this
file says **in which order**, **who picks up what**, and **what is done**.

- Humans and coding agents both work from this file. Read [AGENTS.md](AGENTS.md) before starting.
- Every task has a stable ID (`P1-09`). Use it in branch names, commits and pull requests.
- When you finish a task, tick it here in the same pull request that delivers it.
- When a task turns out to be wrong or too big, edit the plan in a pull request and say why in the
  changelog at the bottom. Don't let the plan drift away from reality.

**Status legend:** `[x]` done · `[~]` in progress / partially done · `[ ]` not started ·
**(human)** needs a person, a device or a decision, not just code.

## Current focus

**Phase 0 — prove microphone recognition on an iPad.** Nothing in later phases matters if the
microphone path fails, so the detector and its test harness come first. The `Song` model, the
practice engine and a minimal web app are being built in parallel because the detector lab and the
gate measurements need them.

## Phases and gates

v1.0 is planned for August 2027 at roughly 8–10 hours a week, with December 2026 kept light. Each
phase ends at a gate. If a gate fails, re-plan the next phase before continuing.

| Phase                     | Window                         | Outcome                                                    | Gate at the end                                                                                      |
| ------------------------- | ------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0 — Feasibility           | Oct 7 – Nov 18, 2026 (6 weeks) | Microphone detector proven (or not) on iPad Safari         | **G0 Go/no-go:** accuracy and latency targets on the recorded test set                               |
| 1 — Core practice loop    | Nov 19, 2026 – Mar 31, 2027    | Journeys A and B work end to end, offline                  | **G1 Alpha:** a beginner can import or pick a piece and practise it in wait mode on iPad and desktop |
| 2 — Catalogue and breadth | Apr – Jun 2027                 | 150 verified pieces, looping, ABC/MuseScore import, backup | **G2 Public beta:** legal guardrails all met, device lab passes                                      |
| 3 — v1.0                  | Jul – Aug 2027                 | iPad MIDI shell, 300 pieces, release hardening             | **G3 v1.0 release:** the definition of success in spec §1 holds                                      |
| 4 — After v1.0            | Sep 2027 →                     | OMR, audio import, courses, community arrangements         | —                                                                                                    |

If **G0** fails, v1.0 becomes MIDI-first and the microphone ships marked as beta (spec §11).

## Workstreams

| Code  | Workstream                                 | Main paths                                     |
| ----- | ------------------------------------------ | ---------------------------------------------- |
| ENG   | Note detection engine (Rust → WebAssembly) | `packages/engine`                              |
| SONG  | `Song` model and importers                 | `packages/song-model`, `packages/importers`    |
| PRAC  | Practice engine (modes, scoring, steps)    | `packages/practice`                            |
| APP   | Web app, views, input, audio, PWA          | `apps/web`                                     |
| CAT   | Public-domain catalogue and pipeline       | `catalogue/`, `tools/pipeline`                 |
| STORE | Local library, backup, encrypted sync      | `apps/web/src/storage`, sync service (phase 3) |
| GOV   | Legal, licences, docs, CI, community       | repo root, `docs/`, `.github/`                 |

---

## Phase 0 — Feasibility (Oct 7 – Nov 18, 2026)

Goal: answer "can the microphone reliably tell whether the expected notes were played, fast enough,
on an iPad in Safari?" before any app polish.

- [~] **P0-02** (human) Working name **OpenTiles** chosen and monorepo created. Still open: domain,
  trademark check, GitHub organisation.
- [x] **P0-03** GOV — Monorepo scaffolding: pnpm + Cargo workspaces, licence, contributor docs,
      ADRs, CI workflow.
- [ ] **P0-04** (human) Record the real test set: 20 short passages on one acoustic and one digital
      piano, captured on an iPad in Safari, with matching MIDI answer keys. Protocol in
      [docs/phase-0/test-set.md](docs/phase-0/test-set.md).
- [x] **P0-05** ENG — AudioWorklet capture into the engine, off the main thread
      (`packages/engine/js`).
- [x] **P0-06** ENG — Rust FFT, spectral-flux onset detector, compiled to a dependency-free
      `wasm32` module with a C ABI (ADR 0002).
- [x] **P0-07** ENG — Expected-note test for single notes and 2–3 note chords, plus the wrong-note
      test (neighbouring semitones and octave errors), with per-mode thresholds.
- [x] **P0-08** ENG — Synthetic piano test set and accuracy harness, run by `cargo test` in CI.
      Synthetic results are a smoke test only; G0 is judged on real recordings.
- [x] **P0-09** ENG — `evaluate` CLI: runs the detector over a WAV recording plus a CSV answer key
      and prints the accuracy report used in the gate report.
- [ ] **P0-10** APP — Detector Lab page: microphone → worklet → detector with live display of
      onsets, accepted and rejected notes, and the recorder used for P0-04.
- [ ] **P0-11** (human) Measure end-to-end latency on an older (A12-class) and a current iPad
      using the Detector Lab latency test.
- [ ] **P0-12** ENG — SIMD build plus non-SIMD fallback, chosen at runtime by feature detection.
- [ ] **P0-13** (human) Calibrate thresholds on the real test set and write the gate report from
      [docs/phase-0/gate-report-template.md](docs/phase-0/gate-report-template.md).

**G0 criteria** (spec §7, §13):

- Wait mode, single notes and 2–3 note chords between C2 and C7: ≥ 95 % of correct notes accepted,
  ≤ 3 % of wrong notes accepted, on the real test set.
- End-to-end microphone feedback latency ≤ 100 ms on the older iPad.
- Detector processing ≤ 2 ms per hop on the older iPad.

## Phase 1 — Core practice loop (Nov 19, 2026 – Mar 31, 2027)

Goal: Journeys A and B from spec §3 work end to end, offline, on iPad Safari and desktop Chrome.

### Song model and import (SONG)

- [x] **P1-01** `Song` model types, tempo map, beats ↔ seconds conversion (ADR 0003).
- [x] **P1-02** MusicXML parser: partwise scores, chords, voices, backup/forward, ties merged,
      staves → hands, fingering, tempo, time and key signatures, pickup bars, repeats with
      first/second endings. (D.C./D.S./coda jumps are not unrolled yet.)
- [x] **P1-03** `.mxl` unzip in the browser.
- [x] **P1-04** Standard MIDI file parser (format 0 and 1), drum channel and non-piano programmes
      dropped unless kept.
- [x] **P1-05** MIDI quantiser: coarsest grid that keeps ≥ 95 % of onsets within ±30 ms.
- [x] **P1-06** MIDI hand split: two tracks → lower average pitch is the left hand; one track →
      split around middle C with smoothing; user-movable split point.
- [ ] **P1-07** Import review screen: swap staves / move split point, base tempo, transpose, trim
      bars, title and tags. (Basic version done: title, tempo, transpose, split point.)

### Practice engine (PRAC)

- [x] **P1-08** `NoteEvent` type and input abstraction shared by MIDI, touch and microphone.
- [x] **P1-09** Wait mode: cursor stops at each step until all expected notes are played; wrong
      notes reported.
- [x] **P1-10** Play-along scoring: hit / early / late / missed with ±75 ms / ±150 ms windows that
      widen at slower tempos and shift by the measured input latency.
- [ ] **P1-11** Listen mode: app plays the piece with cursor and keyboard animated.
- [ ] **P1-12** Hand separation: practise left, right or both; the app can play the other hand.
- [ ] **P1-13** Tempo control 25–150 % with count-in and metronome.

### Views (APP)

- [ ] **P1-14** Animated keyboard, Canvas 2D, expected keys highlighted per hand colour.
- [ ] **P1-15** Scrolling score with Verovio: single staff line under a fixed cursor, each `Song`
      note linked to its glyph for colour feedback.
- [ ] **P1-16** Falling-notes view (Canvas 2D) — the first practice view, and the only one for
      MIDI imports in v1.

### Audio and input (APP)

- [ ] **P1-17** Web Audio sampler with an openly licensed grand piano sample set (check licence);
      small synth fallback. (Synth fallback done.)
- [ ] **P1-18** Audio context started only from a user gesture (Safari).
- [ ] **P1-19** Web MIDI input. Latency measurement and compensation still to do.
- [ ] **P1-20** Microphone input in practice, with the 10-second calibration flow (noise floor,
      harmonic profile, tuning offset).
- [ ] **P1-21** On-screen keyboard: touch, mouse and computer-keyboard keys.

### Storage, app shell and feedback (STORE, APP)

- [ ] **P1-22** Private library in IndexedDB (Dexie); `navigator.storage.persist()` on first
      import; upload-rights confirmation before the first import.
- [ ] **P1-23** PWA: service worker, manifest, full offline practice; Add to Home Screen prompt on
      iPad after the first import.
- [ ] **P1-24** Live feedback (green / red / grey, early / late) and after-run summary (accuracy,
      timing deviation, hardest bars). Live feedback and accuracy done.
- [ ] **P1-25** Progress: per-piece best score, practice minutes per day, streaks.
- [ ] **P1-26** Playwright end-to-end tests on Chromium, Firefox and WebKit in CI.
- [ ] **P1-27** Safari checklist (spec §5): split view, rotation, score usable at ⅓ width.

**G1 criteria:** Journey A and Journey B pass on iPad Safari (microphone) and desktop Chrome (MIDI)
with no account; the app works offline after the first visit; Playwright suite green on all three
engines.

## Phase 2 — Catalogue and breadth (Apr – Jun 2027)

### Catalogue (CAT)

- [x] **P2-01a** Provenance schema, validator with EU-term check, index builder, catalogue CI.
- [ ] **P2-01** PDMX metadata filter: `no_license_conflict` subset, piano-only, rating threshold.
- [ ] **P2-02** EU term check against Wikidata death years (composer and lyricist).
- [ ] **P2-03** Protected-edition exclusion (§§ 70/71 UrhG): only uploader's own CC0
      transcriptions.
- [ ] **P2-04** Automatic file validation: renders, plays, survives a `Song` round trip.
- [ ] **P2-05** Difficulty scoring (PDMX complexity + own measures → 5 levels).
- [ ] **P2-06** Human review workflow: catalogue PR template, `verified: true`, ~10 min per piece.
- [ ] **P2-07** Publish static `.mxl` + JSON index with stable URLs; **150 verified pieces**.

### Practice and import breadth (PRAC, SONG, APP)

- [ ] **P2-08** Loop section: drag across bars, optional tempo increase per clean run.
- [ ] **P2-09** ABC notation import.
- [ ] **P2-10** MuseScore `.mscz` via webmscore, lazy-loaded; confirm licence fits AGPL-3.0 first.
- [ ] **P2-11** Page score view.
- [ ] **P2-12** Fingering display from score marks.

### Storage, accessibility, legal (STORE, APP, GOV)

- [ ] **P2-13** One-tap encrypted backup file (`.zip`) and restore.
- [ ] **P2-14** Translations: English and German.
- [ ] **P2-15** Accessibility: large print, high contrast, left-handed layout, keyboard shortcuts,
      Bluetooth foot-pedal page turn.
- [ ] **P2-16** Licence scanner for third-party dependencies in CI.
- [ ] **P2-17** Privacy policy, Impressum with notice-and-takedown address, records of processing.
- [ ] **P2-18** (human) Legal consultation with a German copyright lawyer (timing is an open
      decision).

**G2 criteria:** 150 verified pieces across 5 levels; every item in
[docs/legal-guardrails.md](docs/legal-guardrails.md) checked; device lab passes on every row of the
compatibility matrix (spec §5).

## Phase 3 — v1.0 (Jul – Aug 2027)

- [ ] **P3-01** Capacitor iPad shell with a Swift CoreMIDI plugin (`NativeMidiInput`), in
      `apps/ios-shell`.
- [ ] **P3-02** (human) Apple Developer Program, free App Store release.
- [ ] **P3-03** Encrypted sync: passkeys / email link, Argon2id-wrapped library key, AES-GCM blobs,
      EU object storage, 250 MB quota, one-step account deletion. (Open decision: v1.0 or right
      after.)
- [ ] **P3-04** Step practice: split into phrases, suggest the next once accuracy passes 90 %.
- [ ] **P3-05** Catalogue to **300 verified pieces** and a difficulty path.
- [ ] **P3-06** (human) Device-lab release checklist on every row of spec §5.
- [ ] **P3-07** (human) Usability test with 5–8 beginners: first piece played in ≤ 2 minutes.
- [ ] **P3-08** Opt-in anonymous crash reports.

**G3 criteria:** the v1.0 definition of success (spec §1) and the success metrics in spec §13.

## Phase 4 — After v1.0

- [ ] **P4-01** PDF / photo import via in-browser optical music recognition (experimental).
- [ ] **P4-02** Audio-recording import via an audio-to-MIDI model, marked approximate.
- [ ] **P4-03** Original courses and lessons.
- [ ] **P4-04** Community CC0 arrangements of public-domain tunes.
- [ ] **P4-05** Teacher features built on stable catalogue links.
- [ ] **P4-06** If the rule-based detector stalls below target: small onset model via ONNX Runtime
      Web.

## Cross-cutting checklists

These are tracked in their own documents and must be green before the gate named.

| Checklist                    | Document                                                                                 | Needed by        |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| Legal guardrails             | [docs/legal-guardrails.md](docs/legal-guardrails.md)                                     | G2 (public beta) |
| Safari / iPad engineering    | [docs/architecture.md#safari-and-ipad-rules](docs/architecture.md#safari-and-ipad-rules) | G1               |
| GDPR and German requirements | [docs/legal-guardrails.md#data-protection](docs/legal-guardrails.md#data-protection)     | G2               |

## Open decisions

Record the outcome as an ADR in `docs/adr/` and tick it here.

- [ ] Domain name and trademark check for "OpenTiles".
- [ ] Encrypted sync in v1.0 or right after.
- [ ] Sign-in: passkeys only, or passkeys plus email link.
- [ ] Timing of the legal consultation: before beta or before v1.0.
- [ ] Individual maintainer or a non-profit association (e.V.) later.
- [ ] Which openly licensed grand piano sample set to ship (licence and size).
- [x] Practice logic lives in its own DOM-free package (`packages/practice`) — ADR 0004.
- [x] Engine exposes a plain C ABI instead of wasm-bindgen glue — ADR 0002.

## Changelog

- **2026-10-07** — Plan created from the project specification. Added `packages/practice` to the
  repository layout (ADR 0004). Split catalogue tooling task P2-01a (schema, validator, CI) out of
  P2-01 because the catalogue CI check is needed from the first piece onwards.
