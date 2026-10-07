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

## Licences of dependencies and assets

OpenTiles is AGPL-3.0-or-later, so everything it ships must be under a compatible licence. The
**Licences** CI job runs `pnpm licences` (`tools/check-licences.mjs`), which checks:

- the production npm dependencies of every workspace package (`pnpm licenses list --prod`);
- every Rust crate in `Cargo.lock` (`cargo metadata`, nothing is built);
- every file under `apps/web/public`, which must be declared in
  [`tools/licences/assets.json`](tools/licences/assets.json) together with a licence file whose
  text matches the declared licence.

Allowed for code: MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, Apache-2.0, Zlib, Unlicense,
CC0-1.0, BlueOak-1.0.0, MPL-2.0, LGPL-2.1-or-later, LGPL-3.0, GPL-2.0-or-later, GPL-3.0,
AGPL-3.0 and Python-2.0. Media assets may also be CC-BY-3.0 or CC-BY-4.0. SPDX expressions are
understood: `A OR B` passes when either side is allowed, `A AND B` only when both are.

If the job fails:

1. **Read the report.** It names the package, its version, the licence string and why it failed:
   _not on the allowlist_, _no licence declared_ or _not a valid SPDX expression_.
2. **Prefer another dependency** when the licence is incompatible with the AGPL (GPL-2.0-only,
   SSPL, BUSL, any non-commercial or share-alike Creative Commons licence, proprietary terms).
   Do not add an exception for those.
3. **When the licence is in fact compatible** but the scanner cannot tell (a missing or non-SPDX
   `license` field, a `LicenseRef-…`, a permissive licence not on the list such as Unicode-3.0),
   read the package's licence text yourself and add an entry to
   [`tools/licences/exceptions.json`](tools/licences/exceptions.json):

   ```json
   {
     "ecosystem": "cargo",
     "name": "unicode-ident",
     "licence": "(MIT OR Apache-2.0) AND Unicode-3.0",
     "reason": "Unicode-3.0 is a permissive, GPL-compatible licence (reviewed 2026-10-07)."
   }
   ```

   The `licence` must be the exact string in the report, so a later licence change is flagged
   again; add `"version"` to limit the entry to one version. Name the exception in the PR
   description so a maintainer reviews it. If you are unsure whether a licence is compatible, ask
   in the PR instead of adding an exception.

4. **For a new vendored asset** (sound, model, font, image), add an entry to `assets.json` with its
   path, SPDX licence, the licence file shipped next to it and its source, and put a README with
   the attribution in the folder.

The scanner also warns about exceptions that no longer match anything; remove those.

## Catalogue contributions

Each piece lives in `catalogue/pieces/<slug>/` with a `score.musicxml` (or `.mxl`) and a
`provenance.json`. The CI check rejects a piece with any provenance field missing or a creator who
died fewer than 71 years before the catalogue release year. See [catalogue/README.md](catalogue/README.md).

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
