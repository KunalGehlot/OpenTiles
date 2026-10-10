# Deploying OpenTiles

The web app is a static site: `pnpm build` writes `apps/web/dist/`, and any static host can serve
it. There is no server component (the optional sync server is separate, `docs/sync.md`).

The public site, <https://opentiles.site>, is served from GitHub Pages (ADR 0016).

## Before the first public deployment

1. **The catalogue.** A production build lists only pieces with `verified: true` (spec §2). All 81
   pieces were verified by the maintainer on 2026-10-09. A piece added later stays hidden until a
   person who did not add it reviews it (`catalogue/REVIEWING.md`); `VITE_SHOW_UNVERIFIED=1` builds a
   preview that shows unverified pieces too, labelled "Awaiting review".
2. Replace the postal address placeholder in the Impressum (`apps/web/src/legal/LegalPages.tsx`).
3. Run the checks: `pnpm check`, `cargo test --workspace --release`,
   `python3 tools/pipeline/validate_catalogue.py`, `python3 -m unittest discover -s tools/pipeline/tests`,
   `pnpm --filter @opentiles/web e2e` and a manual pass on Safari and an iPad.

## GitHub Pages (opentiles.site)

The `deploy` job in `.github/workflows/ci.yml` publishes every push to `main`, once every other CI
job has passed. It builds the engine and the app without `VITE_SHOW_UNVERIFIED` or `VITE_SYNC_URL`,
removes the source maps and hands `apps/web/dist` to `actions/deploy-pages`. Nothing is committed
for a deploy, and no secret is needed. To deploy, merge into `main`; to deploy the same commit
again, re-run the workflow on `main`.

One-time setup (done on 2026-10-10; repeat only for a new repository or domain):

1. Pages source "GitHub Actions":
   `gh api -X POST repos/KunalGehlot/OpenTiles/pages -f build_type=workflow`.
2. Verify the domain in the maintainer's account (GitHub → Settings → Pages → Add a domain) and add
   the TXT record it shows at the registrar, so no other repository can claim `opentiles.site`.
3. DNS at the registrar (Namecheap): remove the parking records, then add
   - `A @` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - `AAAA @` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`,
     `2606:50c0:8003::153`
   - `CNAME www` → `kunalgehlot.github.io` (Pages redirects `www` to the apex).
4. Set the domain: `gh api -X PUT repos/KunalGehlot/OpenTiles/pages -f cname=opentiles.site`. Once
   GitHub has issued the certificate, enforce HTTPS:
   `gh api -X PUT repos/KunalGehlot/OpenTiles/pages -F https_enforced=true`.

What Pages cannot do, and what replaces it:

- **No response headers of ours.** The Content-Security-Policy is the `<meta>` tag in `index.html`
  (`connect-src 'self'`). `frame-ancestors` only works as a header, so the app refuses to run inside
  a frame and links to itself instead (`main.tsx`). `Permissions-Policy` and
  `Cross-Origin-Opener-Policy` are not sent; the app embeds no frames and needs no cross-origin
  isolation.
- **One cache lifetime (10 minutes) for every file.** Hashed `assets/*` are simply fetched again
  after that. The service worker is registered with the default `updateViaCache`, so the browser
  checks `sw.js` for an update on every visit anyway, and the learner is asked before it updates.
- **No compression setting.** Pages compresses JavaScript, so the 8 MB score engraver travels as
  about 2.4 MB.

Check the live site after a change to the build or the hosting:
`curl -sI https://opentiles.site/` (and `sw.js`, an `assets/*.js`, a `.wasm`, a catalogue
`.musicxml`) for the status, `content-type`, `content-encoding` and `strict-transport-security`.

## Other hosts

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
- A build with a sync server (`VITE_SYNC_URL`) must add the server's origin to `connect-src` in the
  host's header too; the `<meta>` tag gets it automatically.

## What the build does for security

See ADR 0013: Content-Security-Policy, sanitised SVG, archive limits, an error boundary, no
third-party requests, no cookies and no analytics. `pnpm audit` reports one moderate finding that
has no fix (`sprintf-js`, reached only through TensorFlow.js inside the audio importer, with fixed
format strings); it is listed under `auditConfig` in `pnpm-workspace.yaml` with the reason.
