import { encryptRecord, randomBytes, utf8Encode } from '@opentiles/vault';
import { describe, expect, it } from 'vitest';
import type { SyncApi } from '../src/api';
import { QuotaExceededError } from '../src/errors';
import { newRecordId } from '../src/engine';
import { createRemoteVault, unlockRemoteVault } from '../src/vault-setup';
import { contains, device, inProcessServer, weakKdf } from './helpers';

const PASS = 'our shared sync passphrase';

// Self-made test data only.
const libraryItem = {
  title: 'My Secret Practice Piece',
  fileName: 'secret-practice-piece.musicxml',
  format: 'musicxml',
  bytes: utf8Encode('<score-partwise><work><work-title>Secret Work Title</work-title></work>'),
  song: { title: 'My Secret Practice Piece', notes: [{ pitch: 64, startBeat: 0 }] },
  tags: ['private'],
};

/** Two signed-in devices on one account, sharing one library key. */
async function twoDevices(
  overrides: Parameters<typeof inProcessServer>[0] = {},
  options: { pageSize?: number } = {},
) {
  const server = inProcessServer(overrides);
  const apiA = await server.signedIn();
  const created = await createRemoteVault(apiA, PASS, weakKdf);
  const apiB = await server.signedIn();
  const unlocked = await unlockRemoteVault(apiB, { passphrase: PASS });
  const a = device(apiA, created.vault.key, 'device-a', options);
  const b = device(apiB, unlocked!.vault.key, 'device-b', options);
  return { server, a, b, recoveryCode: created.recoveryCode! };
}

describe('two devices', () => {
  it('sync a library item, progress and a setting', async () => {
    const { a, b } = await twoDevices();
    const itemId = newRecordId();
    await a.engine.change(itemId, 'library', libraryItem);
    await a.engine.change('progress-library-1', 'progress', { bestAccuracy: 0.9, runs: 3 });
    await a.engine.change('setting-theme-0001', 'setting', { value: 'dark' });
    expect(await a.engine.sync()).toEqual({ pulled: 0, pushed: 3, conflicts: 0, failed: [] });

    expect(await b.engine.sync()).toEqual({ pulled: 3, pushed: 0, conflicts: 0, failed: [] });
    const got = b.store.records().find((r) => r.id === itemId)!;
    expect(got.kind).toBe('library');
    expect(got.data).toEqual(libraryItem);
    expect((got.data as { bytes: unknown }).bytes).toBeInstanceOf(Uint8Array);
    expect(b.seen.map((r) => r.kind).sort()).toEqual(['library', 'progress', 'setting']);

    // Nothing new on either side now.
    expect(await a.engine.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0, failed: [] });
    expect(await b.engine.sync()).toEqual({ pulled: 0, pushed: 0, conflicts: 0, failed: [] });
  });

  it('never sends titles, file names, contents, the passphrase or the key in the clear', async () => {
    const { server, a, b, recoveryCode } = await twoDevices();
    await a.engine.change(newRecordId(), 'library', libraryItem);
    await a.engine.sync();
    await b.engine.sync();

    const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', a.engine['key']));
    const secrets = [
      utf8Encode(libraryItem.title),
      utf8Encode(libraryItem.fileName),
      utf8Encode('Secret Work Title'),
      utf8Encode(PASS),
      utf8Encode(recoveryCode),
      utf8Encode(recoveryCode.replaceAll('-', '')),
      rawKey,
    ];
    expect(server.requests.length).toBeGreaterThan(5);
    for (const req of server.requests) {
      for (const secret of secrets) {
        expect(contains(req.body, secret)).toBe(false);
        expect(contains(utf8Encode(req.url), secret)).toBe(false);
      }
    }
    // And the server's storage holds only sealed records.
    for (const key of server.blobs.keys()) {
      const object = (await server.blobs.get(key))!;
      expect([...object.subarray(0, 4)]).toEqual([0x4f, 0x54, 0x52, 0x01]);
      for (const secret of secrets) expect(contains(object, secret)).toBe(false);
    }
  });

  it('pulls in pages', async () => {
    const { a, b } = await twoDevices({}, { pageSize: 2 });
    for (let i = 0; i < 5; i++) await a.engine.change(newRecordId(), 'progress', { i });
    await a.engine.sync();
    expect((await b.engine.sync()).pulled).toBe(5);
    expect(await b.store.getCursor()).toBe(5);
  });

  it('syncs deletions as sealed tombstones', async () => {
    const { a, b } = await twoDevices();
    const id = newRecordId();
    await a.engine.change(id, 'library', libraryItem);
    await a.engine.sync();
    await b.engine.sync();
    a.setClock(5_000);
    await a.engine.remove(id);
    await a.engine.sync();
    await b.engine.sync();
    expect(b.store.records()).toEqual([]);
    expect(b.seen.at(-1)).toMatchObject({ id, deleted: true, data: null });
  });
});

describe('last writer wins', () => {
  it('keeps the later edit on both devices, whichever syncs first', async () => {
    const { a, b } = await twoDevices();
    const id = newRecordId();
    await a.engine.change(id, 'progress', { runs: 1 });
    await a.engine.sync();
    await b.engine.sync();

    // Both edit offline; B's edit is later.
    a.setClock(10_000);
    await a.engine.change(id, 'progress', { runs: 2, by: 'a' });
    b.setClock(20_000);
    await b.engine.change(id, 'progress', { runs: 2, by: 'b' });

    await a.engine.sync();
    const rb = await b.engine.sync();
    expect(rb.conflicts).toBe(1);
    await a.engine.sync();
    for (const d of [a, b]) {
      const entry = (await d.store.get(id))!;
      expect(entry.record.data).toEqual({ runs: 2, by: 'b' });
      expect(entry.pending).toBe(false);
    }
  });

  it('drops the local edit when the remote one is later', async () => {
    const { a, b } = await twoDevices();
    const id = newRecordId();
    a.setClock(30_000);
    await a.engine.change(id, 'setting', { value: 'a' });
    b.setClock(20_000);
    await b.engine.change(id, 'setting', { value: 'b' });
    await a.engine.sync();
    const rb = await b.engine.sync();
    expect(rb).toMatchObject({ conflicts: 1, pushed: 0 });
    expect((await b.store.get(id))!.record.data).toEqual({ value: 'a' });
    expect((await b.store.pending()).length).toBe(0);
  });

  it('resolves a write that loses the race on the server (412) the same way', async () => {
    const server = inProcessServer();
    const apiA = await server.signedIn();
    const { vault } = await createRemoteVault(apiA, PASS, weakKdf);
    const apiB = await server.signedIn();
    const a = device(apiA, vault.key, 'device-a');
    // B's pull sees an empty server, then A uploads, then B uploads on a stale base.
    const racingApi: SyncApi = {
      ...apiB,
      changes: async (since, limit) => {
        const page = await apiB.changes(since, limit);
        await a.engine.sync();
        return page;
      },
    };
    const b = device(racingApi, vault.key, 'device-b');
    const id = newRecordId();
    a.setClock(1_000);
    await a.engine.change(id, 'progress', { by: 'a' });
    b.setClock(2_000);
    await b.engine.change(id, 'progress', { by: 'b' });

    const rb = await b.engine.sync();
    expect(rb).toMatchObject({ conflicts: 1, pushed: 1 });
    expect((await b.store.get(id))!).toMatchObject({ version: 2, pending: false });

    const plainA = device(apiA, vault.key, 'device-a');
    await plainA.engine.sync();
    expect((await plainA.store.get(id))!.record.data).toEqual({ by: 'b' });
  });

  it('a later deletion beats an earlier edit, and a later edit beats an earlier deletion', async () => {
    const { a, b } = await twoDevices();
    const first = newRecordId();
    const second = newRecordId();
    await a.engine.change(first, 'library', { n: 1 });
    await a.engine.change(second, 'library', { n: 2 });
    await a.engine.sync();
    await b.engine.sync();

    a.setClock(50_000);
    await a.engine.remove(first);
    await a.engine.remove(second);
    b.setClock(40_000);
    await b.engine.change(first, 'library', { n: 1, edited: true });
    b.setClock(60_000);
    await b.engine.change(second, 'library', { n: 2, edited: true });

    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    for (const d of [a, b]) {
      expect(d.store.records().map((r) => r.data)).toEqual([{ n: 2, edited: true }]);
    }
  });

  it('recognises its own upload when the answer was lost', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    const { vault } = await createRemoteVault(api, PASS, weakKdf);
    let dropAnswer = true;
    const flakyApi: SyncApi = {
      ...api,
      putBlob: async (rid, sealed, base) => {
        const res = await api.putBlob(rid, sealed, base);
        if (dropAnswer) {
          dropAnswer = false;
          throw new TypeError('network connection lost');
        }
        return res;
      },
    };
    const d = device(flakyApi, vault.key, 'device-a');
    const id = newRecordId();
    await d.engine.change(id, 'progress', { runs: 1 });
    await expect(d.engine.sync()).rejects.toThrow('network connection lost');
    const second = await d.engine.sync();
    expect(second).toEqual({ pulled: 0, pushed: 0, conflicts: 0, failed: [] });
    expect(await d.store.get(id)).toMatchObject({ version: 1, pending: false });
  });

  it('keeps an edit made while its previous version was uploading', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    const { vault } = await createRemoteVault(api, PASS, weakKdf);
    const id = newRecordId();
    const holder: { d?: ReturnType<typeof device> } = {};
    const slowApi: SyncApi = {
      ...api,
      putBlob: async (rid, sealed, base) => {
        const res = await api.putBlob(rid, sealed, base);
        if (base === 0) {
          holder.d!.setClock(9_000);
          await holder.d!.engine.change(id, 'progress', { runs: 2 });
        }
        return res;
      },
    };
    const d = device(slowApi, vault.key, 'device-a');
    holder.d = d;
    await d.engine.change(id, 'progress', { runs: 1 });
    const result = await d.engine.sync();
    expect(result.pushed).toBe(2);
    const other = device(api, vault.key, 'device-b');
    await other.engine.sync();
    expect((await other.store.get(id))!.record.data).toEqual({ runs: 2 });
  });
});

describe('a hostile or broken server', () => {
  it('cannot swap one record’s blob for another’s', async () => {
    const { server, a, b } = await twoDevices();
    const x = 'record-x-0000000000';
    const y = 'record-y-0000000000';
    await a.engine.change(x, 'library', { title: 'x' });
    await a.engine.change(y, 'library', { title: 'y' });
    await a.engine.sync();
    const keys = server.blobs.keys();
    const kx = keys.find((k) => k.includes(`/${x}/`))!;
    const ky = keys.find((k) => k.includes(`/${y}/`))!;
    await server.blobs.put(ky, (await server.blobs.get(kx))!);
    // The swapped record is refused; the genuine one still syncs.
    const result = await b.engine.sync();
    expect(result.failed).toEqual([y]);
    expect(b.store.records().map((r) => r.id)).toEqual([x]);
    expect(b.store.records()[0]!.data).toEqual({ title: 'x' });
  });

  it('skips a record written by a newer app version and keeps syncing the rest', async () => {
    const { a, b } = await twoDevices();
    const id = 'record-from-future-01';
    const sealed = await encryptRecord(
      a.engine['key'],
      { v: 2, id, kind: 'library', deleted: false, modifiedAt: 1, deviceId: 'x', data: {} },
      `sync/${id}/1`,
    );
    await a.api.putBlob(id, sealed, 0);
    await a.engine.change(newRecordId(), 'progress', { ok: true });
    await a.engine.sync();
    const result = await b.engine.sync();
    expect(result.failed).toEqual([id]);
    expect(b.store.records().map((r) => r.data)).toEqual([{ ok: true }]);
  });

  it('cannot read anything with a different library key', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    const real = await createRemoteVault(api, PASS, weakKdf);
    const a = device(api, real.vault.key, 'device-a');
    await a.engine.change(newRecordId(), 'library', libraryItem);
    await a.engine.sync();
    const wrongKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const intruder = device(api, wrongKey, 'device-x');
    const result = await intruder.engine.sync();
    expect(result.failed).toHaveLength(1);
    expect(intruder.store.records()).toEqual([]);
  });
});

describe('limits', () => {
  it('reports a full quota', async () => {
    const { a } = await twoDevices({ quotaBytes: 4096 });
    await a.engine.change(newRecordId(), 'library', { bytes: randomBytes(10_000) });
    await expect(a.engine.sync()).rejects.toBeInstanceOf(QuotaExceededError);
    // The record stays pending for when space is freed.
    expect(await a.store.pending()).toHaveLength(1);
  });

  it('shares one run between overlapping sync calls', async () => {
    const { a } = await twoDevices();
    await a.engine.change(newRecordId(), 'progress', { x: 1 });
    const [r1, r2] = await Promise.all([a.engine.sync(), a.engine.sync()]);
    expect(r1).toBe(r2);
    expect(r1.pushed).toBe(1);
  });
});
