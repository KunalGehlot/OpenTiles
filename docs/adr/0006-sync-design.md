# 0006 — Encrypted backup and sync design

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P2-13, P3-03, P3-08

## Context

Spec §10 asks for a private library that works with no account, a one-tap encrypted backup, and
optional sync where the operator stores only data it cannot read: Argon2id-wrapped library key,
AES-GCM records with titles and file names encrypted, a printable recovery code, EU object
storage, a 250 MB quota, one-step account deletion, and sign-in with passkeys or an email link.
Crash reports, if any, must be opt-in and anonymous (AGENTS.md hard rule 5).

Two open decisions in PLAN.md are settled by the maintainer: **sync ships in v1.0**, and sign-in
offers **both passkeys and an email link**.

Constraints: the crypto must run in iPad Safari (WebCrypto, WebAssembly, an A12-class device with
3 GB of RAM), in Node for tests, and later in the iOS shell; no runtime requests to third parties;
dependencies must be AGPL-compatible.

## Decision

### Client-side crypto: `packages/vault`

- **Library key:** random AES-256-GCM key from WebCrypto.
- **Passphrase wrapping:** Argon2id via `hash-wasm` (MIT; the WebAssembly is embedded, nothing is
  fetched), RFC 9106's second recommended parameters: **64 MiB, 3 passes, 4 lanes**, 16-byte
  salt, 32-byte output imported as a non-extractable AES-GCM key. The passphrase is NFC-normalised
  and must be at least 8 characters. Bundles read from elsewhere are sanity-checked (at most
  1 GiB, 16 passes, 16 lanes) so a crafted bundle cannot freeze the device; new bundles must be at
  least 19 MiB / 2 passes (the OWASP minimum).
  - Measured: about 0.3 s in Node 22 on an x86-64 CI-class container. hash-wasm computes lanes
    one after another, so on an older iPad we expect roughly 1–2 s; this happens once per device
    (setting up sync, unlocking on a new device, opening a backup), not on every launch. **Not
    yet measured on an A12 iPad**: the device lab (P3-06) must confirm it, and the parameters
    can be lowered for new bundles without breaking old ones because every bundle records its
    own.
- **Recovery code:** 160 random bits in Crockford base32 (no I, L, O, U; look-alikes are accepted
  when typed) plus a 20-bit CRC-derived checksum: 36 characters in nine groups of four. Being
  high-entropy, it needs no slow KDF: HKDF-SHA256 with the bundle's salt derives its wrapping key.
- **Key bundle:** JSON with format version, a random key id, the KDF parameters, salts and both
  wrapped copies. Each wrap is AES-GCM with associated data naming the slot and key id.
- **Records:** `"OTR" 0x01 | IV | AES-GCM(ciphertext)`, with associated data = header + a
  caller-supplied context (`sync/<id>/<version>` or `backup/<backupId>/<path>`). The plaintext is
  a small codec (JSON plus raw byte segments, so original files are not base64-inflated), deflated
  with fflate when that helps, then padded with **Padmé** (at most 12 % overhead) so a blob's size
  cannot fingerprint a well-known file.
- **Backup file:** a `.zip` (fflate) with a plaintext `manifest.json` (format version, time, key
  bundle), a `README.txt`, an encrypted index and one encrypted entry per library item plus
  progress and settings. The index and the path-bound contexts make dropped, swapped or foreign
  entries fail the restore.

### Sync protocol and client: `packages/sync-client`

- Records have opaque random ids. The server keeps, per record, a version and a position in a
  per-account change log; the client pulls the log from its cursor and pushes with
  `If-Match`/`If-None-Match`.
- **Last writer wins per record.** The server's versions detect concurrent writes; the decision
  uses a hybrid-clock time and the device id stored _inside_ the encrypted record, so the server
  learns nothing from it and every device reaches the same result. Deletions are encrypted
  tombstones under the same rule.
- Because the version is part of the associated data, the server cannot relabel an old blob as a
  newer version or move a blob to another record. Records that fail to decrypt are reported and
  skipped, not fatal.
- The client refuses to upload anything that is not a sealed record or a valid wrapped bundle.

### Service: `apps/sync-api`

- **Hono** (MIT) on **@hono/node-server** (MIT), Node 22.
- **Metadata in SQLite through `node:sqlite`**, built into Node (no native add-on to compile).
  Blob bytes go to a `BlobStore`: filesystem for development and tests, **S3-compatible** for
  production with a small SigV4 signer of our own, verified against the worked examples in the S3
  documentation, instead of the AWS SDK.
- Every write stores a fresh object key and then switches the row to it in one transaction, so
  concurrent writers cannot overwrite each other's objects and readers never see half a blob.
- **Sign-in:** email link (token in the URL fragment) plus an 8-digit code for iPad home-screen
  apps, single use, 15 minutes, five wrong codes burn the links; **passkeys** via
  `@simplewebauthn/server` (MIT), discoverable credentials, attestation `none`, added after an
  email sign-in. Sessions are random bearer tokens stored as SHA-256 hashes, 90 days sliding. No
  cookies, so no CSRF surface and no cookie banner.
- **Quota:** 250 MB (decimal) per account, enforced on every write against the size change; 32 MB
  per record; 100 000 records.
- **Account deletion:** one transaction removes all rows and queues the account's object prefix;
  objects are deleted at once and retried by a maintenance job if storage fails.
- **Crash reports (P3-08):** `POST /v1/crash`, unauthenticated, 16 KiB, fixed fields, scrubbed,
  time rounded to the hour, no address stored, 30-day retention, rate-limited in memory.
- **Privacy in operation:** CORS and an `Origin` check allow only the app; logs carry method, route
  pattern, status and duration only; client addresses exist only as salted hashes in memory for
  rate limits.

## Consequences

- The operator can see an email address, record counts, padded sizes, versions and timestamps —
  exactly the list in spec §10 — and nothing about which pieces a user has.
- Forgetting both the passphrase and the recovery code loses the synced library; the UI must say
  this when sync is set up.
- `node:sqlite` still prints an experimental warning on Node 22; the service and its tests run
  with `--disable-warning=ExperimentalWarning`. If its API changes, only `apps/sync-api/src/db.ts`
  is affected.
- One SQLite file means one service instance. That is plenty for the expected scale (spec §12
  budgets one small EU VM); scaling out would need a shared database first.
- The web app has to provide a `SyncStore` on IndexedDB, the passkey prompts and the screens; that
  wiring is separate work.

## Alternatives considered

- **PBKDF2 (WebCrypto built-in) instead of Argon2id:** no extra dependency, but far weaker against
  GPU guessing; the spec names Argon2id.
- **Argon2id for the recovery code too:** pointless for a 160-bit random secret and would double
  unlock time.
- **Per-record keys wrapped by the library key:** allows sharing single records, which the product
  must never do (hard rule 1); a single key is simpler.
- **The AWS SDK for S3:** well tested but large, with many transitive packages; five calls do not
  need it.
- **better-sqlite3 or PostgreSQL:** better-sqlite3 needs a native build in the image; PostgreSQL
  adds a second service to run for a few small tables.
- **Server-assigned last-writer-wins (whoever reaches the server last):** simpler, but an old
  offline edit could overwrite a newer one just by syncing late.
- **Cookies for sessions:** would need CSRF protection and a cookie notice; bearer tokens in
  IndexedDB need neither.
