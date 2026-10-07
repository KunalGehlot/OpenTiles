# OpenTiles

**A free, open-source piano trainer that runs in your browser — iPad Safari included.**

See the music, play it, get instant feedback. Practise in wait mode, play along at your own tempo,
loop the hard bars, and track your progress. No account, no install, no payment. Ever.

> **Status: Phase 0 (feasibility).** We are proving that microphone note recognition works on an
> iPad before building the full app. Nothing here is ready for learners yet. See [PLAN.md](PLAN.md).

## Why

Commercial piano apps lock their whole learning experience behind subscriptions — including the
public-domain classics that make up much of their catalogue. OpenTiles makes the practice tool
itself free: interactive feedback, wait mode, looping, tempo control and progress tracking. The
music is either public domain or your own.

## Principles

| Principle | In practice |
| --- | --- |
| Free forever | No paywall, ads or premium tier on any learning feature |
| Bring your own music | Your library is private; the platform never shares or distributes your files |
| Public-domain-only catalogue | Every catalogue piece is verified public domain or CC0, with provenance recorded |
| Works everywhere | Installable web app; iPad Safari is a first-class target |
| Local-first and private | Works offline; files stay on your device; optional sync is end-to-end encrypted |
| Open by default | AGPL-3.0 code, open formats (MusicXML, MIDI), CC0 catalogue metadata |

## How it works

- **Inputs:** a MIDI keyboard (where the browser supports Web MIDI), the microphone for acoustic
  pianos and iPads, or the on-screen keyboard.
- **Score-informed listening:** the app always knows which notes come next, so the microphone only
  has to answer "are these notes sounding now?". That is what makes acoustic pianos work in a
  browser. The detector is written in Rust and runs as WebAssembly inside an AudioWorklet.
- **Your files, on your device:** MusicXML (`.musicxml`, `.xml`, `.mxl`) and MIDI (`.mid`) files
  are converted in the browser and stored in your browser's private storage. Nothing is uploaded.

Read more in [docs/architecture.md](docs/architecture.md) and the full
[project specification](docs/spec/project-plan.md).

## Getting started (developers)

```sh
pnpm install
pnpm build:engine   # needs Rust stable + the wasm32-unknown-unknown target
pnpm dev            # http://localhost:5173
```

Run the checks:

```sh
pnpm check                 # format, lint, typecheck, unit tests
cargo test --workspace     # engine tests, including the synthetic accuracy harness
python3 tools/pipeline/validate_catalogue.py
```

## Repository layout

| Path | Contents |
| --- | --- |
| `apps/web` | The web app (React + Vite, PWA) |
| `apps/ios-shell` | Capacitor wrapper + CoreMIDI plugin (phase 3) |
| `packages/engine` | Rust note-detection engine → WebAssembly, with its AudioWorklet |
| `packages/song-model` | The `Song` model and MusicXML / MIDI parsers |
| `packages/practice` | Practice engine: wait mode, play-along scoring |
| `packages/importers` | Lazy-loaded heavy converters (later phases) |
| `catalogue/` | Public-domain scores and their provenance records |
| `tools/pipeline` | Catalogue validation and build scripts |

## Contributing

Contributions are welcome — code, catalogue reviews, recordings for the detector test set,
translations. Start with [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents: read
[AGENTS.md](AGENTS.md). All participants follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licences

- Code: [GNU AGPL-3.0-or-later](LICENSE).
- Catalogue metadata and pipeline scripts: [CC0 1.0](catalogue/LICENSE).
- Catalogue scores: each piece's own source licence (CC0, public domain or CC BY), recorded in its
  provenance file and shown on the piece page.

The README, screenshots and demos only ever use public-domain music.
