# Contributing to OpenTiles

Thanks for helping make piano practice free. This guide covers how to get set up, what we expect in
a pull request, and the few rules that keep the project legally safe.

## Ways to help

- **Code** — pick an open task in [PLAN.md](PLAN.md) or an issue labelled `good first issue`.
- **Recordings for the detector test set** — see [docs/phase-0/test-set.md](docs/phase-0/test-set.md).
  Recordings must be of public-domain or self-written music.
- **Catalogue** — review a public-domain piece (about 10 minutes: listen, check the hand split and
  title, confirm the provenance), or contribute a simplified CC0 arrangement of a public-domain
  tune.
- **Translations** — English and German first (P2-14).

## Setup

See the "Setup and commands" section of [AGENTS.md](AGENTS.md). In short: Node ≥ 22.12, pnpm 10,
Rust stable with `wasm32-unknown-unknown`, Python ≥ 3.11.

## Pull requests

1. Reference the PLAN.md task ID (e.g. `P1-09`) or the issue in the title or description.
2. Keep each PR focused. Small PRs are reviewed faster.
3. Add or update tests. Run `pnpm check`, and `cargo test` if you touched the engine.
4. Tick the task in PLAN.md (or mark it `[~]` with what is left).
5. If you add a dependency, name its licence in the PR description.
6. Fill in the PR template, including the legal-guardrails checkbox.

### Developer Certificate of Origin

Every commit must be signed off, certifying that you wrote the change or otherwise have the right
to submit it under the project's licence ([DCO 1.1](https://developercertificate.org/)):

```sh
git commit -s -m "P1-09: stop the cursor until the whole chord is played"
```

This adds a `Signed-off-by: Your Name <you@example.com>` line. Use your real name or a consistent
public identity.

## Legal guardrails for contributors

OpenTiles never distributes copyrighted music. Please:

- **Never commit copyrighted scores, MIDI files, recordings or screenshots of them** — not even as
  test fixtures. Use public-domain material, your own CC0 snippets, or generate fixtures in code.
- **Never add features that share, publish or export library items to other people**, or that import
  from websites (URL import, scraping). Imports take local files only.
- **Never add tracking**: no analytics, third-party requests or cookies.

The full list, and why, is in [docs/legal-guardrails.md](docs/legal-guardrails.md).

## Catalogue contributions

Each piece lives in `catalogue/pieces/<slug>/` with a `score.musicxml` (or `.mxl`) and a
`provenance.json`. The CI check rejects a piece with any provenance field missing or a creator who
died fewer than 71 years before the catalogue release year. See [catalogue/README.md](catalogue/README.md).

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
