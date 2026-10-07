import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { memoryBlobStore } from '../src/blob-store.js';
import { setup } from './helpers.js';

const ID = 'rec_0123456789abcdef';
const ID2 = 'rec_fedcba9876543210';

type Setup = ReturnType<typeof setup>;

function put(
  t: Setup,
  headers: Record<string, string>,
  id: string,
  body: Uint8Array,
  base: number,
) {
  return t.request(`/v1/blobs/${id}`, {
    method: 'PUT',
    headers: {
      ...headers,
      'content-type': 'application/octet-stream',
      ...(base === 0 ? { 'if-none-match': '*' } : { 'if-match': `"${base}"` }),
    },
    body,
  });
}

async function changes(t: Setup, headers: Record<string, string>, since = 0, limit?: number) {
  const q = limit === undefined ? `since=${since}` : `since=${since}&limit=${limit}`;
  const res = await t.request(`/v1/changes?${q}`, { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    changes: { id: string; version: number; seq: number; size: number; deleted: boolean }[];
    cursor: number;
    more: boolean;
  };
}

describe('blob versions', () => {
  it('creates, reads and updates with optimistic concurrency', async () => {
    const t = setup();
    const { headers } = await t.signIn();
    const v1 = randomBytes(100);
    const created = await put(t, headers, ID, v1, 0);
    expect(created.status).toBe(200);
    expect(created.headers.get('etag')).toBe('"1"');
    expect(await created.json()).toEqual({ version: 1, seq: 1 });

    const read = await t.request(`/v1/blobs/${ID}`, { headers });
    expect(read.status).toBe(200);
    expect(read.headers.get('x-blob-version')).toBe('1');
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(new Uint8Array(v1));

    const v2 = randomBytes(50);
    const updated = await put(t, headers, ID, v2, 1);
    expect(await updated.json()).toEqual({ version: 2, seq: 2 });

    // A device still on version 1 is told about version 2 instead of overwriting it.
    const stale = await put(t, headers, ID, randomBytes(10), 1);
    expect(stale.status).toBe(412);
    expect(await stale.json()).toMatchObject({
      error: 'version-conflict',
      current: { version: 2, deleted: false },
    });
    const dup = await put(t, headers, ID, randomBytes(10), 0);
    expect(dup.status).toBe(412);
  });

  it('keeps exactly one stored object per live record', async () => {
    const blobs = memoryBlobStore();
    const t = setup({}, blobs);
    const { headers } = await t.signIn();
    await put(t, headers, ID, randomBytes(10), 0);
    await put(t, headers, ID, randomBytes(10), 1);
    await put(t, headers, ID, randomBytes(10), 2);
    expect(blobs.keys()).toHaveLength(1);
    expect(blobs.keys()[0]).toMatch(new RegExp(`^u/[\\w-]+/${ID}/3-`));
  });

  it('requires a precondition and a sane id', async () => {
    const t = setup();
    const { headers } = await t.signIn();
    const none = await t.request(`/v1/blobs/${ID}`, { method: 'PUT', headers, body: 'x' });
    expect(none.status).toBe(428);
    const bad = await t.request(`/v1/blobs/${ID}`, {
      method: 'PUT',
      headers: { ...headers, 'if-match': 'W/"1"' },
      body: 'x',
    });
    expect(bad.status).toBe(400);
    for (const id of ['short', 'has.dots.in.it.123456', `${'x'.repeat(65)}`]) {
      expect((await put(t, headers, id, randomBytes(4), 0)).status).toBe(400);
    }
    expect((await put(t, headers, ID, new Uint8Array(0), 0)).status).toBe(400);
  });

  it('turns deletes into tombstones that sync to other devices', async () => {
    const t = setup();
    const { headers } = await t.signIn();
    await put(t, headers, ID, randomBytes(10), 0);
    const stale = await t.request(`/v1/blobs/${ID}`, {
      method: 'DELETE',
      headers: { ...headers, 'if-match': '"7"' },
    });
    expect(stale.status).toBe(412);
    const del = await t.request(`/v1/blobs/${ID}`, {
      method: 'DELETE',
      headers: { ...headers, 'if-match': '"1"' },
    });
    expect(await del.json()).toEqual({ version: 2, seq: 2 });
    const gone = await t.request(`/v1/blobs/${ID}`, { headers });
    expect(gone.status).toBe(410);
    expect(await gone.json()).toMatchObject({ version: 2 });
    expect((await changes(t, headers)).changes).toEqual([
      { id: ID, version: 2, seq: 2, size: 0, deleted: true },
    ]);
    // Re-creating builds on the tombstone's version.
    expect((await put(t, headers, ID, randomBytes(5), 0)).status).toBe(412);
    expect((await put(t, headers, ID, randomBytes(5), 2)).status).toBe(200);
  });

  it('lists changes in order with a cursor and pages', async () => {
    const t = setup();
    const { headers } = await t.signIn();
    const ids = Array.from({ length: 5 }, (_, i) => `record-${String(i).padStart(12, '0')}`);
    for (const id of ids) await put(t, headers, id, randomBytes(8), 0);
    await put(t, headers, ids[0]!, randomBytes(8), 1);

    const all = await changes(t, headers);
    expect(all.changes.map((c) => c.id)).toEqual([...ids.slice(1), ids[0]]);
    expect(all.cursor).toBe(6);
    expect(all.more).toBe(false);

    // Each record appears once, at its latest sequence number (record 0 moved from 1 to 6).
    const page1 = await changes(t, headers, 0, 2);
    expect(page1.changes.map((c) => c.seq)).toEqual([2, 3]);
    expect(page1.more).toBe(true);
    const page2 = await changes(t, headers, page1.cursor, 10);
    expect(page2.changes.map((c) => c.seq)).toEqual([4, 5, 6]);
    const empty = await changes(t, headers, 6);
    expect(empty).toEqual({ changes: [], cursor: 6, more: false });
    expect((await t.request('/v1/changes?since=-1', { headers })).status).toBe(400);
  });

  it('keeps users apart', async () => {
    const t = setup();
    const a = await t.signIn('a@example.org');
    const b = await t.signIn('b@example.org');
    await put(t, a.headers, ID, randomBytes(10), 0);
    expect((await t.request(`/v1/blobs/${ID}`, { headers: b.headers })).status).toBe(404);
    expect((await changes(t, b.headers)).changes).toEqual([]);
    // b's own record with the same id is independent.
    expect((await put(t, b.headers, ID, randomBytes(10), 0)).status).toBe(200);
  });
});

describe('quota', () => {
  it('enforces the per-user byte quota, counting replacements and deletions', async () => {
    const t = setup({ quotaBytes: 1000 });
    const { headers } = await t.signIn();
    expect((await put(t, headers, ID, randomBytes(600), 0)).status).toBe(200);
    const over = await put(t, headers, ID2, randomBytes(401), 0);
    expect(over.status).toBe(507);
    expect(await over.json()).toMatchObject({ error: 'quota-exceeded', quota: { bytes: 1000 } });
    expect((await put(t, headers, ID2, randomBytes(400), 0)).status).toBe(200);
    // Replacing a record only counts the difference.
    expect((await put(t, headers, ID, randomBytes(600), 1)).status).toBe(200);
    expect((await put(t, headers, ID, randomBytes(601), 2)).status).toBe(507);
    // Deleting frees space.
    await t.request(`/v1/blobs/${ID2}`, {
      method: 'DELETE',
      headers: { ...headers, 'if-match': '"1"' },
    });
    const account = (await (await t.request('/v1/account', { headers })).json()) as {
      usage: { bytes: number; records: number };
      quota: { bytes: number };
    };
    expect(account.usage).toEqual({ bytes: 600, records: 1 });
    expect(account.quota.bytes).toBe(1000);
    expect((await put(t, headers, ID, randomBytes(1000), 2)).status).toBe(200);
  });

  it('defaults to 250 MB', () => {
    expect(setup().config.quotaBytes).toBe(250_000_000);
  });

  it('rejects single blobs over the size limit and too many records', async () => {
    const t = setup({ maxBlobBytes: 1024, maxBlobs: 2 });
    const { headers } = await t.signIn();
    expect((await put(t, headers, ID, randomBytes(1025), 0)).status).toBe(413);
    expect((await put(t, headers, ID, randomBytes(10), 0)).status).toBe(200);
    expect((await put(t, headers, ID2, randomBytes(10), 0)).status).toBe(200);
    const third = await put(t, headers, 'rec_third_record_00', randomBytes(10), 0);
    expect(third.status).toBe(507);
    expect(await third.json()).toMatchObject({ error: 'too-many-records' });
  });
});

describe('wrapped key storage', () => {
  const bundle = { format: 'opentiles-keys', version: 1, keyId: 'abc', opaque: true };

  it('stores the bundle opaquely with compare-and-set', async () => {
    const t = setup();
    const { headers } = await t.signIn();
    expect((await t.request('/v1/keys', { headers })).status).toBe(404);
    const noPrecondition = await t.json('PUT', '/v1/keys', { bundle }, headers);
    expect(noPrecondition.status).toBe(428);
    const created = await t.json(
      'PUT',
      '/v1/keys',
      { bundle },
      { ...headers, 'if-none-match': '*' },
    );
    expect(await created.json()).toEqual({ version: 1 });
    const race = await t.json('PUT', '/v1/keys', { bundle }, { ...headers, 'if-none-match': '*' });
    expect(race.status).toBe(412);
    expect(await race.json()).toMatchObject({ current: { version: 1 } });
    const got = await t.request('/v1/keys', { headers });
    expect(await got.json()).toEqual({ version: 1, bundle });
    const updated = await t.json(
      'PUT',
      '/v1/keys',
      { bundle: { ...bundle, keyId: 'def' } },
      { ...headers, 'if-match': '"1"' },
    );
    expect(await updated.json()).toEqual({ version: 2 });
  });

  it('rejects oversized or malformed bundles', async () => {
    const t = setup();
    const { headers } = await t.signIn();
    const big = await t.json(
      'PUT',
      '/v1/keys',
      { bundle: { x: 'y'.repeat(20_000) } },
      { ...headers, 'if-none-match': '*' },
    );
    expect(big.status).toBe(413);
    const notObject = await t.json(
      'PUT',
      '/v1/keys',
      { bundle: [1] },
      { ...headers, 'if-none-match': '*' },
    );
    expect(notObject.status).toBe(400);
  });
});
