// The HTTP API (spec §10). The service is a blind store: it sees an email address, opaque record
// ids, blob sizes, version numbers and timestamps. Blob contents and the key bundle are
// ciphertext produced on the device; the service never parses them.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { routePath } from 'hono/route';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { BlobStore } from './blob-store.js';
import type { Config } from './config.js';
import { hourFloor, sanitiseCrashReport } from './crash.js';
import type { Database, WriteCheck } from './db.js';
import { signInMessage, type Mailer } from './mailer.js';
import { createRateLimiter } from './rate-limit.js';

export interface AppDeps {
  config: Config;
  db: Database;
  blobs: BlobStore;
  mailer: Mailer;
  now?: () => number;
  /** One line per request: method, route pattern, status, duration. No ids, bodies or addresses. */
  log?: (line: string) => void;
  /** The connecting client's address, used only for in-memory rate limits. */
  clientAddress?: (c: Context) => string | undefined;
}

type Env = { Variables: { userId: string; tokenHash: string } };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const RECORD_ID = /^[A-Za-z0-9_-]{16,64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CODE_ATTEMPTS = 5;
const LINKS_PER_ADDRESS = 3;

function newId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function fail(
  c: Context,
  status: ContentfulStatusCode,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return c.json({ error, message, ...extra }, status);
}

function normaliseEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** `If-None-Match: *` → 0 (must not exist); `If-Match: "n"` → n. */
function expectedVersion(c: Context): number | 'missing' | 'invalid' {
  const ifNoneMatch = c.req.header('if-none-match');
  const ifMatch = c.req.header('if-match');
  if (ifNoneMatch !== undefined && ifMatch !== undefined) return 'invalid';
  if (ifNoneMatch !== undefined) return ifNoneMatch.trim() === '*' ? 0 : 'invalid';
  if (ifMatch !== undefined) {
    const m = /^"([1-9]\d{0,14})"$/.exec(ifMatch.trim());
    return m ? Number(m[1]) : 'invalid';
  }
  return 'missing';
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return null;
  }
  try {
    const value: unknown = await c.req.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function createApp(deps: AppDeps) {
  const { config, db, blobs, mailer } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const limiter = createRateLimiter();
  const app = new Hono<Env>();

  const clientKey = (c: Context): string => {
    let address = deps.clientAddress?.(c);
    if (config.trustProxy) {
      // The trusted proxy appends the real client address last; earlier entries can be forged.
      const forwarded = c.req.header('x-forwarded-for')?.split(',').pop()?.trim();
      if (forwarded) address = forwarded;
    }
    return limiter.clientKey(address ?? 'unknown');
  };

  const limit = (key: string, max: number, windowMs: number) =>
    limiter.hit(key, max, windowMs, now());

  const tooMany = (c: Context) =>
    fail(c, 429, 'rate-limited', 'Too many attempts. Please wait a little and try again.');

  const jsonLimit = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: (c) => fail(c, 413, 'too-large', 'The request is too large.'),
    });

  function issueSession(userId: string) {
    const token = newId(32);
    const t = now();
    const expiresAt = t + config.sessionTtlMs;
    db.createSession({ tokenHash: hash(token), userId, now: t, expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  // Middleware -------------------------------------------------------------------------------

  app.use('*', async (c, next) => {
    const started = now();
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    log(`${c.req.method} ${routePath(c, -1)} ${c.res.status} ${now() - started}ms`);
  });

  app.use(
    '*',
    cors({
      origin: config.appOrigins,
      allowMethods: ['GET', 'PUT', 'POST', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type', 'If-Match', 'If-None-Match'],
      exposeHeaders: ['ETag', 'X-Blob-Version'],
      maxAge: 600,
    }),
  );

  // Browsers always send Origin on cross-origin requests; refuse any that is not the app.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin !== undefined && !config.appOrigins.includes(origin)) {
      return fail(c, 403, 'forbidden-origin', 'This origin may not use the sync service.');
    }
    await next();
  });

  const auth: MiddlewareHandler<Env> = async (c, next) => {
    const m = /^Bearer (\S+)$/.exec(c.req.header('authorization') ?? '');
    const token = m?.[1];
    if (token === undefined || !TOKEN.test(token)) {
      return fail(c, 401, 'unauthorised', 'Please sign in.');
    }
    const tokenHash = hash(token);
    const t = now();
    const session = db.getSession(tokenHash, t);
    if (session === undefined) return fail(c, 401, 'unauthorised', 'Please sign in again.');
    // Sliding expiry, written at most once an hour.
    if (t - session.lastUsedAt > HOUR) db.touchSession(tokenHash, t, t + config.sessionTtlMs);
    if (!limit(`user:${session.userId}`, 1200, MINUTE)) return tooMany(c);
    c.set('userId', session.userId);
    c.set('tokenHash', tokenHash);
    await next();
  };

  app.onError((err, c) => {
    // Never log request content; the error name is enough to start looking.
    log(`error ${c.req.method} ${routePath(c, -1)} ${err.name}`);
    return fail(c, 500, 'internal', 'Something went wrong on the server.');
  });

  app.notFound((c) => fail(c, 404, 'not-found', 'Not found.'));

  app.get('/healthz', (c) => c.text('ok'));

  // Email sign-in ----------------------------------------------------------------------------

  app.post('/v1/auth/email/start', jsonLimit(2048), async (c) => {
    const body = await readJson(c);
    const email = normaliseEmail(body?.email);
    if (email === null) return fail(c, 400, 'invalid-email', 'Please enter a valid email address.');
    if (
      !limit(`email-start:${clientKey(c)}`, 20, HOUR) ||
      !limit(`email:${hash(email)}`, 5, HOUR)
    ) {
      return tooMany(c);
    }
    const token = newId(32);
    const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
    const t = now();
    db.addEmailToken({
      tokenHash: hash(token),
      codeHash: hash(`${email}\0${code}`),
      email,
      now: t,
      expiresAt: t + config.emailTokenTtlMs,
      keep: LINKS_PER_ADDRESS,
    });
    const link = config.magicLinkUrl.replace('{token}', token);
    const minutes = Math.round(config.emailTokenTtlMs / MINUTE);
    try {
      await mailer.send(
        signInMessage(email, link, `${code.slice(0, 4)}-${code.slice(4)}`, minutes),
      );
    } catch {
      return fail(c, 503, 'email-failed', 'The sign-in email could not be sent. Please try again.');
    }
    return c.json({ sent: true }, 202);
  });

  app.post('/v1/auth/email/verify', jsonLimit(2048), async (c) => {
    if (!limit(`email-verify:${clientKey(c)}`, 30, 15 * MINUTE)) return tooMany(c);
    const body = await readJson(c);
    const t = now();
    let email: string | null = null;
    if (typeof body?.token === 'string' && TOKEN.test(body.token)) {
      email = db.takeEmailToken(hash(body.token), t);
    } else if (typeof body?.code === 'string') {
      const address = normaliseEmail(body.email);
      const code = body.code.replace(/\D/g, '');
      if (address !== null && code.length === 8) {
        email = db.takeEmailCode(address, hash(`${address}\0${code}`), t, MAX_CODE_ATTEMPTS)
          ? address
          : null;
      }
    }
    if (email === null) {
      return fail(c, 401, 'invalid-link', 'This sign-in link or code is wrong or has expired.');
    }
    let user = db.findUserByEmail(email);
    const created = user === undefined;
    user ??= db.createUser({ id: newId(), email, webauthnUserId: newId(32), now: t });
    return c.json({ ...issueSession(user.id), created });
  });

  app.post('/v1/auth/sign-out', auth, (c) => {
    db.deleteSession(c.get('tokenHash'));
    return c.body(null, 204);
  });

  // Passkey sign-in --------------------------------------------------------------------------

  app.post('/v1/auth/passkey/options', async (c) => {
    if (!limit(`passkey:${clientKey(c)}`, 60, 15 * MINUTE)) return tooMany(c);
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      userVerification: 'preferred',
      timeout: config.challengeTtlMs,
    });
    const challengeId = newId();
    db.addChallenge({
      id: challengeId,
      kind: 'login',
      userId: null,
      challenge: options.challenge,
      expiresAt: now() + config.challengeTtlMs,
    });
    return c.json({ challengeId, options });
  });

  app.post('/v1/auth/passkey/verify', jsonLimit(64 * 1024), async (c) => {
    if (!limit(`passkey:${clientKey(c)}`, 60, 15 * MINUTE)) return tooMany(c);
    const body = await readJson(c);
    const rejected = () => fail(c, 401, 'passkey-rejected', 'That passkey could not be used.');
    if (typeof body?.challengeId !== 'string' || typeof body.response !== 'object') {
      return rejected();
    }
    const response = body.response as AuthenticationResponseJSON | null;
    const challenge = db.takeChallenge(body.challengeId, 'login', now());
    if (challenge === undefined || response === null || typeof response.id !== 'string') {
      return rejected();
    }
    const credential = db.getCredential(response.id);
    if (credential === undefined) return rejected();
    const user = db.getUser(credential.userId);
    if (user === undefined) return rejected();
    const userHandle = response.response?.userHandle;
    if (userHandle !== undefined && userHandle !== user.webauthnUserId) return rejected();
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.appOrigins,
        expectedRPID: config.rpId,
        credential: {
          id: credential.id,
          publicKey: new Uint8Array(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
        },
        requireUserVerification: false,
      });
      if (!result.verified) return rejected();
      db.updateCredentialUse(credential.id, result.authenticationInfo.newCounter, now());
    } catch {
      return rejected();
    }
    return c.json(issueSession(user.id));
  });

  // Passkey management (signed in) -----------------------------------------------------------

  app.post('/v1/passkeys/options', auth, async (c) => {
    const user = db.getUser(c.get('userId'));
    if (user === undefined) return fail(c, 401, 'unauthorised', 'Please sign in again.');
    const existing = db.listCredentials(user.id);
    if (existing.length >= config.maxPasskeys) {
      return fail(c, 409, 'too-many-passkeys', 'Remove a passkey before adding another.');
    }
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userName: user.email,
      userID: new Uint8Array(Buffer.from(user.webauthnUserId, 'base64url')),
      userDisplayName: user.email,
      attestationType: 'none',
      excludeCredentials: existing.map((cred) => ({ id: cred.id, transports: cred.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      timeout: config.challengeTtlMs,
    });
    const challengeId = newId();
    db.addChallenge({
      id: challengeId,
      kind: 'register',
      userId: user.id,
      challenge: options.challenge,
      expiresAt: now() + config.challengeTtlMs,
    });
    return c.json({ challengeId, options });
  });

  app.post('/v1/passkeys', auth, jsonLimit(64 * 1024), async (c) => {
    const userId = c.get('userId');
    const body = await readJson(c);
    const rejected = () => fail(c, 400, 'passkey-rejected', 'The passkey could not be added.');
    if (typeof body?.challengeId !== 'string' || typeof body.response !== 'object') {
      return rejected();
    }
    const challenge = db.takeChallenge(body.challengeId, 'register', now());
    if (challenge === undefined || challenge.userId !== userId || body.response === null) {
      return rejected();
    }
    let info;
    try {
      const result = await verifyRegistrationResponse({
        response: body.response as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.appOrigins,
        expectedRPID: config.rpId,
        requireUserVerification: false,
      });
      if (!result.verified) return rejected();
      info = result.registrationInfo;
    } catch {
      return rejected();
    }
    if (db.getCredential(info.credential.id) !== undefined) {
      return fail(c, 409, 'passkey-exists', 'This passkey is already registered.');
    }
    db.addCredential({
      id: info.credential.id,
      userId,
      publicKey: info.credential.publicKey,
      counter: info.credential.counter,
      transports: info.credential.transports ?? [],
      backedUp: info.credentialBackedUp,
      createdAt: now(),
    });
    return c.json({ id: info.credential.id }, 201);
  });

  app.delete('/v1/passkeys/:id', auth, (c) => {
    return db.deleteCredential(c.get('userId'), c.req.param('id'))
      ? c.body(null, 204)
      : fail(c, 404, 'not-found', 'No such passkey.');
  });

  // Account ----------------------------------------------------------------------------------

  app.get('/v1/account', auth, (c) => {
    const user = db.getUser(c.get('userId'));
    if (user === undefined) return fail(c, 401, 'unauthorised', 'Please sign in again.');
    return c.json({
      email: user.email,
      createdAt: new Date(user.createdAt).toISOString(),
      usage: { bytes: user.usedBytes, records: user.blobCount },
      quota: { bytes: config.quotaBytes, records: config.maxBlobs },
      passkeys: db.listCredentials(user.id).map((cred) => ({
        id: cred.id,
        createdAt: new Date(cred.createdAt).toISOString(),
        lastUsedAt: cred.lastUsedAt === null ? null : new Date(cred.lastUsedAt).toISOString(),
        backedUp: cred.backedUp,
      })),
    });
  });

  app.delete('/v1/account', auth, async (c) => {
    db.deleteAccount(c.get('userId'), now());
    // Rows are gone already; the objects follow now, or on the next maintenance run.
    await processDeletions();
    return c.body(null, 204);
  });

  // Wrapped library key ----------------------------------------------------------------------

  app.get('/v1/keys', auth, (c) => {
    const stored = db.getKeyBundle(c.get('userId'));
    if (stored === undefined) return fail(c, 404, 'not-found', 'No key has been stored yet.');
    c.header('ETag', `"${stored.version}"`);
    return c.json({ version: stored.version, bundle: JSON.parse(stored.bundle) as unknown });
  });

  app.put('/v1/keys', auth, jsonLimit(config.maxKeyBundleBytes), async (c) => {
    const expected = expectedVersion(c);
    if (expected === 'missing') {
      return fail(c, 428, 'precondition-required', 'Send If-Match or If-None-Match.');
    }
    if (expected === 'invalid') return fail(c, 400, 'invalid-request', 'Bad precondition.');
    const body = await readJson(c);
    const bundle = body?.bundle;
    if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) {
      return fail(c, 400, 'invalid-request', 'Send { "bundle": { ... } }.');
    }
    const result = db.putKeyBundle(c.get('userId'), expected, JSON.stringify(bundle), now());
    if (!result.ok) {
      return fail(c, 412, 'version-conflict', 'The key was changed on another device.', {
        current: { version: result.currentVersion },
      });
    }
    c.header('ETag', `"${result.version}"`);
    return c.json({ version: result.version });
  });

  // Encrypted blobs --------------------------------------------------------------------------

  const writeFailure = (c: Context, check: Exclude<WriteCheck, { ok: true }>) => {
    switch (check.reason) {
      case 'conflict':
        return fail(c, 412, 'version-conflict', 'This record changed on another device.', {
          current: { version: check.currentVersion, deleted: check.deleted },
        });
      case 'quota':
        return fail(c, 507, 'quota-exceeded', 'Your sync storage is full.', {
          quota: { bytes: config.quotaBytes },
        });
      case 'too-many':
        return fail(c, 507, 'too-many-records', 'You have reached the maximum number of records.');
      case 'no-account':
        return fail(c, 401, 'unauthorised', 'Please sign in again.');
    }
  };

  app.get('/v1/changes', auth, (c) => {
    const since = Number(c.req.query('since') ?? '0');
    const max = Number(c.req.query('limit') ?? '500');
    if (!Number.isSafeInteger(since) || since < 0 || !Number.isInteger(max) || max < 1) {
      return fail(c, 400, 'invalid-request', 'Bad since or limit.');
    }
    const pageSize = Math.min(max, 1000);
    const rows = db.listChanges(c.get('userId'), since, pageSize);
    return c.json({
      changes: rows.map((r) => ({
        id: r.id,
        version: r.version,
        seq: r.seq,
        size: r.size,
        deleted: r.objectKey === null,
      })),
      cursor: rows.at(-1)?.seq ?? since,
      more: rows.length === pageSize,
    });
  });

  app.get('/v1/blobs/:id', auth, async (c) => {
    const userId = c.get('userId');
    const id = c.req.param('id');
    if (!RECORD_ID.test(id)) return fail(c, 400, 'invalid-request', 'Bad record id.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = db.getBlob(userId, id);
      if (row === undefined) return fail(c, 404, 'not-found', 'No such record.');
      if (row.objectKey === null) {
        return fail(c, 410, 'gone', 'This record was deleted.', { version: row.version });
      }
      const data = await blobs.get(row.objectKey);
      // Null means a newer version replaced the object while we read the row; read again.
      if (data === null) continue;
      return c.body(new Uint8Array(data), 200, {
        'Content-Type': 'application/octet-stream',
        ETag: `"${row.version}"`,
        'X-Blob-Version': String(row.version),
      });
    }
    return fail(c, 503, 'try-again', 'The record is changing; please try again.');
  });

  app.put(
    '/v1/blobs/:id',
    auth,
    bodyLimit({
      maxSize: config.maxBlobBytes,
      onError: (c) => fail(c, 413, 'too-large', 'This record is too large to sync.'),
    }),
    async (c) => {
      const userId = c.get('userId');
      const id = c.req.param('id');
      if (!RECORD_ID.test(id)) return fail(c, 400, 'invalid-request', 'Bad record id.');
      const expected = expectedVersion(c);
      if (expected === 'missing') {
        return fail(c, 428, 'precondition-required', 'Send If-Match or If-None-Match.');
      }
      if (expected === 'invalid') return fail(c, 400, 'invalid-request', 'Bad precondition.');
      const body = new Uint8Array(await c.req.arrayBuffer());
      if (body.length === 0) return fail(c, 400, 'invalid-request', 'Empty record.');
      const limits = { quotaBytes: config.quotaBytes, maxBlobs: config.maxBlobs };
      const pre = db.checkBlobWrite(userId, id, expected, body.length, limits);
      if (!pre.ok) return writeFailure(c, pre);

      // A fresh object key per write: the row switches to it atomically, and concurrent writers
      // never overwrite each other's objects.
      const objectKey = `u/${userId}/${id}/${pre.currentVersion + 1}-${newId(6)}`;
      await blobs.put(objectKey, body);
      const result = db.commitBlobWrite({
        userId,
        id,
        expectedVersion: expected,
        size: body.length,
        objectKey,
        now: now(),
        limits,
      });
      if (!result.ok) {
        await blobs.delete(objectKey).catch(() => undefined);
        return writeFailure(c, result);
      }
      if (result.previousObjectKey !== null) {
        await blobs.delete(result.previousObjectKey).catch(() => undefined);
      }
      c.header('ETag', `"${result.version}"`);
      return c.json({ version: result.version, seq: result.seq });
    },
  );

  app.delete('/v1/blobs/:id', auth, async (c) => {
    const id = c.req.param('id');
    if (!RECORD_ID.test(id)) return fail(c, 400, 'invalid-request', 'Bad record id.');
    const expected = expectedVersion(c);
    if (expected === 'missing' || expected === 0) {
      return fail(c, 428, 'precondition-required', 'Send If-Match.');
    }
    if (expected === 'invalid') return fail(c, 400, 'invalid-request', 'Bad precondition.');
    const result = db.deleteBlob(c.get('userId'), id, expected, now());
    if (!result.ok) {
      return result.reason === 'not-found'
        ? fail(c, 404, 'not-found', 'No such record.')
        : writeFailure(c, result);
    }
    if (result.objectKey !== null) await blobs.delete(result.objectKey).catch(() => undefined);
    return c.json({ version: result.version, seq: result.seq });
  });

  // Crash reports (opt-in, anonymous) ---------------------------------------------------------

  app.post(
    '/v1/crash',
    bodyLimit({
      maxSize: config.crashReports.maxBytes,
      onError: (c) => fail(c, 413, 'too-large', 'The report is too large.'),
    }),
    async (c) => {
      if (!config.crashReports.enabled) return fail(c, 404, 'not-found', 'Not found.');
      if (
        !limit(`crash:${clientKey(c)}`, config.crashReports.perClientPerHour, HOUR) ||
        !limit('crash:all', config.crashReports.globalPerHour, HOUR)
      ) {
        return tooMany(c);
      }
      const report = sanitiseCrashReport(await readJson(c));
      if (report === null) return fail(c, 400, 'invalid-request', 'Not a crash report.');
      db.addCrashReport(hourFloor(now()), JSON.stringify(report));
      return c.json({ received: true }, 202);
    },
  );

  // Maintenance ------------------------------------------------------------------------------

  let deleting: Promise<void> | null = null;

  /** Removes the objects of deleted accounts; retried until it succeeds. */
  function processDeletions(): Promise<void> {
    deleting ??= (async () => {
      try {
        for (const userId of db.pendingDeletions()) {
          try {
            await blobs.deletePrefix(`u/${userId}/`);
            db.finishDeletion(userId);
          } catch (error) {
            log(`account deletion pending, will retry (${(error as Error).name})`);
          }
        }
      } finally {
        deleting = null;
      }
    })();
    return deleting;
  }

  async function runMaintenance(): Promise<void> {
    const t = now();
    db.purgeExpired(t, t - config.crashReports.retentionDays * 24 * HOUR);
    await processDeletions();
  }

  return { app, processDeletions, runMaintenance };
}

export type SyncApp = ReturnType<typeof createApp>;
