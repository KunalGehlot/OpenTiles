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
- **iPad app:** builds as an unsigned IPA that people sign with their own Apple ID (ADR 0023); install
  on an iPad and test with a keyboard (P3-01); App Store (P3-02).
- **Code still open:** MIDI out and Bluetooth MIDI pairing in the iPad app, the sustain pedal, frame time
  on an older iPad, a native speaker's read-through of the German, more catalogue pieces (P3-05).

The task list for this round is [Phase 5 — Release polish](#phase-5--release-polish-from-2026-10-09).
P5-01 to P5-05 and P5-07 are in `main` (merged 2026-10-10); left are P5-06 (free play), P5-09 (the
smoothness pass with the maintainer), P5-10 (the human release gate) and P5-11 (going live on
opentiles.site). The repository is public; the maintainer decided not to recreate it (P5-00).

**Now: [Phase 6 — The Player](#phase-6--the-player-from-2026-10-11)** (started 2026-10-17). A Player
page that plays the whole library and catalogue on the learner's own keyboard, and a visible "Plays
on" choice in practice so Listen can play on the keyboard only. The full plan is
[docs/phase-6/player.md](docs/phase-6/player.md); on 2026-10-18 the maintainer chose to make the
Player a self-playing grand piano, described in
[docs/phase-6/player-piano.md](docs/phase-6/player-piano.md).

**Next: [Phase 7 — Chord drills](#phase-7--chord-drills-planned-2026-10-22)**, planned from issue #47
and not started. See [docs/phase-7/chord-drills.md](docs/phase-7/chord-drills.md).

## Phases and gates

v1.0 is planned for August 2027 at roughly 8–10 hours a week, with December 2026 kept light. Each
phase ends at a gate. If a gate fails, re-plan the next phase before continuing.

| Phase                     | Window                          | Outcome                                                    | Gate at the end                                                                                      |
| ------------------------- | ------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 0 — Feasibility           | Oct 7 – Nov 18, 2026 (6 weeks)  | Microphone detector proven (or not) on iPad Safari         | **G0 Go/no-go:** accuracy and latency targets on the recorded test set                               |
| 1 — Core practice loop    | Nov 19, 2026 – Mar 31, 2027     | Journeys A and B work end to end, offline                  | **G1 Alpha:** a beginner can import or pick a piece and practise it in wait mode on iPad and desktop |
| 2 — Catalogue and breadth | Apr – Jun 2027                  | 150 verified pieces, looping, ABC/MuseScore import, backup | **G2 Public beta:** legal guardrails all met, device lab passes                                      |
| 3 — v1.0                  | Jul – Aug 2027                  | iPad MIDI shell, 300 pieces, release hardening             | **G3 v1.0 release:** the definition of success in spec §1 holds                                      |
| 4 — After v1.0            | Sep 2027 →                      | OMR, audio import, courses, community arrangements         | —                                                                                                    |
| 7 — Chord drills          | Planned 2026-10-22; not started | Random chords to practise, on the sheet or as falling keys | The maintainer plays it and answers Q1–Q9 (P7-13)                                                    |

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
- [x] **P1-07** Import review screen: swap staves / move split point, base tempo, transpose, trim
      bars, title and tags. Done: title, tempo, transpose, swap hands, MIDI split point, the bars
      to keep (first and last, as played; `ImportSettings.trim`, applied with `trimMeasures` and to
      pedals read later from the kept file) and tags (shown on the library card and found by its
      search).

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
- [x] **P1-26** Playwright end-to-end tests on Chromium, Firefox and WebKit in CI. Done: suite
      and CI job for Chromium, Firefox, WebKit and an iPad profile; every pull request runs all four
      (confirmed 2026-10-17: 373 tests across the four profiles in the "End-to-end" job).
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
- [x] **P2-04** Automatic file validation: renders, plays, survives a `Song` round trip. Done: XML and musical sanity checks in the validator, Song round trip in the song-model tests, and a render check with Verovio in CI (`apps/web/test/catalogue-render.test.ts`: every catalogue score draws, every note has its glyph, every triplet group is drawn as one). It found triplets written without `<tuplet>` marks, which Verovio drew as plain sixteenths in Für Elise (complete) and the Menuett WoO 82; `arrange.py` now writes the marks.
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
  Bluetooth foot-pedal page turn. Done: settings for large print, high contrast, left-handed controls, reduced motion, shortcuts list, pedal key; the pedal's chosen keys turn every page view (engraved pages, the learner's sheet, the sheet reader) along with the usual ones (`settings/pedal.ts`, 2026-10-17). Left: practice view reading the left-handed flag beyond CSS.
- [x] **P2-16** Licence scanner for third-party dependencies in CI.
- [~] **P2-17** Privacy policy, Impressum with notice-and-takedown address, records of processing. Done: privacy policy and Impressum (EN/DE), records of processing; the Impressum gives the maintainer's website gehlot.site as a contact only (2026-10-10). Left: the postal address and the lawyer review (P2-18).
- [ ] **P2-18** (human) Legal consultation with a German copyright lawyer (timing is an open
      decision). Also ask: Bella Ciao (P4-14), the LLM disclosure and the Sightread credit wording
      (P5-01), and whether MIDI export of a user's own free-play recording breaks guardrail 1 (P5-06).

**G2 criteria:** 150 verified pieces across 5 levels; every item in
[docs/legal-guardrails.md](docs/legal-guardrails.md) checked; device lab passes on every row of the
compatibility matrix (spec §5).

## Phase 3 — v1.0 (Jul – Aug 2027)

- [~] **P3-01** Capacitor iPad shell with a Swift CoreMIDI plugin (`NativeMidiInput`), in
  `apps/ios-shell`. Done: Capacitor 8 shell, Swift CoreMIDI plugin, NativeMidiInput; the app
  builds with Xcode 27 (2026-10-09). Self-signing (2026-10-22, ADR 0023, `docs/ipad-app.md`):
  `pnpm ipa` makes an unsigned IPA for AltStore, SideStore or Sideloadly and a free Apple ID,
  `pnpm device` signs with the user's team and installs; a macOS CI workflow builds it, runs the
  plugin tests on a simulator and drafts a release with an AltStore source on a version tag; the
  Bluetooth usage text the pairing screen needs; no service worker inside the app. First device run
  (2026-10-22, iPad Pro M1, iPadOS 27, a USB digital piano): MIDI in works; fixed from it: the
  sampled piano (Capacitor serves MP3s with status 0) and the status bar in the dark theme. The
  plugin tests pass in CI. Left: the rest of the first-build checklist in the app's README
  (Bluetooth, microphone, MIDI out on the keyboard's own sound, Split View), AltStore / SideStore /
  Sideloadly with a free Apple ID.
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
      screen says "Transposed up 2 semitones."; Verovio engraves the score in the new key, and the
      song's key moves as Verovio moves it (`transposeKey`, checked against Verovio for every key and
      shift), so "as the key" names black keys as the score writes them, at ±6 semitones too. Left:
      the shift is not remembered between visits.
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
  Done (2026-10-17): 44 px touch targets where the pointer is a finger (`styles/touch.css`; a
  mouse keeps the denser sizes), measured on every main page, a library card and the practice
  Options panel by `e2e/touch.spec.ts`; on an iPad in landscape the falling notes lose about 65 px
  of height to the taller bars. A manual light/dark switch (Settings → Accessibility → Appearance:
  same as this device, light or dark), the practice canvas and form controls following it and no
  flash of the other theme on load. Left: the rest of the list, and checking the changes in the
  maintainer's Chrome.
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
  the Impressum gives gehlot.site as a contact (it has no postal address yet, P2-18); Pages enabled
  with the domain `opentiles.site` set (2026-10-10); `main` deploys there since 2026-10-11. Left:
  the DNS at Cloudflare ("DNS only", no parking record) and the domain verification. On
  2026-10-17 the site was still served through Cloudflare's proxy, which adds its bot-check script
  to every page and an error-report (NEL) header, so visitors' browsers can contact Cloudflare
  (hard rule 5), and GitHub has no certificate for the domain yet. Then HTTPS enforced, a header
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
  (local only): identical notes after writing and reading back. The sustain pedal is marked
  (P6-10). Linking glyphs to notes asks Verovio for a pitch only where it decides something
  (2026-10-17: Für Elise, complete, asks for 373 of 902), and Verovio runs in a worker of its own
  (opening a long score held the page for 0.4–0.6 s on a fast Mac, now under 0.1 s). Left: dynamics
  and slurs (MIDI has none), grace notes, re-importing MIDI pieces already in a library, an iPad
  check.
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
  keep the sheet. Left: an iPad check of the picker. (The Library page no longer loads the stored
  files: P6-04.)

- [~] **P5-16** (APP) The keyboard drawn in practice has exactly the keys chosen. Reason
  (maintainer, 2026-10-11): 61 keys showed more than 61, and smaller sizes changed nothing. Cause:
  the wide-window rule that adds octaves (white keys capped at 64 px) also widened a chosen
  keyboard; at 2,560 px 61 keys drew 73, and 49, 37 and 25 keys all drew 61. Done: only "Fit
  piece" widens; a chosen keyboard draws its keys, centred, with margins on a wide window; e2e
  tests for every preset at 2,560, 2,056 and 320 px (keys drawn, edges from the pixels, lanes over
  their keys) that fail without the fix. Checked in the maintainer's Chrome at 2,560 px: every
  preset draws exactly its keys. Left: a real iPad.

- [x] **P5-17** (APP) One "Sheet" tab instead of "Page" and "Sheet" (maintainer, 2026-10-11: "why
      do I have a page tab and a sheet tab?"). The tabs are Falling notes | Score | Sheet: Sheet shows
      the learner's PDF when the piece has one, otherwise the engraved pages. A saved "Page" choice
      opens Sheet. A piece with both notation and a PDF can no longer show the engraved pages.

- [~] **P5-18** (APP) The Score tab of a MIDI piece follows the learner's PDF: its staves, clefs and
  spelling (maintainer, 2026-10-11: Score tab only, no note highlight in the PDF). Done: reading
  which printed head draws each note (spike: 99.1 % of notes, all 9 clef changes and 99.4 % of
  spellings on the maintainer's MuseScore pair, local only; tests on scores engraved by Verovio in
  four music fonts), hints kept with the bar map (`SheetMap.score`, analyser version 2, so older
  unedited maps are read again once), and `songToMusicXml` following them. Left: the maintainer's
  pair again for a real check of the whole path; octave signs (the writer has none) and clef
  changes inside a bar; scans.

Left out on purpose: 128 General MIDI instruments (a piano trainer, and extra sample licences and
size), Sightread's song library and assets, and any analytics.

## Phase 6 — The Player (from 2026-10-11)

Goal: the learner picks any piece they have, library and catalogue together, and it plays on their
own piano or keyboard, from an elegant Player page and from practice's Listen mode. Asked for by the
maintainer on 2026-10-11. Every task's detail (reason, today's code, files, done-when, tests, what to
watch out for) is in [docs/phase-6/player.md](docs/phase-6/player.md); the decisions are in ADR 0019
(proposed), with open questions Q1–Q9 in §7 of the plan.

Two facts shape it. **iPad browsers have no Web MIDI** (all use WebKit), so on an iPad the keyboard is
reached by USB audio in the browser (the maintainer found on 2026-10-11 that the app's notes already
come out of their Yamaha's speakers that way, in Edge) or by MIDI through the iPad app. **Keyboard-only
playback mostly exists** (P4-19), but the choice is hidden in Options and falls back to the device
without a word when no MIDI output is found.

- [x] **P6-00** (GOV) The plan ([docs/phase-6/player.md](docs/phase-6/player.md)) and ADR 0019
      (proposed).
- [x] **P6-01** (APP) A "Plays on" control (this device, my keyboard, both) in the practice session
      bar; no silent fallback to the device (say so, offer Connect, move to the keyboard when it
      appears); choosing the keyboard connects MIDI; a USB audio tip where there is no Web MIDI.
      Done: "Plays on" next to Restart (Options no longer has the select; Settings keeps it). When
      the keyboard is chosen but cannot be used (not connected, none plugged in, no output, several
      outputs to choose from), the notes play on this device, the button shows a warning and a line
      says why, with Connect where that helps; a new output takes the notes over by itself. Where
      there is no Web MIDI it offers this device only, with the USB audio tip on iPad and iPhone.
- [~] **P6-02** (APP) Clean MIDI out: output-only access from the shared `midiAccess()`; on stop,
  seek, mode change, leaving and `pagehide` send note-offs, pedal up and All Notes Off; check
  `MIDIOutput.clear()` in Chrome, Edge and Firefox; handle an unplugged keyboard; ignore notes a
  keyboard echoes back. Done: the instrument remembers what it sent, and stopping (also on
  leaving, `pagehide` and a hidden tab) ends every note, lifts the pedal and sends All Notes Off;
  sending to an unplugged output no longer throws in the drawing loop; Settings' test note finds
  "MIDI thru" keyboards and practice ignores their copies. `clear()` checked with a virtual
  destination: missing in Chrome and Edge, present in Firefox; nothing left sounding 50 ms after
  Stop in any of them (notes in `docs/architecture.md`); where it is missing, MIDI notes are
  handed over at most 0.1 s ahead (with P6-03). Left: output-only access moves to P6-05, which is
  the first to need it.
- [x] **P6-03** (PRAC, APP) One playback scheduler in `packages/practice` (notes and pedal as timed
      events, seek, tempo change), used by Listen, play-along's accompaniment and the Player.
      Done: `buildPlayback` and `PlaybackCursor` (`packages/practice/src/playback.ts`), timed in
      song seconds and mapped onto the caller's clock; the practice session uses them for Listen
      and the other hand, with the look-ahead its instrument asks for. Pedal events are in the
      event type and the cursor; P6-10 fills them from the files.
- [x] **P6-04** (STORE, APP) All the music in one fast list: file and PDF bytes in their own table
      (Dexie version 2, the P5-15 leftover), durations, and a collection of catalogue plus library.
      Done: database version 2 keeps each piece's row (song, settings, sheet name and bar map) apart
      from its files; the upgrade moves the bytes one piece at a time; the backup format and sync
      records are unchanged. `player/collection.ts` lists the catalogue and the library with
      lengths, last played, search and sorting; 200 pieces with PDFs list in about 45 ms without
      reading a byte of them. Catalogue lengths are remembered on the device the first time a piece
      loads (the full score reader is needed to work them out), so the Player fills them in.
- [~] **P6-05** (APP) The Player transport: a singleton with a worker clock that keeps playing in a
  hidden tab, the queue model, auto-advance, wake lock, pause when the keyboard disappears.
  Done: `player/queue.ts` (shuffle that plays every piece once per round, repeat one and all,
  play next), `player/transport.ts` (play, pause, seek, next, previous within 3 s, tempo, hands,
  the gap between pieces, pause and a message when the keyboard goes away, on the shared
  scheduler), `player/browser.ts` (one transport for the app, a worker clock, time on the page's
  clock with this device's piano converted to the audio clock, output-only MIDI access, wake
  lock, `pagehide`; practice, drills and the Detector Lab stop it); this device's piano can now
  be silenced at once, so Stop in practice cuts its notes too. "Recently played" from the Player
  is kept on the device, apart from practice progress. Timing checked in real Chrome, Edge and
  Firefox through the Player page (2026-10-17, a virtual CoreMIDI destination, `send()` wrapped
  in the page): over 30 s every note-on was handed over at least 58 ms before it was due (median
  85–106 ms), none late, and the notes of a chord arrived together. Left: 10 minutes in a hidden
  tab: automated browsers keep their pages visible (Playwright's focus emulation, even with a
  window and a minimised one), so it is a person's check (P6-13).
- [x] **P6-06** (APP, human) Design the Player with the maintainer in their dark-mode Chrome: a
      prototype with two variants, generated cover art, the piece's picture as the seek bar. Done: the
      maintainer chose a third design on 2026-10-18, a player piano
      ([docs/phase-6/player-piano.md](docs/phase-6/player-piano.md), ADR 0019): a paper roll moving
      down onto a drawn grand keyboard whose keys go down by themselves, the next title printed on
      the roll's leader between pieces (the transport loads the next piece during the gap), a
      programme of works grouped by composer with "Let it play", and stand mode's layout. After the
      maintainer's first review (2026-10-19, brief §4.8): a black lacquer stage with gold in every
      theme, the roll as fine lines of light, 88 keys where they fit, keys that go down before their
      note and spring back, a pedal light instead of pedals, a hairline for the position, one options
      menu, and HDR light (WebGPU, extended tone mapping) and Display P3 gold where the screen shows
      them. Published at the maintainer's request on 2026-10-19.
- [x] **P6-07** (APP) The Player page (`#/player`): search, filters and sorting over all music, Now
      playing, transport, tempo, hands, transpose, "Plays on", live keyboard strip, ⅓ iPad and 320 px
      layouts, German strings, shortcuts. Done: the page plays through the transport (a row plays the
      list from that piece; play, pause, previous, next, shuffle, repeat, tempo, hands); "Plays on"
      moves a playing piece to the new choice and says when the keyboard goes away; seeking by tap,
      drag and keys; Space and the arrow keys; German strings; e2e in the 320 and 1,180 px layouts;
      "Show hands" kept between visits.
      Entry points: "Listen" on the Home and Library cards and in practice's options plays the piece
      in the Player, then the programme after it; "Practise this" in the Player's options. Keys at the
      heard time (brief §5.4): this device's notes are scheduled through the output timestamp, which
      includes the output latency, and a MIDI keyboard plays at its time stamps, so both sound when
      the keys are drawn; without an output timestamp the reported latency is taken off. The touch
      test covers `#/player` (the position line's target is 44 px tall on touch screens). Composer dates in the programme: the index carries a named composer's years from the
      committed Wikidata cache (CC0), only where its death year is the record's.
- [x] **P6-08** (APP) Queue: play all, shuffle, repeat, reorder by drag and keyboard, kept on the
      device. Done: Up next (a panel on wide windows, over the page on narrower ones) plays a piece
      now on a tap, moves one by dragging its handle or with ↑ ↓ on the handle (Alt + ↑ ↓ anywhere
      on its row, announced to screen readers), takes one out with ×, and clears; the queue is
      kept on this device (`device.playerQueue`, not in the backup) and comes back after a reload,
      without pieces deleted since. Play all and Let it play, shuffle and repeat came with P6-05
      and P6-06.
- [x] **P6-09** (APP) Mini player on other pages and media keys (Media Session where it works without
      tricks); practice, drills and the Detector Lab stop the Player. Done: a bar on every page but
      the Player and practice (tile, title, play or pause, next; a tap opens the Player), "Stopped
      while you practise." there and in the Player, and Media Session metadata, actions and position.
      Checked on chrome://media-internals: Chrome and Edge give the page a controllable session while
      this device's piano plays, none while only a MIDI keyboard plays (no silent `<audio>` added).
      Firefox not checked (no page lists its sessions).
- [x] **P6-10** (SONG) The sustain pedal in the `Song` from MIDI (CC 64) and MusicXML, sent to the
      keyboard and honoured by the sampler (ADR 0020, amending ADR 0003). Done: `Song.pedals`
      (sustain, soft, sostenuto) from MIDI control changes 64, 66 and 67 and from MusicXML pedal
      marks and sounds, through repeats and trimming; each note gets a held length, which this
      device's piano sounds and a MIDI keyboard gets as the pedal's control changes instead; Listen
      and the Player send the pedal, play-along's other hand does not; Stop lifts every pedal;
      stored library pieces get their pedals from their kept file once. The score written for a MIDI
      piece marks the sustain pedal ("Ped.", the release star, and one change mark for a lift and
      press within an eighth of a beat).
- [x] **P6-11** (PRAC) Natural touch for pieces without velocities (beat strength, melody, dynamics),
      with an "even" option. Done: `touchVelocities` in `packages/practice` (the melody over the
      accompaniment, the downbeat and the bar's second strong beat over off-beats, pickup bars
      counted from the end of the bar, a small variation fixed per note); MIDI velocities are kept;
      Settings → Practice → Touch (natural by default, plan Q4) for practice and the Player.
      Dynamics marks are not read yet, so they do not shape it.
- [~] **P6-12** (APP, iOS) MIDI out in the iPad app (CoreMIDI destinations, timed batched send,
  flush) and Bluetooth MIDI pairing. Device test needs P3-01. Done: the plugin's output port,
  `listDestinations`, `destinationsChanged`, `send` (host-time stamps, MIDI 1.0 packets) and
  `flush`; the web side's `NativeMidiInput.output()` (clock mapping, one bridge call per tick,
  `flush` as `clear()`), the Player through it, Apple's Bluetooth MIDI pairing screen from Settings,
  and `keepAwake` while the Player plays. The plugin and its tests compile for iOS with Xcode 27.
  Left: running the Swift tests (no simulator runtime here) and the device test (P3-01, P6-13).
- [ ] **P6-13** (human) The maintainer's checks: their keyboard in Chrome, Edge and Firefox on the Mac;
      the Player over USB audio on the iPad, and whether the microphone hears the keyboard's USB
      audio; the iPad app; design approval; the media keys and Now Playing showing the piece in
      Chrome, Edge, Firefox and Safari.
- [~] **P6-14** (GOV) Docs: user guide, FAQ (MIDI on iPad), architecture (scheduler, transport, MIDI
  out), README. Done: the FAQ on MIDI keyboards on an iPad, the architecture of the scheduler,
  transport and MIDI out (P6-03, P6-05), and the user guide for this round's features (bars to
  keep and tags, light or dark, the pedal's keys, the Score tab following a PDF, pedal marks).
  The Player in the user guide (the programme, Plays on, playing expressively, Up next, stand mode,
  the bar on other pages, Listen and Practise this, what you hear on each device) and the README;
  its keys in the guide and in Settings → Keyboard shortcuts. Left: screenshots of the Player in
  the README once the maintainer is happy with its look.

- [~] **P6-15** (APP) Stand mode: the music room alone in the window (full screen where offered),
  controls that fade after 3 s and come back on any touch, "Next: …" under the piano, the wake
  lock, Reduce motion. Done: F or the button, full screen where offered (the browser's own Escape
  leaves it too), the controls and the pointer fading after 3 s, "Next: …" under the piano, an e2e
  test in Chromium, WebKit and the iPad profile. It found a bug: the key that woke the controls
  re-rendered the page while it was being handled, so the Player's shortcuts missed it (Space did
  nothing the first time); they now listen once for the page's life. Left: the check on a real iPad
  (P6-13).
- [~] **P6-16** (PRAC) Phrasing for the Player: phrases swell towards their high point and settle
  at the end, the last bar slows by at most 10 % and the final chord is held; dynamics marks and
  hairpins set the level when a file has them (none of the catalogue's scores has any). On in the
  Player ("Expressive"), off in practice; applied at playback, never stored. Done (ADR 0021, after
  the maintainer found the Player "very flat" on their piano, 2026-10-19): "Play expressively" in
  the Player's options, on by default and kept; shaped touch (the melody over the accompaniment,
  each phrase rising to its highest note and settling) for notes the file leaves unshaped; an
  automatic sustain pedal where the file has none (a legato pedal at each new harmony, changed
  where it would smear a step, up in rests, at the end and in passages too fast to pedal); every
  pedal lifted as a piece ends. Over the catalogue: no semitone smeared by the pedal, the pedal
  down 79 % of the time on average, velocities about 39–106 (59–89 before). The ending: from the
  bar before the last chord the tempo eases to 90 %, and the last chord is held half as long
  again; the transport, seek line and media controls take the longer length. A MIDI file written
  out by notation software (chords at one velocity) is not taken for a recording: it is pedalled
  and shaped around its own written dynamics. Left: dynamics marks and hairpins from imported
  MusicXML (none of the catalogue's scores has any).
- [x] **P6-17** (APP) Sound on this device: a soft room sound from an impulse response made in code
      (Player only), and a richer piano with more Salamander loudness layers as the default sound
      (maintainer, 2026-10-18), loaded after the current set and kept for offline use. Done (ADR
      0007 amended): layers 5 (`soft/`, cut at 5 s) and 14 (`loud/`) beside layer 10, built by the
      same script (layer 10 unchanged); each note plays with the layer recorded nearest its
      velocity, loudness on the same curve (within 0.9 dB at the boundaries, rendered offline), the
      layer changing the tone; the soft, then the loud layer load after the original set, and the
      service worker precaches them (+2.8 MB, about 70 MB more decoded). The room: a 1.8 s impulse
      response made in code (decaying noise, darker as it fades), on only while the Player plays
      on this device; off on pause, in practice and in the Detector Lab. Not heard on a real iPad
      yet (P6-13).
- [x] **P6-18** (GOV) Dependency security round (2026-10-22), after the October npm supply-chain
      incidents (Shai-Hulud worm in `keyv`/`cacheable` and others, the Trusted Publishing hijack) and
      the Node.js security release of 2026-10-21. Checked first: all 674 locked package versions
      against OSV and `pnpm audit` (only the already-documented `sprintf-js`), the lockfile against
      the compromised versions, and the tree for the worm's files; nothing was affected (`eslint` →
      `cacheable` sits at 2.5.0, before the pulled 2.5.1). Done: every dependency refreshed within
      its range (no majors, no new or removed packages, no install scripts); `minimumReleaseAge` (two days) in
      `pnpm-workspace.yaml` so pnpm will not install anything younger; CI
      `setup-node` uses `check-latest` so it runs the newest 22.x (22.23.4 or later has the fix).
- [x] **P6-19** (APP) Practice fixes (2026-10-22, maintainer: "play the other hand doesn't work on
      practice … fix it all"). Wait mode has no Play button, so nothing started the app's sound:
      on a MIDI keyboard the other hand, the steady click and the echo stayed silent until the
      screen was tapped. Now the keyboard's own sound needs no audio on this device (its part plays
      at once), the first tap, click or key anywhere on the screen starts sound, a keyboard that
      connects by itself starts it where the browser allows (the page was used before), and the
      first on-screen or computer key waits for sound so its step still plays the other hand. The
      practice clock moving from the page's clock to the audio clock mid-run no longer leaves keys
      lit or times the run wrongly. "Play other hand" now joins or stops in the middle of a
      play-along run, and a hand the piece has no notes for (a melody alone) can no longer be
      chosen. Checked in real Chrome with a virtual CoreMIDI keyboard: the live site sent nothing
      for the left hand, this change sends it. The other hand's opening before the practised hand's
      first note (27 of the 81 catalogue pieces) is P6-20.
- [x] **P6-20** (APP) The count-in (2026-10-22, maintainer: "Have a giant countdown of 3 seconds
      and start playing automatically. Three numbers pop up and fade away in a nice animation,
      while the key drops from above so that the first key is three seconds away. Then it starts
      in sync."). Every wait-mode run (opening a piece, Restart, Play again, a new mode, hand or
      loop, and each round of a loop) and every play-along run counts in: a big 3, 2, 1 over the
      falling notes (each pops in and fades within its second; it simply stands under Reduce
      motion) while the first note of the piece falls from three seconds away. In wait mode the
      other hand's opening then plays in time, and the run waits at the learner's first note;
      playing that note during the count-in starts the run at once. Play-along starts from the
      other hand's opening too, and Listen keeps its short lead-in; drills do not count in. When
      the opening would play on this device and its sound has not started, the screen says "Tap
      to start" first, so nothing plays unheard; on a MIDI keyboard it plays there at once.

## Phase 7 — Chord drills (planned 2026-10-22)

Goal: a **Chords** drill beside Sight-reading. The learner gets random chords from a set they choose,
at eight difficulty levels, and plays them from the sheet with nothing given away ("blind") or from
falling keys, in wait mode or at a tempo. Asked for in [issue #47](https://github.com/KunalGehlot/OpenTiles/issues/47)
and shaped by the maintainer on 2026-10-22. Every task's detail is in
[docs/phase-7/chord-drills.md](docs/phase-7/chord-drills.md); the decisions go into ADR 0022 (P7-00)
once the maintainer has answered Q1–Q9 in §7 of the plan.

- [~] **P7-00** (GOV) The plan and ADR 0022. Done: the plan. Left: the maintainer's answers, then the ADR.
- [ ] **P7-01** (PRAC) Chord vocabulary: qualities, spelling, inversions, voicings, `chordSymbol` parts.
- [ ] **P7-02** (PRAC) The seeded chord drill generator (MusicXML with `<harmony>`, one chord a bar).
- [ ] **P7-03** (PRAC) Judging a chord: per-chord tally, causes of a miss, chord spread in play-along.
- [ ] **P7-04** (APP) The Drills hub, the Chords setup page, chord names in the learner's label style.
- [ ] **P7-05** (APP) Sheet (blind) mode: the first playable, with the chords-a-minute readout.
- [ ] **P7-06** (APP) Falling keys mode: chord names on the bars, hint fade.
- [ ] **P7-07** (APP) Speeds: wait, tempo with count-in, the optional ladder.
- [ ] **P7-08** (STORE, APP) Chord progress on the device and "Practise my weak chords".
- [ ] **P7-09** (APP) The eight-level ladder and the pace controls wired together.
- [ ] **P7-10** (ENG) Four-note chords on the microphone: synthetic numbers, real recordings, a hint.
- [ ] **P7-11** (APP) The on-screen keyboard with several fingers, at ⅓ of an iPad.
- [ ] **P7-12** (GOV) User guide, README, German strings.
- [ ] **P7-13** (human) The maintainer's checks, then a reply on issue #47 with their approval.
- [ ] **P7-14** (PRAC, APP) Scales, on the same pieces (optional, after chords; see Q4).

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

- **2026-10-22** — CI: every action on Node.js 24 (GitHub's Node.js 20 deprecation); Dependabot
  for the actions, the pnpm workspace and the engine's crate.

- **2026-10-22** — P3-01: the iPad app can be signed with your own Apple ID and installed without the
  App Store (unsigned IPA, AltStore / SideStore source, one command for Mac owners).

- **2026-10-22** — P3-01: in the iPad app the keyboard stays connected from piece to piece; **Loop**
  repeats the whole piece at once, so wait mode goes round instead of ending.

- **2026-10-22** — P6-20: a 3, 2, 1 count-in before each run; the other hand's opening plays
  before the practised hand's first note.

- **2026-10-22** — P6-19: the other hand plays in wait mode on a MIDI keyboard without a tap
  first; "Play other hand" applies during play-along; a hand without notes cannot be chosen.

- **2026-10-22** — P7-00: Phase 7 (chord drills) planned from issue #47; nothing built yet.

- **2026-10-22** — P6-18: dependencies refreshed in range, a two-day floor on new releases, CI on the
  newest Node 22.

- **2026-10-19** — P6-16: a MIDI file from notation software is pedalled and shaped around its
  own dynamics; only a recording is left as played.

- **2026-10-19** — P6-07: the Player's programme shows each composer's years.

- **2026-10-19** — P6-17: this device's piano gains a soft and a loud layer, and the Player a room.

- **2026-10-19** — P6-16: the Player eases into the last chord and holds it.

- **2026-10-19** — P6-14: the Player in the user guide, the README and the shortcut list.

- **2026-10-19** — P6-15: stand mode tested; the first key after the controls fade works again.

- **2026-10-19** — P6-08: Up next can be reordered, trimmed and cleared, and is still there after a
  reload.

- **2026-10-19** — P6-07: "Listen" on the Home and Library cards and in practice, "Practise this"
  in the Player.

- **2026-10-19** — P6-16 (part): the Player plays expressively, with the sustain pedal and shaped
  touch where a piece has none of its own (ADR 0021); "Show hands" is kept between visits (P6-07).

- **2026-10-19** — P6-09: the Player on other pages (a bar with play, pause and next) and the
  device's media controls; practice stopping it says so.

- **2026-10-19** — P6-06: the Player's music room (black lacquer, the roll as light, keys that move
  like a piano's, HDR and Display P3 where the screen shows them) is published; P6-07 in progress.

- **2026-10-19** — P6-01: "Plays on" gains "Automatic", the default: the keyboard's own sound
  whenever one is connected (the maintainer's request); the Player offers "Play on your piano".

- **2026-10-18** — P6-06: the Player becomes a self-playing grand piano (the maintainer's choice);
  P6-15 to P6-17 added.

- **2026-10-17** — P6-14 (part): the user guide and FAQ for this round's features.

- **2026-10-17** — P5-13: scores are engraved in a worker, so long pieces no longer hold the page.

- **2026-10-17** — P5-13: the score links its notes faster in long pieces.

- **2026-10-17** — P2-15: the foot pedal's chosen keys turn the pages.

- **2026-10-17** — P1-07: the import review keeps the bars chosen and takes tags.

- **2026-10-17** — P5-09: light or dark chosen in Settings, whatever the device's mode.

- **2026-10-17** — P5-09: 44 px touch targets on touch screens.

- **2026-10-17** — P2-04: every catalogue score is rendered in CI; triplets in two pieces drawn right.

- **2026-10-17** — P6-10: the score of a MIDI piece marks the sustain pedal.

- **2026-10-17** — P5-04: a shifted piece's key is the key the score is engraved in, at a tritone
  too.

- **2026-10-17** — P5-18: a MIDI piece's Score tab follows the staves, clefs and spelling of the
  learner's PDF.

- **2026-10-17** — P6-12 (code): MIDI out and Bluetooth MIDI pairing in the iPad app; not yet run
  on an iPad.

- **2026-10-17** — P6-11: natural touch for pieces without velocities (the catalogue): the melody
  and the strong beats brought out; "even" in Settings → Practice.

- **2026-10-17** — P6-10: the pedals in the `Song` (ADR 0020, proposed), read from MIDI and
  MusicXML, held by this device's piano and sent to a MIDI keyboard.

- **2026-10-17** — P6-05 (most of it): the Player's queue and transport, a worker clock that keeps
  playing in a hidden tab, and output-only MIDI access; Stop in practice now cuts this device's
  notes at once.

- **2026-10-17** — P6-04: each library piece's file and PDF live in their own table (database
  version 2), so the Library page and the coming Player list without loading them; the Player's
  collection of catalogue and library.

- **2026-10-17** — P6-03: one playback scheduler in `packages/practice` for Listen, the other hand
  and the coming Player; MIDI notes are handed over at most 0.1 s ahead where the browser cannot
  drop stamped notes on Stop (Chrome, Edge).

- **2026-10-17** — P6-01 and P6-02: "Plays on" in the practice session bar, no silent fallback to
  this device, and a complete stop on a MIDI keyboard (note-offs, pedal up, All Notes Off).

- **2026-10-17** — Phase 6 started: the maintainer accepted the recommended answers to the plan's
  open questions Q1–Q8 (ADR 0019). P2-17 and P5-11 no longer say that gehlot.site holds the postal
  address; P5-11 notes that the site is still served through Cloudflare's proxy.

- **2026-10-11** — Phase 6 planned (P6-00): a Player page for the whole library and catalogue on the
  learner's own keyboard, and a visible "Plays on" choice in practice. Plan in
  `docs/phase-6/player.md`, decisions in ADR 0019 (proposed).

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
