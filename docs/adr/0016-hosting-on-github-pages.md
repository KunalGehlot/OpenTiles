# 0016 — Hosting the web app on GitHub Pages

- **Status:** proposed
- **Date:** 2026-10-10
- **Plan task:** P5-11

## Context

The web app is a static site (`docs/deploying.md`): `pnpm build` writes `apps/web/dist/`, it uses a
hash router and relative URLs, and it needs no server. The maintainer owns `opentiles.site` and
chose to serve the app from GitHub Pages, where the repository already lives, after an Azure Static
Web Apps setup was considered. The records of processing had said "None intended; choose an EU
host" for third-country transfers, so this reverses a written intent.

Pages differs from the hosts `public/_headers` was written for:

- It sends none of our response headers: no `Content-Security-Policy` header, `frame-ancestors`,
  `X-Frame-Options`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` or cache rules. Every file
  gets the same short cache lifetime.
- GitHub, Inc. is in the USA. It logs and stores visitors' IP addresses for security purposes and
  complies with the EU-U.S. Data Privacy Framework (checked on GitHub's own pages, 2026-10-10).

## Decision

1. **Deploy from CI.** A `deploy` job in `.github/workflows/ci.yml` runs on pushes to `main` only,
   after every other job has passed. It builds the engine and the app as the `web` job does (no
   `VITE_SHOW_UNVERIFIED`, no `VITE_SYNC_URL`) and publishes `apps/web/dist` with
   `actions/upload-pages-artifact` and `actions/deploy-pages`. No branch of built files and no
   generated workflow, so every commit stays signed off by a person.
2. **Security without headers.** The Content-Security-Policy `<meta>` tag is the whole policy
   (`connect-src 'self'`, ADR 0013). The app refuses to run inside a frame and offers a link to
   open it in its own tab (`main.tsx`), in place of `frame-ancestors`. `Permissions-Policy` and
   `Cross-Origin-Opener-Policy` are not set: the app embeds no frames and needs no cross-origin
   isolation. The service worker is registered with the default `updateViaCache`, so the browser
   checks `sw.js` for updates whatever the cache lifetime says.
3. **Custom domain.** `opentiles.site` (apex) with `www` redirecting to it, verified in the
   maintainer's GitHub account so no other repository can claim it, and HTTPS enforced.
4. **Privacy.** The privacy policy (English and German) names GitHub Pages and GitHub, Inc., what
   GitHub logs, and the transfer basis; `docs/legal/records-of-processing.md` §1 matches.

## Consequences

- Deploying costs nothing and needs no secrets: the job authenticates with GitHub's own OIDC token.
- A green `main` is live within minutes. A broken build cannot deploy, because the job needs every
  check to pass first.
- Clickjacking protection depends on JavaScript; with scripts off nothing runs anyway.
- The data transfer to the USA and the wording of the privacy text go to the lawyer (P2-18).
- Moving to an EU host later only means a new deploy target; `public/_headers` already holds the
  headers such a host should send.

## Alternatives considered

- **Azure Static Web Apps.** Custom headers and an EU region for its API, but another account, a
  deployment token to keep, and Microsoft as a US company too. Not chosen by the maintainer.
- **Azure App Service.** A billed plan and a server to configure for a site with no server code.
- **A `gh-pages` branch of built files.** Large commits of generated files, each needing a
  sign-off, and Jekyll processing unless disabled.
- **An EU static host (for example Codeberg Pages or a server at an EU provider).** Better for the
  records of processing; can follow once the legal consultation (P2-18) asks for it.
