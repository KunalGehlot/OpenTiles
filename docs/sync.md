# Encrypted backup and sync

How the encrypted backup file (P2-13), optional sync (P3-03) and opt-in crash reports (P3-08)
work, what the server can see, and how to run the sync service. The design and the reasons for it
are in [ADR 0006](adr/0006-sync-design.md); the requirements are in spec §10.

## Pieces

| Package                | Runs on                    | Does                                                                           |
| ---------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `packages/vault`       | browser, worker, Node, iOS | library key, Argon2id / recovery-code wrapping, record encryption, backup file |
| `packages/sync-client` | browser, worker, Node, iOS | API client, key setup on the server, sync engine (last writer wins)            |
| `apps/sync-api`        | Node 22 server             | sign-in, encrypted blob store with versions, wrapped-key store, crash reports  |

`vault` and `sync-client` are pure TypeScript over WebCrypto (no DOM, no IndexedDB), like
`song-model` and `practice`. The web app supplies the storage (`SyncStore` on IndexedDB) and the
passkey prompts (`navigator.credentials`).

## How the encryption works

1. The first time sync or a backup is set up, the device makes a random 256-bit **library key**
   (AES-GCM).
2. The user picks a **passphrase** (at least 8 characters). Argon2id (64 MiB, 3 passes, 4 lanes;
   RFC 9106's second recommended setting) turns it into a wrapping key, which encrypts the library
   key. The passphrase is NFC-normalised first, so accented letters typed on an iPad and on a PC
   give the same key.
3. A **recovery code** is shown once: 160 random bits printed as nine groups of four characters
   (`7K3M-QX2P-…`) with a typing-error checksum. It wraps the library key a second time (via
   HKDF-SHA256). Lose both the passphrase and the code, and the data is gone; the UI must say so
   plainly.
4. The **key bundle** (KDF parameters, salts, the two wrapped copies of the key) is safe to store
   anywhere. It goes to the server for sync and into the manifest of every backup file.
5. Every record — a library item with its title, file name, original file bytes and song model; a
   progress record; a setting — is encrypted with AES-256-GCM under the library key. The
   ciphertext is bound to where it belongs (the record id and version, or the backup entry path),
   compressed when that helps and padded (Padmé) so its size gives away only its rough magnitude.

## The backup file

A one-tap export is an ordinary `.zip`:

```text
manifest.json        plaintext: format version, creation time, key bundle
README.txt           plaintext: what the file is and how to restore it
index.otr            encrypted: list of entries
progress.otr         encrypted
settings.otr         encrypted
library/000001.otr   encrypted, one per library item
```

Nothing in the clear names a piece. The encrypted index lists every entry, and every entry is
bound to the backup's id and its own path, so a removed, swapped or foreign entry makes the
restore fail instead of silently restoring something else. Restoring needs the passphrase or the
recovery code (`importBackup`), or nothing at all on a device that already holds the same key
(`importBackupWithKey`, matched by `manifest.keys.keyId`).

```ts
import { createVault, exportBackup, importBackup } from '@opentiles/vault';

const { vault, recoveryCode } = await createVault(passphrase);
const file = await exportBackup(vault, { library: items, progress, settings });
// later, on any device
const { data } = await importBackup(file, { passphrase }); // or { recoveryCode }
```

`library` items, `progress` and `settings` are plain data; `Uint8Array`s (the original files) are
kept as bytes. Dates, `Map`s and class instances are refused rather than silently changed.

## Sync

Each record has an opaque random id, a server **version** and a place in the account's **change
log** (`seq`). The client:

1. **Pulls** `GET /v1/changes?since=<cursor>` page by page, downloads each changed record it does
   not have yet, decrypts it and merges it.
2. **Pushes** every local change with `If-Match: "<base version>"` (or `If-None-Match: *` for a new
   record). If another device got there first, the server answers 412; the client downloads the
   newer copy and applies the rule below, then retries on top of it.

**Conflict rule: last writer wins, per record.** Each change carries a hybrid-clock time (wall
clock, never behind anything already seen) and the device id; the later change wins, ties go to the
higher device id. Every device applies the same rule, so all of them settle on the same copy.
Deletions are synced as encrypted tombstones and follow the same rule (a later edit brings a
record back; a later deletion removes it).

Records that cannot be decrypted (damaged, or written by a newer app version) are reported in
`SyncResult.failed` and skipped, so one bad record never blocks the rest.

```ts
import {
  SyncEngine,
  createSyncApi,
  createRemoteVault,
  unlockRemoteVault,
} from '@opentiles/sync-client';

const api = createSyncApi({ baseUrl: 'https://sync.opentiles.example' });
await api.startEmailSignIn(email); // then finishEmailSignIn({ token }) or ({ email, code })
const { vault, recoveryCode } = await createRemoteVault(api, passphrase); // first device
// or: const { vault } = await unlockRemoteVault(api, { passphrase });     // other devices
const engine = new SyncEngine({ api, key: vault.key, store, deviceId, onRemoteChange });
await engine.change(id, 'library', item);
await engine.sync();
```

The client refuses to upload anything that is not a sealed record or a wrapped key bundle, as a
second line of defence against a coding mistake.

### Signing in

- **Email link.** `POST /v1/auth/email/start` sends a link (`APP_ORIGIN/sync/sign-in#token=…`,
  the token in the fragment so it never reaches a web server log) and an 8-digit code. Both work
  once and expire after 15 minutes. The code exists for iPad home-screen apps: a link in Mail opens
  Safari, which has separate storage from the installed app, so the user types the code instead.
  Five wrong codes burn all open links for that address.
- **Passkeys.** Once signed in, a device can add a passkey (`/v1/passkeys/options`, then
  `/v1/passkeys`), and sign in later with `/v1/auth/passkey/options` + `/verify` (discoverable
  credentials, no username). Passkeys are bound to `RP_ID`, the app's registrable domain.
- Sessions are opaque 256-bit bearer tokens; the server stores only their SHA-256. They last 90
  days from last use. No cookies.

## What the server can see

| The server stores                                                     | It never sees                                      |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| account email address                                                 | titles, file names, composers, any file contents   |
| number of records, their sizes (rounded up by padding) and versions   | progress, settings, what kind each record is       |
| timestamps: account creation, record updates, session and passkey use | the passphrase, the recovery code, the library key |
| passkey public keys                                                   | IP addresses (used in memory for rate limits only) |
| the wrapped key bundle (useless without the passphrase or code)       |                                                    |

Record ids are random, not derived from anything about the piece. Request logs hold only the
method, the route pattern (`/v1/blobs/:id`, never the id), the status and the duration.

**Limits of this protection.** The server can withhold or delay data, or serve a new device an
older copy of a record it has never seen; it cannot read, alter or swap records undetected. Sizes
and timing are visible by design (spec §10).

## Crash reports (opt-in)

The app sends a report only after the user switches crash reports on. `POST /v1/crash` takes a
small JSON object (`app`, `version`, `message`, optional `stack`, `platform` and a few
non-identifying `context` values), at most 16 KiB. The server drops unknown fields, scrubs email
addresses and secret-looking parameters, rounds the time down to the hour, never links a report to
an account (even if a session token is sent) and never stores the sender's address. Reports are
deleted after 30 days. Rate limits: 10 per client per hour, 1000 per hour overall.

Callers must not put titles, file names or anything from the library into a report;
`buildCrashReport` in `sync-client` builds one from an `Error`.

To read them: `sqlite3 /data/sync.db "SELECT datetime(received_at/1000,'unixepoch'), report FROM crash_reports ORDER BY id DESC LIMIT 50"`.

## Running the service

Requirements: Node 22.13 or newer (for `node:sqlite`), an S3-compatible bucket in the EU, an SMTP
account or an HTTP email API, and a TLS-terminating reverse proxy.

```sh
cp apps/sync-api/.env.example apps/sync-api/.env   # edit it
pnpm --filter @opentiles/sync-api dev               # builds and serves on :8787
```

With Docker, from the repository root:

```sh
docker build -f apps/sync-api/Dockerfile -t opentiles-sync .
docker run --env-file apps/sync-api/.env -p 8787:8787 -v opentiles-sync:/data opentiles-sync
```

### Settings

All settings are environment variables; `apps/sync-api/.env.example` lists every one.

| Variable                                   | Meaning                                                                      |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `APP_ORIGIN`                               | the web app's origin(s), comma-separated; CORS and passkeys use it           |
| `RP_ID`                                    | passkey domain, e.g. `opentiles.example` (default: `APP_ORIGIN`'s host)      |
| `MAGIC_LINK_URL`                           | sign-in link with `{token}`; default `APP_ORIGIN/sync/sign-in#token={token}` |
| `DATABASE_PATH`                            | SQLite file for accounts, sessions and the version log                       |
| `STORAGE` = `fs` \| `s3`                   | where encrypted blobs live                                                   |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, … | S3-compatible storage; pick an EU region                                     |
| `MAILER` = `console` \| `smtp` \| `http`   | how sign-in emails go out; `console` is refused in production                |
| `QUOTA_BYTES`                              | per-account quota, default 250 MB                                            |
| `TRUST_PROXY`                              | read the client address from `X-Forwarded-For` (last entry)                  |
| `CRASH_REPORTS`, `CRASH_RETENTION_DAYS`    | switch crash reports off, or change retention                                |

### Hosting checklist

- [ ] Object storage bucket in an EU region, private, with server-side encryption on (defence in
      depth; the data is already encrypted). No public access, no access logging of object keys to
      third parties.
- [ ] The VM or container and its volume (`/data`, the SQLite database) in the EU. Back the
      database up daily (`sqlite3 sync.db ".backup backup.db"`); losing it loses the version log.
- [ ] TLS at the proxy, `TRUST_PROXY=true` only behind it. The proxy must not log request bodies
      or `Authorization` headers.
- [ ] Email provider in the EU; the sign-in email is the only message the service sends.
- [ ] `NODE_ENV=production`, `APP_ORIGIN` on https.
- [ ] The privacy policy (P2-17) lists exactly the "server stores" column above.

### Account deletion

`DELETE /v1/account` removes, in one transaction, the account, its sessions, passkeys, wrapped key
and version log, and queues its objects. The objects are deleted straight away; if storage is
unavailable, the maintenance job (every 10 minutes) retries until they are gone. From the moment
the call returns, nothing of the account can be read through the API.

## API summary

All endpoints except sign-in, `/healthz` and `/v1/crash` need `Authorization: Bearer <token>`.
Errors are JSON: `{ "error": "<code>", "message": "<plain English>" }`.

| Method and path                        | Purpose                                                            |
| -------------------------------------- | ------------------------------------------------------------------ |
| `POST /v1/auth/email/start`            | `{ email }` → sends the link and code (202)                        |
| `POST /v1/auth/email/verify`           | `{ token }` or `{ email, code }` → `{ token, expiresAt, created }` |
| `POST /v1/auth/passkey/options`        | → `{ challengeId, options }` for `navigator.credentials.get`       |
| `POST /v1/auth/passkey/verify`         | `{ challengeId, response }` → session                              |
| `POST /v1/auth/sign-out`               | ends this session                                                  |
| `POST /v1/passkeys/options`            | → `{ challengeId, options }` for `navigator.credentials.create`    |
| `POST /v1/passkeys`                    | `{ challengeId, response }` → adds a passkey                       |
| `DELETE /v1/passkeys/:id`              | removes a passkey                                                  |
| `GET /v1/account`                      | email, usage, quota, passkeys                                      |
| `DELETE /v1/account`                   | deletes the account and every blob                                 |
| `GET` / `PUT /v1/keys`                 | the wrapped key bundle (compare-and-set with `If-Match`)           |
| `GET /v1/changes?since=&limit=`        | change log page: `{ changes, cursor, more }`                       |
| `GET` / `PUT` / `DELETE /v1/blobs/:id` | encrypted record, versioned with `If-Match` / `If-None-Match`      |
| `POST /v1/crash`                       | opt-in anonymous crash report                                      |
| `GET /healthz`                         | liveness                                                           |

Status codes worth handling in the app: 401 (sign in again), 412 (version conflict, handled by the
engine), 413 (record too large), 429 (slow down), 507 (`quota-exceeded` or `too-many-records`).
