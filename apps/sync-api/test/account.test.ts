import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { fsBlobStore, memoryBlobStore, type BlobStore } from '../src/blob-store.js';
import { makeConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { memoryMailer } from '../src/mailer.js';
import { ORIGIN, setup } from './helpers.js';

async function upload(t: ReturnType<typeof setup>, headers: Record<string, string>, n: number) {
  for (let i = 0; i < n; i++) {
    const res = await t.request(`/v1/blobs/record_${String(i).padStart(10, '0')}`, {
      method: 'PUT',
      headers: { ...headers, 'if-none-match': '*' },
      body: randomBytes(64),
    });
    expect(res.status).toBe(200);
  }
}

describe('account deletion', () => {
  it('removes every blob, the key bundle, sessions and passkeys in one step', async () => {
    const blobs = memoryBlobStore();
    const t = setup({}, blobs);
    const keep = await t.signIn('keep@example.org');
    const gone = await t.signIn('gone@example.org');
    await upload(t, keep.headers, 2);
    await upload(t, gone.headers, 5);
    await t.json(
      'PUT',
      '/v1/keys',
      { bundle: { a: 1 } },
      { ...gone.headers, 'if-none-match': '*' },
    );
    expect(blobs.keys()).toHaveLength(7);

    const res = await t.request('/v1/account', { method: 'DELETE', headers: gone.headers });
    expect(res.status).toBe(204);
    expect(blobs.keys()).toHaveLength(2);
    expect((await t.request('/v1/account', { headers: gone.headers })).status).toBe(401);
    expect(t.db.counts()).toMatchObject({
      users: 1,
      sessions: 1,
      blobs: 2,
      key_bundles: 0,
      deletion_queue: 0,
    });
    // The other account is untouched.
    const other = await t.request('/v1/changes', { headers: keep.headers });
    expect(((await other.json()) as { changes: unknown[] }).changes).toHaveLength(2);

    // The address can start again with an empty account.
    const fresh = await t.signIn('gone@example.org');
    expect(fresh.created).toBe(true);
    const changes = await t.request('/v1/changes', { headers: fresh.headers });
    expect(((await changes.json()) as { changes: unknown[] }).changes).toEqual([]);
  });

  it('retries object removal until storage succeeds', async () => {
    const inner = memoryBlobStore();
    let failures = 1;
    const flaky: BlobStore & { keys: () => string[] } = {
      ...inner,
      async deletePrefix(prefix) {
        if (failures > 0) {
          failures -= 1;
          throw new Error('storage unavailable');
        }
        return inner.deletePrefix(prefix);
      },
    };
    const t = setup({}, flaky);
    const s = await t.signIn();
    await upload(t, s.headers, 3);
    expect((await t.request('/v1/account', { method: 'DELETE', headers: s.headers })).status).toBe(
      204,
    );
    // Nothing is reachable any more, but the objects are still queued for removal.
    expect((await t.request('/v1/account', { headers: s.headers })).status).toBe(401);
    expect(t.db.counts().deletion_queue).toBe(1);
    expect(inner.keys()).toHaveLength(3);
    await t.sync.runMaintenance();
    expect(t.db.counts().deletion_queue).toBe(0);
    expect(inner.keys()).toHaveLength(0);
    expect(t.logs.some((l) => l.startsWith('account deletion pending'))).toBe(true);
  });

  it('removes the files of a filesystem store', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opentiles-sync-'));
    try {
      const t = setup({}, fsBlobStore(join(dir, 'blobs')));
      const s = await t.signIn();
      await upload(t, s.headers, 3);
      expect(await readdir(join(dir, 'blobs', 'u'))).toHaveLength(1);
      await t.request('/v1/account', { method: 'DELETE', headers: s.headers });
      expect(await readdir(join(dir, 'blobs', 'u'))).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('what the server keeps', () => {
  it('stores the email but no session or sign-in tokens in the clear', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'opentiles-sync-'));
    try {
      const dbPath = join(dir, 'sync.db');
      const db = openDatabase(dbPath);
      const mailer = memoryMailer();
      const { app } = createApp({
        config: makeConfig({ appOrigins: [ORIGIN] }),
        db,
        blobs: memoryBlobStore(),
        mailer,
        log: () => undefined,
      });
      const post = (path: string, body: unknown) =>
        app.request(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      await post('/v1/auth/email/start', { email: 'private@example.org' });
      const link = /#token=([\w-]+)/.exec(mailer.sent[0]!.text)![1]!;
      const code = /code in the app: (\d{4}-\d{4})/.exec(mailer.sent[0]!.text)![1]!;
      const session = (await (await post('/v1/auth/email/verify', { token: link })).json()) as {
        token: string;
      };
      db.close();
      const files = await readdir(dir);
      const raw = Buffer.concat(
        await Promise.all(files.map((f) => readFile(join(dir, f)))),
      ).toString('latin1');
      expect(raw).toContain('private@example.org');
      expect(raw).not.toContain(session.token);
      expect(raw).not.toContain(link);
      expect(raw).not.toContain(code.replace('-', ''));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('logs only method, route pattern, status and duration', async () => {
    const t = setup();
    const s = await t.signIn('logged@example.org');
    await t.request('/v1/blobs/record_secret_id_123', {
      method: 'PUT',
      headers: { ...s.headers, 'if-none-match': '*' },
      body: randomBytes(10),
    });
    for (const line of t.logs) {
      expect(line).toMatch(/^(GET|POST|PUT|DELETE|OPTIONS) \/\S* \d{3} \d+ms$/);
      expect(line).not.toContain('logged@example.org');
      expect(line).not.toContain('record_secret_id_123');
      expect(line).not.toContain(s.token);
    }
    expect(t.logs).toContain('PUT /v1/blobs/:id 200 0ms');
  });
});

describe('CORS', () => {
  it('answers preflights for the app origin only', async () => {
    const t = setup();
    const ok = await t.request('/v1/blobs/x', {
      method: 'OPTIONS',
      headers: { origin: ORIGIN, 'access-control-request-method': 'PUT' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(ok.headers.get('access-control-allow-headers')).toContain('If-Match');
    const evil = await t.request('/v1/blobs/x', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses requests from other origins outright', async () => {
    const t = setup();
    const s = await t.signIn();
    const res = await t.request('/v1/account', {
      headers: { ...s.headers, origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
    const fromApp = await t.request('/v1/account', { headers: { ...s.headers, origin: ORIGIN } });
    expect(fromApp.status).toBe(200);
    expect(fromApp.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(fromApp.headers.get('cache-control')).toBe('no-store');
  });
});
