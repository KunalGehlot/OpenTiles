# Deploying OpenTiles

The web app is a static site: `pnpm build` writes `apps/web/dist/`, and any static host can serve
it. There is no server component (the optional sync server is separate, `docs/sync.md`).

## Before the first public deployment

1. **The catalogue.** A production build lists only pieces with `verified: true` (spec §2). All 81
   pieces were verified by the maintainer on 2026-10-09. A piece added later stays hidden until a
   person who did not add it reviews it (`catalogue/REVIEWING.md`); `VITE_SHOW_UNVERIFIED=1` builds a
   preview that shows unverified pieces too, labelled "Awaiting review".
2. Replace the postal address placeholder in the Impressum (`apps/web/src/legal/`).
3. Make the repository public only after the history check in `STATE.md` (delete and recreate it).
4. Run the checks: `pnpm check`, `cargo test --workspace --release`,
   `python3 tools/pipeline/validate_catalogue.py`, `python3 -m unittest discover -s tools/pipeline/tests`,
   `pnpm --filter @opentiles/web e2e` and a manual pass on Safari and an iPad.

## Hosting

- Serve over HTTPS only (the microphone, MIDI, service worker and storage need a secure context).
- `apps/web/public/_headers` is read by Netlify and Cloudflare Pages. On other hosts, set the same
  headers in the server configuration: the Content-Security-Policy, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` and `frame-ancestors 'none'`. The policy is also in
  `index.html` as a meta tag, which covers everything except framing.
- Cache `assets/*` for a year (file names carry a hash) and send `no-cache` for `index.html` and
  `sw.js`, so an update is picked up. The service worker asks the learner before it updates.
- The site uses a hash router and relative URLs (`base: './'`), so it works under a sub-path and
  needs no rewrite rules.
- The notation engraver is one 8 MB file, loaded only when a score view opens and precached for
  offline use. Compress it (gzip or Brotli) at the host: it shrinks to about 2.4 MB.

## What the build does for security

See ADR 0013: Content-Security-Policy, sanitised SVG, archive limits, an error boundary, no
third-party requests, no cookies and no analytics. `pnpm audit` reports one moderate finding that
has no fix (`sprintf-js`, reached only through TensorFlow.js inside the audio importer, with fixed
format strings); it is listed under `auditConfig` in `pnpm-workspace.yaml` with the reason.
