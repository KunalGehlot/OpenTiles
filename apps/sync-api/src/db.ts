// Metadata store: accounts, sessions, passkeys, the blob version log and wrapped keys, in SQLite
// (node:sqlite, built into Node 22). Blob contents live in the blob store, never here.
//
// Every method is synchronous. Node runs one request handler at a time between awaits, so a
// method body is atomic with respect to other requests; the BEGIN/COMMIT around multi-statement
// writes makes it atomic on disk too.
import { timingSafeEqual } from 'node:crypto';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  webauthn_user_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  blob_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS email_tokens_email ON email_tokens(email);
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  backed_up INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS credentials_user ON credentials(user_id);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  size INTEGER NOT NULL,
  object_key TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS blobs_changes ON blobs(user_id, seq);
CREATE TABLE IF NOT EXISTS key_bundles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  bundle TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deletion_queue (
  user_id TEXT PRIMARY KEY,
  queued_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS crash_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at INTEGER NOT NULL,
  report TEXT NOT NULL
);
`;

type Row = Record<string, SQLOutputValue>;

function str(row: Row, key: string): string {
  const v = row[key];
  if (typeof v !== 'string') throw new Error(`Expected text in column ${key}`);
  return v;
}

function num(row: Row, key: string): number {
  const v = row[key];
  if (typeof v === 'bigint') return Number(v);
  if (typeof v !== 'number') throw new Error(`Expected a number in column ${key}`);
  return v;
}

function optStr(row: Row, key: string): string | null {
  const v = row[key];
  return v === null || v === undefined ? null : str(row, key);
}

function optNum(row: Row, key: string): number | null {
  const v = row[key];
  return v === null || v === undefined ? null : num(row, key);
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface User {
  id: string;
  email: string;
  webauthnUserId: string;
  createdAt: number;
  seq: number;
  usedBytes: number;
  blobCount: number;
}

export interface Credential {
  id: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[];
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface BlobRow {
  id: string;
  version: number;
  seq: number;
  size: number;
  /** Null once the record was deleted (a tombstone kept so other devices learn of it). */
  objectKey: string | null;
  updatedAt: number;
}

export type WriteCheck =
  | { ok: true; currentVersion: number; previousObjectKey: string | null }
  | { ok: false; reason: 'conflict'; currentVersion: number; deleted: boolean }
  | { ok: false; reason: 'quota' }
  | { ok: false; reason: 'too-many' }
  | { ok: false; reason: 'no-account' };

export interface Limits {
  quotaBytes: number;
  maxBlobs: number;
}

function toUser(row: Row): User {
  return {
    id: str(row, 'id'),
    email: str(row, 'email'),
    webauthnUserId: str(row, 'webauthn_user_id'),
    createdAt: num(row, 'created_at'),
    seq: num(row, 'seq'),
    usedBytes: num(row, 'used_bytes'),
    blobCount: num(row, 'blob_count'),
  };
}

function toBlob(row: Row): BlobRow {
  return {
    id: str(row, 'id'),
    version: num(row, 'version'),
    seq: num(row, 'seq'),
    size: num(row, 'size'),
    objectKey: optStr(row, 'object_key'),
    updatedAt: num(row, 'updated_at'),
  };
}

function toCredential(row: Row): Credential {
  const key = row.public_key;
  if (!(key instanceof Uint8Array)) throw new Error('Expected a blob in column public_key');
  return {
    id: str(row, 'id'),
    userId: str(row, 'user_id'),
    publicKey: new Uint8Array(key),
    counter: num(row, 'counter'),
    transports: JSON.parse(str(row, 'transports')) as string[],
    backedUp: num(row, 'backed_up') === 1,
    createdAt: num(row, 'created_at'),
    lastUsedAt: optNum(row, 'last_used_at'),
  };
}

export type Database = ReturnType<typeof openDatabase>;

/** Opens (and if needed creates) the metadata database. Use `:memory:` in tests. */
export function openDatabase(path: string) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const version = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema');
  if (version === undefined) {
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema', String(SCHEMA_VERSION));
  } else if (Number(version.value) > SCHEMA_VERSION) {
    throw new Error('The database was created by a newer version of the sync service');
  }

  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare(
      'INSERT INTO users (id, email, webauthn_user_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    blob: db.prepare('SELECT * FROM blobs WHERE user_id = ? AND id = ?'),
  };

  function getUser(id: string): User | undefined {
    const row = q.userById.get(id);
    return row === undefined ? undefined : toUser(row);
  }

  function getBlob(userId: string, id: string): BlobRow | undefined {
    const row = q.blob.get(userId, id);
    return row === undefined ? undefined : toBlob(row);
  }

  function getKeyBundle(
    userId: string,
  ): { version: number; bundle: string; updatedAt: number } | undefined {
    const row = db.prepare('SELECT * FROM key_bundles WHERE user_id = ?').get(userId);
    if (row === undefined) return undefined;
    return {
      version: num(row, 'version'),
      bundle: str(row, 'bundle'),
      updatedAt: num(row, 'updated_at'),
    };
  }

  function checkWrite(
    userId: string,
    blobId: string,
    expectedVersion: number,
    size: number,
    limits: Limits,
  ): WriteCheck {
    const user = getUser(userId);
    // The account was deleted while this request was in flight.
    if (user === undefined) return { ok: false, reason: 'no-account' };
    const blob = getBlob(userId, blobId);
    const currentVersion = blob?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      return { ok: false, reason: 'conflict', currentVersion, deleted: blob?.objectKey === null };
    }
    const live = blob !== undefined && blob.objectKey !== null;
    if (user.usedBytes - (live ? blob.size : 0) + size > limits.quotaBytes) {
      return { ok: false, reason: 'quota' };
    }
    if (!live && user.blobCount + 1 > limits.maxBlobs) return { ok: false, reason: 'too-many' };
    return { ok: true, currentVersion, previousObjectKey: blob?.objectKey ?? null };
  }

  return {
    close(): void {
      db.close();
    },

    // Accounts ------------------------------------------------------------------------------

    getUser,

    findUserByEmail(email: string): User | undefined {
      const row = q.userByEmail.get(email);
      return row === undefined ? undefined : toUser(row);
    },

    createUser(user: { id: string; email: string; webauthnUserId: string; now: number }): User {
      q.insertUser.run(user.id, user.email, user.webauthnUserId, user.now);
      return getUser(user.id)!;
    },

    /**
     * Removes every row that belongs to the account in one transaction and queues the blob
     * prefix for removal from object storage. After this returns, nothing of the account can be
     * read through the API.
     */
    deleteAccount(userId: string, now: number): void {
      tx(() => {
        db.prepare('INSERT OR REPLACE INTO deletion_queue (user_id, queued_at) VALUES (?, ?)').run(
          userId,
          now,
        );
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      });
    },

    pendingDeletions(limit = 50): string[] {
      return db
        .prepare('SELECT user_id FROM deletion_queue ORDER BY queued_at LIMIT ?')
        .all(limit)
        .map((r) => str(r, 'user_id'));
    },

    finishDeletion(userId: string): void {
      db.prepare('DELETE FROM deletion_queue WHERE user_id = ?').run(userId);
    },

    // Sessions -------------------------------------------------------------------------------

    createSession(s: { tokenHash: string; userId: string; now: number; expiresAt: number }): void {
      db.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).run(s.tokenHash, s.userId, s.now, s.now, s.expiresAt);
    },

    getSession(
      tokenHash: string,
      now: number,
    ): { userId: string; lastUsedAt: number; expiresAt: number } | undefined {
      const row = db
        .prepare('SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?')
        .get(tokenHash, now);
      if (row === undefined) return undefined;
      return {
        userId: str(row, 'user_id'),
        lastUsedAt: num(row, 'last_used_at'),
        expiresAt: num(row, 'expires_at'),
      };
    },

    touchSession(tokenHash: string, now: number, expiresAt: number): void {
      db.prepare('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?').run(
        now,
        expiresAt,
        tokenHash,
      );
    },

    deleteSession(tokenHash: string): void {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },

    // Email sign-in ----------------------------------------------------------------------------

    addEmailToken(t: {
      tokenHash: string;
      codeHash: string;
      email: string;
      now: number;
      expiresAt: number;
      keep: number;
    }): void {
      tx(() => {
        db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?').run(t.now);
        // Keep only the newest few links per address, so old emails stop working.
        db.prepare(
          `DELETE FROM email_tokens WHERE email = ? AND token_hash NOT IN (
             SELECT token_hash FROM email_tokens WHERE email = ? ORDER BY created_at DESC LIMIT ?)`,
        ).run(t.email, t.email, Math.max(0, t.keep - 1));
        db.prepare(
          'INSERT INTO email_tokens (token_hash, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        ).run(t.tokenHash, t.email, t.codeHash, t.now, t.expiresAt);
      });
    },

    /** Single use: returns the email for a valid link token and invalidates all its links. */
    takeEmailToken(tokenHash: string, now: number): string | null {
      return tx(() => {
        const row = db
          .prepare('SELECT email FROM email_tokens WHERE token_hash = ? AND expires_at > ?')
          .get(tokenHash, now);
        if (row === undefined) return null;
        const email = str(row, 'email');
        db.prepare('DELETE FROM email_tokens WHERE email = ?').run(email);
        return email;
      });
    },

    /** Checks a typed code. Wrong codes count against every open link for the address. */
    takeEmailCode(email: string, codeHash: string, now: number, maxAttempts: number): boolean {
      return tx(() => {
        const rows = db
          .prepare('SELECT code_hash FROM email_tokens WHERE email = ? AND expires_at > ?')
          .all(email, now);
        if (rows.some((r) => sameText(str(r, 'code_hash'), codeHash))) {
          db.prepare('DELETE FROM email_tokens WHERE email = ?').run(email);
          return true;
        }
        db.prepare('UPDATE email_tokens SET attempts = attempts + 1 WHERE email = ?').run(email);
        db.prepare('DELETE FROM email_tokens WHERE email = ? AND attempts >= ?').run(
          email,
          maxAttempts,
        );
        return false;
      });
    },

    // Passkeys --------------------------------------------------------------------------------

    addChallenge(c: {
      id: string;
      kind: 'register' | 'login';
      userId: string | null;
      challenge: string;
      expiresAt: number;
    }): void {
      db.prepare(
        'INSERT INTO challenges (id, kind, user_id, challenge, expires_at) VALUES (?, ?, ?, ?, ?)',
      ).run(c.id, c.kind, c.userId, c.challenge, c.expiresAt);
    },

    /** Single use: the challenge is removed whether or not it is still valid. */
    takeChallenge(
      id: string,
      kind: 'register' | 'login',
      now: number,
    ): { challenge: string; userId: string | null } | undefined {
      return tx(() => {
        const row = db.prepare('SELECT * FROM challenges WHERE id = ?').get(id);
        db.prepare('DELETE FROM challenges WHERE id = ?').run(id);
        if (row === undefined || str(row, 'kind') !== kind || num(row, 'expires_at') <= now) {
          return undefined;
        }
        return { challenge: str(row, 'challenge'), userId: optStr(row, 'user_id') };
      });
    },

    addCredential(c: Omit<Credential, 'lastUsedAt'>): void {
      db.prepare(
        `INSERT INTO credentials (id, user_id, public_key, counter, transports, backed_up, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        c.id,
        c.userId,
        c.publicKey,
        c.counter,
        JSON.stringify(c.transports),
        c.backedUp ? 1 : 0,
        c.createdAt,
      );
    },

    getCredential(id: string): Credential | undefined {
      const row = db.prepare('SELECT * FROM credentials WHERE id = ?').get(id);
      return row === undefined ? undefined : toCredential(row);
    },

    listCredentials(userId: string): Credential[] {
      return db
        .prepare('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at')
        .all(userId)
        .map(toCredential);
    },

    updateCredentialUse(id: string, counter: number, now: number): void {
      db.prepare('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?').run(
        counter,
        now,
        id,
      );
    },

    deleteCredential(userId: string, id: string): boolean {
      const r = db.prepare('DELETE FROM credentials WHERE user_id = ? AND id = ?').run(userId, id);
      return Number(r.changes) > 0;
    },

    // Blobs -----------------------------------------------------------------------------------

    getBlob,

    /** Records whose sequence number is above `since`, oldest first. */
    listChanges(userId: string, since: number, limit: number): BlobRow[] {
      return db
        .prepare('SELECT * FROM blobs WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?')
        .all(userId, since, limit)
        .map(toBlob);
    },

    /** Version and quota check without writing, used before uploading the object. */
    checkBlobWrite(
      userId: string,
      id: string,
      expectedVersion: number,
      size: number,
      limits: Limits,
    ): WriteCheck {
      return checkWrite(userId, id, expectedVersion, size, limits);
    },

    /**
     * Commits a new version after its object was stored. Re-checks version and quota inside the
     * transaction, since another request may have committed while the object was uploading.
     */
    commitBlobWrite(w: {
      userId: string;
      id: string;
      expectedVersion: number;
      size: number;
      objectKey: string;
      now: number;
      limits: Limits;
    }): WriteCheck & { version?: number; seq?: number } {
      return tx(() => {
        const check = checkWrite(w.userId, w.id, w.expectedVersion, w.size, w.limits);
        if (!check.ok) return check;
        const user = getUser(w.userId)!;
        const previous = getBlob(w.userId, w.id);
        const wasLive = previous !== undefined && previous.objectKey !== null;
        const seq = user.seq + 1;
        const version = check.currentVersion + 1;
        db.prepare('UPDATE users SET seq = ?, used_bytes = ?, blob_count = ? WHERE id = ?').run(
          seq,
          user.usedBytes - (wasLive ? previous.size : 0) + w.size,
          user.blobCount + (wasLive ? 0 : 1),
          w.userId,
        );
        db.prepare(
          `INSERT INTO blobs (user_id, id, version, seq, size, object_key, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (user_id, id) DO UPDATE SET version = excluded.version, seq = excluded.seq,
             size = excluded.size, object_key = excluded.object_key, updated_at = excluded.updated_at`,
        ).run(w.userId, w.id, version, seq, w.size, w.objectKey, w.now);
        return { ...check, version, seq };
      });
    },

    /** Turns a record into a tombstone so other devices see the deletion in the change log. */
    deleteBlob(
      userId: string,
      id: string,
      expectedVersion: number,
      now: number,
    ):
      | { ok: true; version: number; seq: number; objectKey: string | null }
      | { ok: false; reason: 'not-found' }
      | { ok: false; reason: 'conflict'; currentVersion: number; deleted: boolean } {
      return tx(() => {
        const blob = getBlob(userId, id);
        if (blob === undefined) return { ok: false, reason: 'not-found' };
        if (blob.version !== expectedVersion) {
          return {
            ok: false,
            reason: 'conflict',
            currentVersion: blob.version,
            deleted: blob.objectKey === null,
          };
        }
        if (blob.objectKey === null) {
          return { ok: true, version: blob.version, seq: blob.seq, objectKey: null };
        }
        const user = getUser(userId)!;
        const seq = user.seq + 1;
        const version = blob.version + 1;
        db.prepare('UPDATE users SET seq = ?, used_bytes = ?, blob_count = ? WHERE id = ?').run(
          seq,
          user.usedBytes - blob.size,
          user.blobCount - 1,
          userId,
        );
        db.prepare(
          `UPDATE blobs SET version = ?, seq = ?, size = 0, object_key = NULL, updated_at = ?
           WHERE user_id = ? AND id = ?`,
        ).run(version, seq, now, userId, id);
        return { ok: true, version, seq, objectKey: blob.objectKey };
      });
    },

    // Wrapped keys ----------------------------------------------------------------------------

    getKeyBundle,

    /** Compare-and-set: `expectedVersion` 0 means the bundle must not exist yet. */
    putKeyBundle(
      userId: string,
      expectedVersion: number,
      bundle: string,
      now: number,
    ): { ok: true; version: number } | { ok: false; currentVersion: number } {
      return tx(() => {
        const current = getKeyBundle(userId)?.version ?? 0;
        if (current !== expectedVersion) return { ok: false, currentVersion: current };
        db.prepare(
          `INSERT INTO key_bundles (user_id, version, bundle, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id) DO UPDATE SET version = excluded.version, bundle = excluded.bundle,
             updated_at = excluded.updated_at`,
        ).run(userId, current + 1, bundle, now);
        return { ok: true, version: current + 1 };
      });
    },

    // Crash reports ---------------------------------------------------------------------------

    addCrashReport(receivedAt: number, report: string): void {
      db.prepare('INSERT INTO crash_reports (received_at, report) VALUES (?, ?)').run(
        receivedAt,
        report,
      );
    },

    listCrashReports(limit = 100): { receivedAt: number; report: string }[] {
      return db
        .prepare('SELECT received_at, report FROM crash_reports ORDER BY id DESC LIMIT ?')
        .all(limit)
        .map((r) => ({ receivedAt: num(r, 'received_at'), report: str(r, 'report') }));
    },

    // Maintenance -----------------------------------------------------------------------------

    purgeExpired(now: number, crashReportsBefore: number): void {
      tx(() => {
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
        db.prepare('DELETE FROM email_tokens WHERE expires_at <= ?').run(now);
        db.prepare('DELETE FROM challenges WHERE expires_at <= ?').run(now);
        db.prepare('DELETE FROM crash_reports WHERE received_at < ?').run(crashReportsBefore);
      });
    },

    /** Row counts per table, for tests and the operator's sanity checks. */
    counts(): Record<string, number> {
      const out: Record<string, number> = {};
      for (const table of [
        'users',
        'sessions',
        'email_tokens',
        'credentials',
        'challenges',
        'blobs',
        'key_bundles',
        'deletion_queue',
        'crash_reports',
      ]) {
        out[table] = num(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!, 'n');
      }
      return out;
    },
  };
}
