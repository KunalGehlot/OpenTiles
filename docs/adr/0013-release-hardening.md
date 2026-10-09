# 0013. Release hardening: policy, limits and storage

- Status: proposed
- Date: 2026-10-09

## Context

OpenTiles is about to be served from a public website. It opens files from strangers' machines
(MusicXML, MuseScore and zip archives, MIDI, ABC, audio), draws SVG made from them, and keeps the
learner's library and settings in the browser. The earlier builds had no Content-Security-Policy,
no limits on archive sizes, no error boundary, and saved settings only to IndexedDB.

## Decision

1. **Content-Security-Policy.** The production build carries it as a `<meta>` tag (so any static
   host serves it), and `apps/web/public/_headers` carries it with the headers a tag cannot set
   (`frame-ancestors`, `X-Content-Type-Options`, `Permissions-Policy`, caching). Scripts only from
   the app's own origin plus `wasm-unsafe-eval` for WebAssembly; no inline scripts. `connect-src`
   allows `https:` and `wss:` only for a sync server the learner chooses; nothing connects by
   default (hard rule 5). The e2e test `the Content-Security-Policy blocks nothing the app needs`
   fails on any violation; it found that the engraver's notation font is a `data:` URL.
2. **Engraved SVG is sanitised** (`views/score/sanitise.ts`) before it is inserted: no scripts,
   event handlers, script URLs or foreign content. The policy is the first layer, this the second.
3. **Archive and file limits.** A zip may hold at most 200 entries, 64 MB per entry and 128 MB in
   all, checked from the archive directory before anything is inflated (`unzipLimited`). The
   library refuses a score file above 30 MB and a recording above 200 MB.
4. **An error boundary** around the routes: one broken screen does not blank the app.
5. **Storage.** Settings go to IndexedDB and a small copy in localStorage; a read falls back to the
   copy, a write fails only if both fail. Saves are queued in order and never reject into the UI;
   a settings change asks for persistent storage; a full disk when saving a piece says so.
   Practice choices (mode, hands, tempo, metronome) are one more settings key, read defensively.

## Consequences

- Inline `<script>` and `javascript:` URLs can never be added to the app without changing the
  policy. Styles stay `'unsafe-inline'` because React and the canvas views set `style=""`.
- The localStorage copy is not encrypted, like IndexedDB. It holds settings only, never a score.
- Hosts that ignore `_headers` still get the policy from the tag, but not `frame-ancestors`.
