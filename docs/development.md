# Development guide

How to work on OpenTiles: the rules every change keeps, where the code lives, how to build and
test it, and what "done" means. Start with [PLAN.md](../PLAN.md) for what to work on and
[CONTRIBUTING.md](../CONTRIBUTING.md) for how to send a change.

## Hard rules

Breaking one of these is a blocking review comment, whatever else the change does.

1. **No distribution path for library items.** No share links, "publish", export-to-public, or
   anything that sends a user's file or its title to another user or to the operator. The only
   export is the user's own encrypted backup.
2. **No imports from other sites.** Imports take local files only. No URL import, no scraping of
   score-sharing or video sites.
3. **No user music leaves the device unencrypted.** All parsing, conversion and note detection run
   in the browser. Never add a server round-trip for processing.
4. **No copyrighted music anywhere in the repo.** Test fixtures, screenshots, demos, docs and the
   README use public-domain or self-made CC0 material only. Generate fixtures in code where you
   can. Every catalogue piece has a complete provenance record.
5. **No tracking.** No analytics, cookies, fingerprinting or third-party requests at runtime.
   Crash reports, when they exist, are opt-in.
6. **No paywall or dark patterns.** No premium tier, nags or default-on notifications.
7. **Licences stay compatible.** Code is AGPL-3.0-or-later; catalogue metadata and pipeline
   scripts are CC0. Before adding a dependency, check its licence is compatible (MIT, BSD, Apache-2.0,
   ISC, MPL-2.0, LGPL, GPL-3.0, AGPL-3.0 are fine; anything else, ask) and say so in the PR.

## Repository map

| Path                  | What                                                                           | Language       |
| --------------------- | ------------------------------------------------------------------------------ | -------------- |
| `apps/web`            | The web app (React + Vite, PWA)                                                | TypeScript     |
| `apps/ios-shell`      | iPad app: Capacitor wrapper + CoreMIDI plugin, self-signed IPA (ADR 0023)      | Swift / TS     |
| `packages/engine`     | Note detection engine → WebAssembly, plus its AudioWorklet and loader in `js/` | Rust, TS       |
| `packages/song-model` | `Song` model, tempo map, MusicXML / MIDI parsers, quantiser, hand split        | TypeScript     |
| `packages/practice`   | Practice engine: `NoteEvent`, steps, wait mode, play-along scoring             | TypeScript     |
| `packages/importers`  | Lazy-loaded heavy converters (MuseScore, OMR, audio; phase 2+)                 | TypeScript     |
| `catalogue/`          | Public-domain scores + provenance records (CC0 metadata)                       | MusicXML, JSON |
| `tools/pipeline`      | Catalogue validator, index builder, PDMX pipeline                              | Python         |
| `docs/`               | Spec, architecture, ADRs, phase-0 protocols                                    | Markdown       |

## Setup and commands

Requirements: Node ≥ 22.12, pnpm 10, Rust stable with the `wasm32-unknown-unknown` target
(`rust-toolchain.toml` installs it), Python ≥ 3.11. Use the newest patch release of Node 22: CI does
(`check-latest`), and Node's security releases (22.23.4 on 2026-10-21) are fixes for the runtime that
runs the dev server and the tests.

pnpm refuses to install a package version published less than two days ago
(`minimumReleaseAge` in `pnpm-workspace.yaml`), because hijacked releases are usually unpublished
within hours. For an urgent security fix, lower it for that one install and read the lockfile diff.

Dependabot (`.github/dependabot.yml`) opens update pull requests every Monday for the GitHub Actions,
the pnpm workspace (minor and patch grouped, each major on its own) and the engine's crate, each a
few days after a release for the same reason. It cannot sign off its commits, so the DCO job lets
`dependabot[bot]` through; merge its pull requests like any other, with your own signed-off merge
commit (never GitHub's merge button). Capacitor, Node type and TypeScript majors, and Playwright
(its browsers move with it), are left to a person.

```sh
pnpm install                 # JS dependencies for every workspace package
pnpm build:engine            # Rust → packages/engine/dist/engine{,-simd}.wasm (needed by the web app)
pnpm dev                     # web app on http://localhost:5173
pnpm test                    # Vitest in every TS package
cargo test --workspace       # Rust unit tests + synthetic accuracy harness
pnpm lint && pnpm typecheck  # ESLint + tsc
pnpm --filter @opentiles/web e2e   # Playwright (builds the app; set PW_CHROMIUM_PATH to reuse a local Chromium)
pnpm format                  # Prettier
python3 tools/pipeline/validate_catalogue.py   # catalogue provenance + EU-term check
python3 -m unittest discover -s tools/pipeline/tests
```

Run the detector over a real recording (Phase 0 test set):

```sh
cargo run --release -p opentiles-engine --bin evaluate -- path/to/passage.wav path/to/passage.csv
```

Before you push, run everything your change touches: `pnpm check` for TypeScript,
`cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test` for Rust, and the
Python commands above for the catalogue.

## Architecture invariants

- **One event stream.** Every input (MIDI, microphone, touch, native MIDI) produces
  `NoteEvent { pitch, time, velocity?, confidence, source }` (`packages/practice`). Practice
  modes never know where a note came from.
- **One song format.** Every importer produces a `Song` (`packages/song-model`). Musical time is in
  quarter-note **beats**; seconds come only from the tempo map (`beatToSeconds`). Never store
  seconds in the `Song`.
- **Pure packages stay pure.** `song-model` and `practice` have no DOM, React, Web Audio or
  IndexedDB dependencies, so they run in Node tests, workers and the iOS shell unchanged.
- **Timing-critical drawing bypasses React.** Keyboard, falling notes and the score cursor draw on
  a canvas from `requestAnimationFrame`. React owns layout and controls only.
- **The detector runs off the main thread.** The engine is a dependency-free `wasm32` module with a
  C ABI (ADR 0002), instantiated inside the AudioWorklet. Never allocate in the per-block path;
  all buffers are preallocated in `Detector::new`.
- **The detector is score-informed.** It answers "are the expected notes sounding, and is a
  likely wrong note clearly stronger?" — it is not a general transcriber. Keep it that way.
- **Local-first.** The app works with no account and no network after the first load. Anything
  that needs the network must degrade gracefully offline.

## Coding conventions

- **TypeScript:** strict mode, `noUncheckedIndexedAccess`, ES modules, named exports, no default
  exports except React route components. Prefer plain functions and data over classes, except for
  stateful engines (`WaitMode`, `PlayAlongScorer`). No `any`; narrow `unknown`.
- **React:** function components and hooks; state that drives animation lives in refs, not state.
- **Rust:** `cargo fmt`, clippy clean with `-D warnings`. No `unsafe` outside `src/ffi.rs`. No
  panics on the audio path; clamp and continue. Keep the crate free of wasm-bindgen and of
  dependencies that import JS functions.
- **Python:** standard library only in `tools/pipeline` unless a task needs more (PDMX work may add
  pandas / music21 later); type hints; `unittest`.
- **Naming:** British spelling in user-facing text and docs ("practise" the verb, "practice" the
  noun, "colour", "licence"). Code identifiers use American spelling where the platform does
  (`color` in CSS and canvas APIs).
- **Comments:** explain why, not what. Link spec sections (`spec §7`) where a rule comes from.

## Testing expectations

- Every parser, quantiser, scorer and detector change comes with unit tests.
- Fixtures are generated in code or are self-made CC0 snippets. Never add a third-party score or
  recording unless it is verifiably public domain or CC0, with provenance noted next to it.
- Detector changes must keep `cargo test` green, including the synthetic accuracy harness
  (`packages/engine/tests/synthetic_accuracy.rs`). If you change thresholds, report the before and
  after numbers in the PR. Real-recording results (Phase 0 test set) beat synthetic ones.
- UI changes that touch Safari behaviour (audio unlock, microphone, storage) need a manual check on
  WebKit; note in the PR how you checked.

## Safari and iPad rules (summary)

Full list in [docs/architecture.md](architecture.md#safari-and-ipad-rules).

- Create or resume the `AudioContext` only inside a user gesture handler.
- Request the microphone with `echoCancellation`, `noiseSuppression` and `autoGainControl` all
  `false`.
- No Web MIDI on any iOS/iPadOS browser or macOS Safari: feature-detect `navigator.requestMIDIAccess`
  and fall back to microphone or touch without errors.
- Call `navigator.storage.persist()` on first import; nudge iPad users to Add to Home Screen.
- The layout must stay usable at ⅓ of an iPad screen and survive rotation.

## Using AI tools

OpenTiles was itself written with an LLM (see [CREDITS.md](../CREDITS.md)), and contributors may use
such tools too. The rules do not change: you sign off your commits (DCO) and are responsible for
every line, however it was produced. Do not paste in code, assets, songs or text from another
project unless its licence allows it and you keep its notices. When a feature is inspired by
another app, work from a description of what it does, not from its source, and credit it in
CREDITS.md. Commits carry no AI author, co-author or session trailer; the disclosure lives in the
docs and on the About page.

## Definition of done

- The behaviour in the task is implemented and covered by tests.
- Lint, typecheck, format, unit tests and (when relevant) `cargo test` and catalogue checks pass.
- No hard rule is broken; new dependencies have their licence named in the PR.
- The iPad app builds with the change in CI (the `iPad app` workflow) and its tests pass. Anything
  that may behave differently on an iPad is added to the
  [iPad device checklist](../PLAN.md#ipad-device-checklist); a device check never blocks merging.
- PLAN.md and any affected docs are updated.
- User-facing text is plain, British English, and German strings are added once i18n exists
  (P2-14).
