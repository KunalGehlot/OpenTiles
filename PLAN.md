# OpenTiles — Implementation Plan

This is the working plan for building OpenTiles, the free, open-source piano trainer described in
the [project specification](docs/spec/project-plan.md). The spec says **what** and **why**; this
file says **in which order**, **who picks up what**, and **what is done**.

- Everyone works from this file. Read the [development guide](docs/development.md) before starting.
- Every task has a stable ID (`P1-09`). Use it in branch names, commits and pull requests.
- When you finish a task, tick it here in the same pull request that delivers it.
- When a task turns out to be wrong or too big, edit the plan in a pull request and say why in the
  changelog at the bottom. Don't let the plan drift away from reality.

**Status legend:** `[x]` done · `[~]` in progress / partially done · `[ ]` not started ·
**(human)** needs a person, a device or a decision, not just code.

## Current focus

**Release preparation (October 2026).** The code covers most of Phases 1 to 4: practice modes, falling
notes and score views with scrubbing, MIDI in and out (Chrome, Edge, Firefox; the iPad app builds), the
microphone detector, imports, an 81-piece verified catalogue, English and German, encrypted backup and
sync, and release hardening. What is left is mostly human work and gates:

- **G0, the microphone gate:** record the test set on real pianos (P0-04), measure latency on iPads
  (P0-11), tune and write the gate report (P0-13).
- **Legal and publishing:** the legal consultation (P2-18) and the trademark. The site deploys to GitHub Pages at opentiles.site (P5-11, ADR 0016).
- **iPad app:** install on an iPad and test with a keyboard (P3-01); App Store (P3-02).
- **Code still open:** MIDI out and Bluetooth MIDI pairing in the iPad app, the sustain pedal, frame time
  on an older iPad, a native speaker's read-through of the German, more catalogue pieces (P3-05).

The task list for this round is [Phase 5 — Release polish](#phase-5--release-polish-from-2026-10-09).
P5-01 to P5-05 and P5-07 are in `main` (merged 2026-10-10); left are P5-06 (free play), P5-09 (the
smoothness pass with the maintainer), P5-10 (the human release gate) and P5-11 (going live on
opentiles.site). The repository is public; the maintainer decided not to recreate it (P5-00).

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
- [x] **P0-10** APP — Detector Lab page: microphone → worklet → detector with live display of
      onsets, accepted, rejected and wrong notes; thresholds, noise and tuning calibration, the
      WAV recorder for P0-04, a speaker-click latency test for P0-11 and a speed benchmark.
- [ ] **P0-11** (human) Measure end-to-end latency on an older (A12-class) and a current iPad
      using the Detector Lab latency test.
- [x] **P0-12** ENG — SIMD build plus non-SIMD fallback, chosen at runtime by feature detection.
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
- [~] **P1-07** Import review screen: swap staves / move split point, base tempo, transpose, trim
  bars, title and tags. Done: title, tempo, transpose, swap hands, MIDI split point. Left:
  trim bars and tags in the UI (`trimMeasures` exists in song-model).

### Practice engine (PRAC)

- [x] **P1-08** `NoteEvent` type and input abstraction shared by MIDI, touch and microphone.
- [x] **P1-09** Wait mode: cursor stops at each step until all expected notes are played; wrong
      notes reported.
- [x] **P1-10** Play-along scoring: hit / early / late / missed with ±75 ms / ±150 ms windows that
      widen at slower tempos and shift by the measured input latency.
- [x] **P1-11** Listen mode: app plays the piece with cursor and keyboard animated.
- [x] **P1-12** Hand separation: practise left, right or both; the app can play the other hand.
- [x] **P1-13** Tempo control 25–150 % with count-in and metronome. Done: tempo slider,
      count-in clicks. Left: metronome during practice.

### Views (APP)

- [x] **P1-14** Animated keyboard, Canvas 2D, expected keys highlighted per hand colour.
- [x] **P1-15** Scrolling score with Verovio: single staff line under a fixed cursor, each `Song`
      note linked to its glyph for colour feedback.
- [x] **P1-16** Falling-notes view (Canvas 2D) — the first practice view, and the only one for
      MIDI imports in v1.

### Audio and input (APP)

- [x] **P1-17** Web Audio sampler with an openly licensed grand piano sample set (check licence);
      small synth fallback. Done: additive synth fallback. Left: choose and load a sample set.
- [x] **P1-18** Audio context started only from a user gesture (Safari).
- [x] **P1-19** Web MIDI input with latency compensation. Done: input via Web MIDI with event
      timestamps mapped to the audio clock, feature-detected. Left: measure and compensate latency.
- [~] **P1-20** Microphone input in practice, with the 10-second calibration flow (noise floor,
  harmonic profile, tuning offset). Done: guided set-up on first microphone use (room noise, three keys, tuning, optional click latency), stored per microphone. Left: harmonic profile; check on a real piano.
- [x] **P1-21** On-screen keyboard: touch, mouse and computer-keyboard keys.

### Storage, app shell and feedback (STORE, APP)

- [x] **P1-22** Private library in IndexedDB (Dexie); `navigator.storage.persist()` on first
      import; upload-rights confirmation before the first import.
- [x] **P1-23** PWA: service worker, manifest, full offline practice; Add to Home Screen prompt on
      iPad after the first import.
- [x] **P1-24** Live feedback (green / red / grey, early / late) and after-run summary (accuracy,
      timing deviation, hardest bars). Done: key and note colours, summary with accuracy, timing
      and hardest bars. Left: early/late shown live, hardest bars marked on the score (needs
      P1-15).
- [x] **P1-25** Progress: per-piece best score, practice minutes per day, streaks.
- [~] **P1-26** Playwright end-to-end tests on Chromium, Firefox and WebKit in CI. Done: suite
  and CI job for Chromium, Firefox, WebKit and an iPad profile; passing on Chromium. Left:
  confirm Firefox and WebKit runs in CI.
- [~] **P1-27** Safari checklist (spec §5): split view, rotation, score usable at ⅓ width. Done: compact layout at 320–400 px, rotation, score views at ⅓ width, covered by Chromium e2e. Left: real iPad Split View / Slide Over check.

**G1 criteria:** Journey A and Journey B pass on iPad Safari (microphone) and desktop Chrome (MIDI)
with no account; the app works offline after the first visit; Playwright suite green on all three
engines.

## Phase 2 — Catalogue and breadth (Apr – Jun 2027)

### Catalogue (CAT)

- [x] **P2-01a** Provenance schema, validator with EU-term check, index builder, catalogue CI.
- [x] **P2-01** PDMX metadata filter: `no_license_conflict` subset, piano-only, rating threshold.
- [x] **P2-02** EU term check against Wikidata death years (composer and lyricist).
- [x] **P2-03** Protected-edition exclusion (§§ 70/71 UrhG): only uploader's own CC0
      transcriptions.
- [~] **P2-04** Automatic file validation: renders, plays, survives a `Song` round trip. Done: XML and musical sanity checks in the validator, Song round trip in the song-model tests. Left: render check with Verovio in CI.
- [~] **P2-05** Difficulty scoring (PDMX complexity + own measures → 5 levels). Done: estimateDifficulty in song-model, shown on the import review screen, within ±1 of the catalogue levels. Left: combine with PDMX complexity in the pipeline.
- [~] **P2-06** Human review workflow: catalogue PR template, `verified: true`, ~10 min per piece.
- [~] **P2-07** Publish static `.mxl` + JSON index with stable URLs; **150 verified pieces**. Done: 31 CC0 arrangements and the PDMX/Wikidata/edition pipeline. Left: human review (all are `verified: false`) and growth to 150.

### Practice and import breadth (PRAC, SONG, APP)

- [x] **P2-08** Loop section: drag across bars, optional tempo increase per clean run.
- [x] **P2-09** ABC notation import.
- [x] **P2-10** MuseScore `.mscz` via webmscore, lazy-loaded; confirm licence fits AGPL-3.0 first.
- [x] **P2-11** Page score view.
- [x] **P2-12** Fingering display from score marks. Done: numbers on falling notes. Left: in the
      score views.

### Storage, accessibility, legal (STORE, APP, GOV)

- [x] **P2-13** One-tap encrypted backup file (`.zip`) and restore.
- [x] **P2-14** Translations: English and German. Done 2026-10-09 (ADR 0014): every screen, canvas
      label and import message in German (about 430 strings), a first visit follows the browser's
      language, German note names on the falling notes; a unit test fails on any untranslated string.
      Left: a native speaker's read-through.
- [~] **P2-15** Accessibility: large print, high contrast, left-handed layout, keyboard shortcuts,
  Bluetooth foot-pedal page turn. Done: settings for large print, high contrast, left-handed controls, reduced motion, shortcuts list, pedal key. Left: practice view reading the left-handed flag beyond CSS; pedal hook wired to the page score.
- [x] **P2-16** Licence scanner for third-party dependencies in CI.
- [~] **P2-17** Privacy policy, Impressum with notice-and-takedown address, records of processing. Done: privacy policy and Impressum (EN/DE), records of processing; the postal address is the maintainer's own Impressum at gehlot.site, linked rather than repeated (2026-10-10). Left: lawyer review (P2-18).
- [ ] **P2-18** (human) Legal consultation with a German copyright lawyer (timing is an open
      decision). Also ask: Bella Ciao (P4-14), the LLM disclosure and the Sightread credit wording
      (P5-01), and whether MIDI export of a user's own free-play recording breaks guardrail 1 (P5-06).

**G2 criteria:** 150 verified pieces across 5 levels; every item in
[docs/legal-guardrails.md](docs/legal-guardrails.md) checked; device lab passes on every row of the
compatibility matrix (spec §5).

## Phase 3 — v1.0 (Jul – Aug 2027)

- [~] **P3-01** Capacitor iPad shell with a Swift CoreMIDI plugin (`NativeMidiInput`), in
  `apps/ios-shell`. Done: Capacitor 8 shell, Swift CoreMIDI plugin, NativeMidiInput; the app
  builds with Xcode 27 (2026-10-09). Left: install on an iPad and test with a keyboard (the
  first-build checklist in the app's README), the plugin tests on a simulator.
- [ ] **P3-02** (human) Apple Developer Program, free App Store release.
- [~] **P3-03** Encrypted sync: passkeys / email link, Argon2id-wrapped library key, AES-GCM blobs,
  EU object storage, 250 MB quota, one-step account deletion. (Open decision: v1.0 or right
  after.) Done: vault, sync client, sync API server (passkeys + email link, quota, deletion) and the Settings UI, tested in-process. Left: deploy to EU storage, test with real passkeys.
- [x] **P3-04** Step practice: split into phrases, suggest the next once accuracy passes 90 %.
- [~] **P3-05** Catalogue to **300 verified pieces** and a difficulty path. Done: difficulty path on the Home page with progress per level. Left: 300 verified pieces.
- [ ] **P3-06** (human) Device-lab release checklist on every row of spec §5.
- [ ] **P3-07** (human) Usability test with 5–8 beginners: first piece played in ≤ 2 minutes.
- [x] **P3-08** Opt-in anonymous crash reports.

**G3 criteria:** the v1.0 definition of success (spec §1) and the success metrics in spec §13.

## Phase 4 — After v1.0

- [ ] **P4-01** PDF / photo import via in-browser optical music recognition (experimental).
- [x] **P4-02** Audio-recording import via an audio-to-MIDI model, marked approximate.
- [ ] **P4-03** Original courses and lessons.
- [~] **P4-04** Community CC0 arrangements of public-domain tunes. Done: arrange.py and the catalogue PR template for CC0 contributions.
- [~] **P4-05** Teacher features built on stable catalogue links. Done: "Copy link" for catalogue pieces (never library items). Left: other teacher features.
- [x] **P4-07** Keyboard size: presets (25–88 keys) and custom (lowest key + number of keys, e.g.
      86), the learner's real keyboard drawn, pieces fitted by octaves. Done: logic in
      `packages/practice/src/keyboard-size.ts`; "Your keyboard" in Settings and a Keys picker in the
      practice bar; the practice canvas draws exactly those keys and says when a piece was moved.
- [x] **P4-08** Fingering for every note from piano fingering practice. Done: Viterbi fingering in
      `packages/practice/src/fingering.ts` (keeps written fingering); fingers on falling notes, on the
      keys to play next and, lighter, in the score views; Settings and practice bar choose suggested,
      written only, or none.
- [~] **P4-09** Timing teacher: when to press and how long to hold, with feedback, and a
  good-sounding playback of the learner's run (as played and polished) plus WAV download.
  Done: `packages/practice/src/performance.ts` (recorder, hold judging, polished render); held keys
  drain over the note's length, "hold longer" / "let go" labels and a hold count in the summary
  (MIDI and on-screen keys; the microphone cannot see key release); every run is recorded and
  can be heard back as played or polished; WAV rendered offline, for catalogue pieces only
  (ADR 0010, accepted 2026-10-09: WAV files for catalogue pieces only). Left: a manual check on
  an iPad.
- [~] **P4-10** UI redesign: a proper visual system (type, spacing, colour, icons), refined
  practice screen and canvas, better Home and Library. Done: design tokens in light, dark and high
  contrast with a contrast test (`apps/web/src/styles/`, ADR 0011); system fonts,
  restyled native controls, `lucide-react` icons; a new Home (hero, "continue" card, path),
  Library, Settings and About; a slim practice header with an Options panel, quiet control rows and
  icon-only secondary buttons at ⅓ width; a new canvas (tiles, bar numbers, shaded black-key lanes,
  key bloom, larger finger numbers) and end-of-run ring; several review rounds with the maintainer
  (2026-10-08 and 09). Left: the next polish round is P5-09 (manual light/dark switch, logo,
  Detector Lab, 44 px touch targets); an iPad check including frame time on an older iPad (P5-10).
- [x] **P4-11** Smooth motion and a sensible falling-notes layout on wide windows. Done: a steady
      drawing clock nudged toward the audio clock, time-based wait-mode easing, white keys capped at
      64 px with more octaves shown on wide windows (ADR 0012). Left: frame time on an older
      iPad (not measured).
- [x] **P4-12** Score views (the maintainer's feedback of 2026-10-08). Done: the cursor glides over bar lines
      (test), the score returns to its start a second after a run (page view: page 1), the scrolling
      score has no scroll bar and can be dragged or swiped with coasting, the play bar stays in the
      middle (ADR 0009 decision 5 superseded by ADR 0012), the page view is a centred page, not
      stretched, and the score is larger on big windows. Left: a check on an iPad (WebKit is covered by
      the Playwright runs).
- [~] **P4-13** Several levels per song and more pieces (ADR 0012).
  Done: optional `song` and `variant` fields in schema, validator and index; Home links the other
  levels under a card; 19 melody levels, "Ode to Joy (full tune)" and "Happy Birthday to You",
  verified after the music review (P4-13c). Left: longer pieces and more songs (PDMX pipeline or
  exact hand transcriptions), a third level for more songs.
- [~] **P4-13b** Famous public-domain pieces at scale (2026-10-09). Done: `tools/pipeline/midi_arrange.py`
  turns a public-domain Mutopia Project typesetting (MIDI) into an `arrange.py` arrangement with one
  voice per hand; 27 pieces added (Bach inventions, minuets and Musette; Für Elise, The
  Entertainer, Maple Leaf Rag, Tchaikovsky and Schumann children's pieces, Burgmüller, a Chopin
  prelude and waltz, two Beethoven minuets), 79 in all, each with its print and year recorded
  (`print_source`, refused when undated or from 1930 on); pieces whose source page gave no date
  (the Gymnopédies, Rondo alla Turca, three Chopin preludes, Mozart K. 331, Schubert's Marche
  militaire, Prelude in C) were left out until a dated source is found; difficulty from the
  estimator; verified after the music review (P4-13c). Left: a third level for more songs, the
  undated pieces above, pieces whose ornaments matter (the converter leaves grace notes out and
  refuses rubato; thirty-seconds and triplets work with `--fine` since P4-13c).
- [x] **P4-14** Bella Ciao (maintainer's request). Added 2026-10-09 at two levels (melody, two hands):
      an own CC0 arrangement of the melody as set CC0 by Peter Gerloff on Wikimedia Commons. The origin of
      the tune is disputed (linked to a 1919 recording by Mishka Ziganoff, who died in 1967), which the
      provenance says plainly. The maintainer accepted it as traditional and verified it on 2026-10-09;
      revisit after the legal consultation (P2-18).
- [x] **P4-13c** Music review of the whole catalogue (2026-10-09,
      `catalogue/reviews/2026-10-09-music-review.md`): an automated review against public-domain scores and
      the Mutopia MIDI; 18 pieces corrected (wrong notes in Amazing Grace, rhythms in Brahms' Lullaby and
      the Largo, an invented left hand in Mountain King, titles of Consolation and WoO 82, …). Thirty-seconds
      and triplets added to arrange.py and the converter, so Invention 14 and Für Elise are complete;
      da capos written out for WoO 82 and the Musette. All 81 pieces verified by the maintainer
      (KunalGehlot, 2026-10-09) on the basis of this review.
- [x] **P4-19** MIDI keyboard settings (2026-10-09): play the keys pressed on a MIDI keyboard on this
      device too (for keyboards without speakers or for headphones), and play the app's notes
      (listen mode, the other hand, listening back) on this device, the keyboard's own sound or both,
      through MIDI out; a choice of output when there are several; a live keyboard test in Settings.
      Firefox messages now cover its two real limits (no hot-plugging; the site permission add-on
      off localhost). Confirmed working in Firefox by the maintainer (2026-10-09). Left: MIDI out from
      the iPad app (CoreMIDI send), the sustain pedal, a choice of audio output device.
- [x] **P4-18** Scrubbing in the scrolling score (2026-10-09): the play bar stays in the middle and a
      drag (or a sideways trackpad scroll) moves the whole piece under it, back and forth; the
      score, cursor and falling notes follow, a playing run pauses and Play starts from there, wait
      mode moves to the step at that place. Tests: unit (inverse cursor map, session seek) and
      Playwright in Chromium and WebKit.
- [x] **P4-15** Release hardening (2026-10-09, ADR 0013). Done: Content-Security-Policy (meta tag in
      the build and `public/_headers`), SVG sanitiser for engraved scores, zip and file size limits,
      an error boundary, storage that survives a blocked IndexedDB (localStorage copy), ordered saves,
      persistent storage requested on a settings change, `uuid` audit finding fixed, build warning
      removed. Left: a real deployment (docs/deploying.md), a pen test, a check on WebKit and an iPad.
- [x] **P4-17** "Find sheet music" page (2026-10-09): where to get free (public-domain, openly
      licensed) and licensed sheet music in formats OpenTiles opens, with plain outside links only.
      Downloaders that get round a paywall and collections of unlicensed arrangements are left out
      on purpose (legal guardrails).
- [x] **P4-16** Learner features (2026-10-09). Done: search in the piece list and the library
      (accents ignored); note names on the falling notes (setting, default on); practice choices
      (mode, hands, tempo, accompany, metronome and volume) remembered on this device; played notes keep
      their hand colour (an early or late note gets an amber edge, not an amber fill). Tests: unit and
      Playwright (`e2e/release.spec.ts`, two scroll-back tests in `e2e/score.spec.ts`).
- [ ] **P4-06** If the rule-based detector stalls below target: small onset model via ONNX Runtime
      Web.

## Phase 5 — Release polish (from 2026-10-09)

Goal: the final round before release. Smoother and richer practice, credit where it is due, and the
human items that block going public. Planned with the maintainer on 2026-10-09 after comparing
OpenTiles with [Sightread](https://github.com/sightread/sightread) (GPL-3.0). Rule for every task
here: build from a description of what a feature does, never from another project's code, songs,
images, sounds or fonts, and credit the inspiration in [CREDITS.md](CREDITS.md).

- [x] **P5-01** (GOV) Credit and disclosure. Done: README section, About page (English and German),
      `CREDITS.md`, a short "Using AI tools" section in `docs/development.md`. The comparison found no
      shared code (0 matching four-line windows in `apps/web` and the TypeScript packages; only
      `#000000` as a shared colour). Sightread is GPL-3.0 (GitHub and its LICENSE file; no "or later"
      notice), OpenTiles is AGPL-3.0-or-later; GPLv3 §13 / AGPLv3 §13 allow combining, and nothing has
      been taken. Wording uses "an LLM" and names no vendor. Left: ask in P2-18.
- [x] **P5-00** (GOV) Housekeeping that blocks release: push `P4-10-ui-redesign` and open the PR; fix
      the Firefox and iPad-profile Playwright failures in CI; delete and recreate the GitHub
      repository before it is made public (see STATE.md). Done: the branch went in through PR #1,
      merged into `main` on 2026-10-10 together with the Phase 5 pull requests (#2 to #6);
      WebKit and the iPad profile pass in CI. The Firefox failures had two causes in the app, both
      fixed: the first import waited for Firefox's storage-permission prompt, and a sound device
      that never starts (as on the Linux runner) froze the metronome, runs and the falling notes.
      Recreating the repository was dropped on 2026-10-10: the maintainer keeps the old history, and
      the repository is public.
- [x] **P5-02** (APP) Keep the screen awake while practising (Screen Wake Lock API, requested from a
      user gesture, released on pause, hidden tab or leaving the page; no error where it is missing).
      Done: held while a run plays and for five minutes after the last note, tap or key press (a
      learner in wait mode may think for a while between notes, so "pause" is idle time there),
      asked for again when the tab is visible again, released on leaving. Left: check on a real
      iPad (P5-10).
- [x] **P5-03** (APP) Note labels: letters, German names (H instead of B), Fixed-Do; one setting that
      the falling notes, the keyboard and the score fingerings share. Done: Settings → Fingering →
      "How note names are written" (as the language, letters, German, Fixed-Do). It names the
      falling notes, the keys to play next (below their finger, where there is room), the octave
      labels on the keyboard, and notes in the Settings, library and microphone texts. The score
      views have no note names to change; the Detector Lab keeps scientific names.
- [x] **P5-04** (APP, SONG) Shift the piece by semitones during practice and choose sharps or flats for
      the labels. Today transposing exists only at import. The score views re-engrave, fingering is
      recomputed. Done: Options → Transpose (− / +, an octave either way, never past the piano's
      keys, so no note is dropped) and Black keys (as the key, sharps, flats; also in Settings). The
      screen says "Transposed up 2 semitones."; Verovio engraves the score in the new key. Left: the
      shift is not remembered between visits; at ±6 semitones the song's key becomes F♯ where
      Verovio engraves G♭, so with "as the key" the falling notes and the score spell it differently.
- [~] **P5-05** (APP, PRAC) Sight-reading drills (the "Speed" and "Infinite" ideas): random notes or
  generated phrases on a staff, with clef, key signature, letters on/off and a speed readout. Works
  with MIDI, microphone and the on-screen keyboard through the usual `NoteEvent` stream. Material is
  generated in code, so it is CC0 by construction. Needs an ADR for the generator and the scoring.
  Done: ADR 0015 (proposed); a "Sight-reading" page (clef, key, range, single notes or phrases, note
  names under the notes, the key to press, endless); drills open in the practice screen with no
  falling notes or lit keys, and end with notes a minute and the share right at the first try.
  Left: the maintainer's decision on ADR 0015; rhythm reading and accidentals beyond the key.
- [ ] **P5-06** (APP) Free play with recording and listen-back, using the existing sampler and the
      performance recorder. Saving the recording as a MIDI file for the user's own device needs an
      ADR first (guardrail 1: the only export is the encrypted backup; ADR 0010 limits WAV files to
      catalogue pieces) and a question to the lawyer in P2-18.
- [x] **P5-07** (APP) A slim live stats strip (perfect, good, missed, streak; off by default) and an
      overview strip of the whole piece with loop handles and the hardest bars. Check first what
      `SectionBar` and `loop-drag` already cover. Done: Options → "Live stats" (off by default:
      perfect, good, missed, wrong, streak and best streak; `LiveTally` in `packages/practice`) and
      "Overview of the piece" (on; a picture of the notes, the position, the hardest bars after a
      run; tap a bar to go there, drag to loop bars, a handle on each end of the loop that also
      moves with the arrow keys). It uses the session's own loop and seek, so the loop controls,
      the canvas drag and the strip always agree. Hidden in short landscape windows.
- [ ] **P5-08** (APP) Library preview before opening and collections. Not selected for this round.
- [~] **P5-09** (APP) Smoothness pass, reviewed together in the maintainer's dark-mode Chrome: home to
  playing in two clicks, one transport bar, route and panel transitions, 44 px touch targets on
  coarse pointers, a manual light/dark switch, a refreshed logo, Detector Lab polish.
  Done (2026-10-10, from the maintainer's report): after a run the position glides back to
  the start the way a drag of the score moves it (the score, the play bar and the falling
  notes together; it used to slide the score alone and then jump), and the first note waits
  under the play bar from the start, so Play no longer jumps; under Reduce motion it jumps
  straight back. Every key press, and every note the piece plays in listen and play-along,
  dips its key for a moment, so a repeated note shows as a new press while the key stays lit.
  Left: everything else on the list, and checking both changes in the maintainer's Chrome.
- [ ] **P5-10** (human) Release gate: frame time on an older iPad, a MIDI keyboard on an iPad through
      the iPad app (Safari has no Web MIDI; Firefox confirmed working 2026-10-09), legal consultation (P2-18), trademark (the domain
      opentiles.site was registered on 2026-10-10), a native German read-through, README
      screenshots from CC0 pieces only.
- [~] **P5-11** (GOV, APP) Publish the web app at opentiles.site on GitHub Pages (ADR 0016,
  proposed). Done: a `deploy` job in CI that publishes `main` once every check passes; the app
  refuses to run inside a frame (Pages cannot send `frame-ancestors`); `connect-src 'self'`; the
  privacy policy (English and German) names GitHub Pages and the transfer basis, and mentions
  sync and crash reports only in a build with a sync server, which the public site has not; the
  same goes for the crash-report setting; records of processing §1 and `docs/deploying.md` updated;
  the Impressum links the maintainer's own at gehlot.site for the postal address; Pages enabled
  with the domain `opentiles.site` set (2026-10-10). Left: the DNS at Cloudflare ("DNS only", no
  parking record) and the domain verification, the first deploy, HTTPS enforced and a header
  check of the live site, and the lawyer's view of hosting in the USA (P2-18).
- [~] **P5-12** (APP) A MIDI keyboard in Firefox stays connected. Reason (maintainer's report,
  2026-10-10): in Firefox the keyboard worked for a while, then fell silent after moving around the
  site, and then "Firefox found no MIDI keyboard" until Firefox was restarted. Each screen asked for
  its own MIDI access and dropped it on leaving; Firefox closes a device for the whole page when any
  access's ports are garbage-collected, and once the last access is gone it stops its MIDI service,
  whose CoreMIDI client on a Mac may not come back until Firefox restarts. Done: one MIDI access
  for the page, shared by every screen with listeners, ports never closed. Second report
  (2026-10-10, "doesn't connect in Chrome either"): Chrome and Firefox ask for permission per site
  and port, and the request waits until the learner answers; the app showed nothing meanwhile, and
  the shared request kept a waiting one, so Connect never showed the prompt again. Now Connect
  asks again until access is granted, says it is waiting and where to allow MIDI. Checked with a
  virtual CoreMIDI keyboard in real Chrome and in Playwright's Firefox (prompts auto-accepted):
  notes reach Settings and wait mode on every screen. Third report (2026-10-11): in Firefox
  practice heard nothing, in Chrome the keys went dead after a while (after Listen and Play), and
  the app's notes never reached the keyboard. Cause: the practice screen stopped its own input on
  every port change (a port finishing to open, the first note sent out), while still saying it was
  connected. Fixed, with an e2e test that fails without it; checked with a virtual keyboard and a
  virtual MIDI destination in real Chrome and Playwright's Firefox (notes in before and after
  Listen + Play, notes out during it). Each piece now connects by itself once MIDI is allowed.
  Left: the maintainer's check with a real keyboard in their own Chrome and Firefox. Reloading or closing the tab still ends Firefox's MIDI
  service; the app cannot prevent that.

- [~] **P5-13** (SONG, APP) A MIDI file gets a printed score (ADR 0017, proposed). Reason
  (maintainer, 2026-10-10): most pieces on score-sharing sites come only as PDF, MIDI and audio, and
  a MIDI import showed no score. Done: `songToMusicXml` in song-model writes the song as a grand
  staff (bars, key and time, clefs, spelling, accidentals, beams, voices, ties, rests, triplets),
  each note's ref becomes its glyph id so the cursor and marks link directly; MIDI files from
  notation software are quantised in ticks so their written rhythm survives; pickup bars only
  where a later key or time change shows them. Checked on the maintainer's MuseScore exports
  (local only): identical notes after writing and reading back. Left: dynamics, slurs and pedal
  (MIDI has none), grace notes, a Verovio worker for long pieces, re-importing MIDI pieces already
  in a library, an iPad check.
- [~] **P5-14** (APP) The learner's own sheet-music PDF as a "Sheet" view (ADR 0018, proposed).
  Done: `packages/sheet` finds staves, systems, barlines, repeats and endings in pdf.js's drawing
  (a simple reader for scanned pages) and matches the song's measures to the written bars; the
  Sheet view draws the pages lazily with the current bar highlighted and follows it; "Adjust bars"
  corrections are kept; a sheet-only piece opens as a reader. pdf.js 6.4 (Apache-2.0, legacy build)
  loads only for pieces with a sheet; credited on the About page. Checked on the maintainer's
  MuseScore PDF (local only): 237 of 237 bars on 7 pages, every measure on its own bar, about
  0.1 s to analyse. Left: D.C./D.S. jumps, multi-bar rests, real scans, an old Safari and an iPad.
- [~] **P5-15** (APP) Import a PDF with its MIDI file as one piece (ADR 0018). Done: files picked
  or dropped together pair by base name (a question when one score and one PDF differ in name); a
  PDF alone is a sheet-only piece; add, replace or remove a piece's PDF; "Add the MIDI or score
  file" for sheet-only pieces; PDFs up to 60 MB; encrypted backup, sync and crash-report scrubbing
  keep the sheet. Left: the Library page loads every stored file into memory (a separate table for
  file bytes would fix it), an iPad check of the picker.

Left out on purpose: 128 General MIDI instruments (a piano trainer, and extra sample licences and
size), Sightread's song library and assets, and any analytics.

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

- **2026-10-11** — P5-13, P5-14, P5-15: a MIDI file gets a printed score written from its notes,
  and a sheet-music PDF can be kept with a piece (paired with its MIDI file on import) and shown as
  a "Sheet" view with the current bar highlighted (ADRs 0017 and 0018, proposed; pdf.js added).

- **2026-10-10** — P5-12: a MIDI keyboard in Firefox no longer drops after moving around the site
  (one MIDI access for the page instead of one per screen).

- **2026-10-10** — Impressum: gehlot.site is given as the maintainer's website, a contact only;
  it is no longer linked as an Impressum with the postal address (that site has neither).

- **2026-10-10** — P5-09 started: the return to the start after a run moves like a drag of the
  score, repeated notes show on the keys, and the Content-Security-Policy allows connections only
  to the app's own origin (and the sync server, when a build has one; ADR 0013 amended). P5-11:
  hosting on GitHub Pages at opentiles.site chosen (ADR 0016, proposed), the deploy job, the frame
  guard and the privacy text for it. The Impressum names the maintainer's website (gehlot.site) as
  a contact; it has no postal address yet (P2-18).

- **2026-10-10** — The UI redesign and release pass (PR #1, P4-10…P4-19) and the Phase 5 work so
  far (P5-02 wake lock, P5-03 note names, P5-04 transpose, P5-07 live stats and overview, P5-05
  sight-reading drills) merged into `main`. Firefox end-to-end tests pass in CI. ADR 0015 (drills)
  stays proposed until the maintainer decides.

- **2026-10-09** — MIDI keyboard settings (keys on this device, the app's notes on the keyboard),
  Firefox MIDI confirmed working, the iPad app builds with Xcode, status brought up to date.

- **2026-10-09** — Phase 5 (release polish) planned. P5-01 done: the README, About page and
  CREDITS.md say that an LLM was used and credit Sightread; the comparison found no shared code.
  Features picked: P5-02…P5-07 (not P5-08).
- **2026-10-09** — Maintainer approval: all 81 catalogue pieces verified, ADRs 0010–0014 accepted,
  Bella Ciao accepted as traditional. Score scrubbing (P4-18), MIDI help for Firefox and Safari,
  engine build that finds rustup's toolchain.

- **2026-10-09** — Release pass: 27 more famous public-domain pieces (79 in the catalogue), search,
  note names, remembered practice choices, hand-coloured played notes, security hardening (CSP, SVG
  sanitiser, archive limits, error boundary), install and build warnings fixed, failing catalogue
  tests fixed (P4-13b, P4-15, P4-16).

- **2026-10-08** — Second review round of the redesign: smoother falling notes, a keyboard that
  fills wide windows sensibly, score view fixes (bar-line glide, scroll back, drag, centred play
  bar, page view), several levels per song and a first batch of new levels (P4-11…P4-13, ADR 0012).

- **2026-10-08** — P4-10 started: the visual system (tokens, contrast test, system fonts, icons),
  new Home, Library, Settings, practice header and canvas. ADR 0011 (proposed). Keyboard size and
  fingers moved into the practice screen's Options panel.

- **2026-10-08** — Phase 4 in the UI: keyboard size (P4-07), fingering display (P4-08) and the
  timing teacher with playback and WAV files (P4-09). WAV files only for catalogue pieces until the
  legal review says otherwise (ADR 0010, proposed).

- **2026-10-07** — Rounds 1 and 2 of the remaining tasks merged (SIMD engine, ABC/MuseScore/audio
  import, catalogue pipeline, vault and sync, iPad shell, PWA, samples, metronome, loops, step
  practice, calibration, score views, settings, backup, legal pages, licence scanner). Added
  P4-07…P4-10 for the maintainer's Phase 4 priorities.

- **2026-10-07** — First implementation pass: engine (P0-05…P0-09), Detector Lab (P0-10), song
  model and importers (P1-01…P1-06), practice engine (P1-08…P1-10), web app with wait, listen and
  play-along modes, library import and progress (several P1 tasks done or partly done), catalogue
  tooling (P2-01a) with five unverified CC0 arrangements.
- **2026-10-07** — Plan created from the project specification. Added `packages/practice` to the
  repository layout (ADR 0004). Split catalogue tooling task P2-01a (schema, validator, CI) out of
  P2-01 because the catalogue CI check is needed from the first piece onwards.
