import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createApp,
  makeConfig,
  memoryBlobStore,
  memoryMailer,
  openDatabase,
} from '@opentiles/sync-api';
import { SyncController, syncDb } from '../src/sync/local';
import { db } from '../src/storage/db';
import type { LibraryItem } from '../src/storage/db';

const KDF = { algorithm: 'argon2id', memoryKiB: 256, iterations: 1, parallelism: 1 } as const;
const PASS = 'four random words here';

function server() {
  const config = makeConfig({ appOrigins: ['https://app.opentiles.test'] });
  const mailer = memoryMailer();
  const sync = createApp({
    config,
    db: openDatabase(':memory:'),
    blobs: memoryBlobStore(),
    mailer,
    log: () => undefined,
  });
  const bodies: Uint8Array[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    bodies.push(new Uint8Array(await req.clone().arrayBuffer()));
    return sync.app.fetch(req);
  };
  const controller = () =>
    new SyncController({
      baseUrl: 'https://sync.opentiles.test',
      fetch: fetchImpl as typeof fetch,
      kdf: { ...KDF },
      unsafeAllowWeakKdf: true,
    });
  const lastToken = () => /#token=([\w-]+)/.exec(mailer.sent.at(-1)?.text ?? '')?.[1] ?? '';
  return { controller, bodies, lastToken };
}

function item(title: string): LibraryItem {
  return {
    title,
    fileName: 'my-own-piece.mid',
    format: 'midi',
    bytes: new Uint8Array([77, 84, 104, 100]),
    song: {
      title,
      format: 'midi',
      notes: [],
      measures: [],
      tempos: [{ beat: 0, bpm: 90 }],
      timeSignatures: [],
      keySignatures: [],
      parts: [{ name: 'Piano' }],
      lengthBeats: 0,
      warnings: [],
    },
    settings: { transpose: 0, swapHands: false },
    tags: [],
    addedAt: 42,
  };
}

async function wipeDevice() {
  await Promise.all([
    db.library.clear(),
    db.progress.clear(),
    db.days.clear(),
    db.settings.clear(),
    syncDb.records.clear(),
    syncDb.links.clear(),
    syncDb.meta.clear(),
  ]);
}

function contains(haystack: Uint8Array, text: string): boolean {
  return new TextDecoder('latin1').decode(haystack).includes(text);
}

beforeEach(wipeDevice);

describe('encrypted sync from the web app', () => {
  it('moves the library to a second device without plaintext leaving the first', async () => {
    const s = server();
    const a = s.controller();
    await a.init();
    expect(a.state.phase).toBe('signed-out');
    await a.startEmailSignIn('pianist@example.org');
    await a.finishEmailSignIn({ token: s.lastToken() });
    expect(a.state).toMatchObject({ phase: 'needs-vault', accountHasVault: false });
    const code = await a.createLibraryKey(PASS);
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){8}$/);
    expect(a.state.phase).toBe('ready');

    const id = await db.library.add(item('A Secret Study'));
    await db.progress.put({
      key: `library:${id}`,
      bestAccuracy: 0.8,
      runs: 1,
      lastPlayedAt: 1,
      secondsPractised: 10,
    });
    await db.progress.put({
      key: 'catalogue:ode-to-joy',
      bestAccuracy: 0.6,
      runs: 2,
      lastPlayedAt: 2,
      secondsPractised: 20,
    });
    await db.days.put({ day: '2026-10-05', seconds: 30 });
    await db.settings.put({ key: 'app', value: { largePrint: true } });
    const result = await a.syncNow();
    expect(result.pushed).toBeGreaterThanOrEqual(5);
    for (const body of s.bodies) {
      expect(contains(body, 'A Secret Study')).toBe(false);
      expect(contains(body, 'my-own-piece')).toBe(false);
      expect(contains(body, 'ode-to-joy')).toBe(false);
      expect(contains(body, PASS)).toBe(false);
    }
    // A second sync with nothing new uploads nothing.
    expect((await a.syncNow()).pushed).toBe(0);

    // Device B: empty, with one item of its own, so local ids differ.
    await wipeDevice();
    const own = await db.library.add(item('Device B piece'));
    const b = s.controller();
    await b.init();
    await b.startEmailSignIn('pianist@example.org');
    await b.finishEmailSignIn({ token: s.lastToken() });
    expect(b.state.accountHasVault).toBe(true);
    await expect(b.unlock({ passphrase: 'wrong passphrase!' })).rejects.toThrow();
    expect(await b.unlock({ passphrase: PASS })).toBe(true);
    await b.syncNow();

    const titles = (await db.library.toArray()).map((i) => i.title).sort();
    expect(titles).toEqual(['A Secret Study', 'Device B piece']);
    const study = (await db.library.toArray()).find((i) => i.title === 'A Secret Study');
    expect(study?.id).not.toBe(own);
    expect(await db.progress.get(`library:${study?.id}`)).toMatchObject({ bestAccuracy: 0.8 });
    expect(await db.progress.get('catalogue:ode-to-joy')).toMatchObject({ runs: 2 });
    expect(await db.days.get('2026-10-05')).toMatchObject({ seconds: 30 });
    expect((await db.settings.get('app'))?.value).toMatchObject({ largePrint: true });

    // A deletion on B reaches the server and a recovery-code unlock still works.
    await db.library.delete(study?.id ?? -1);
    await b.syncNow();
    await b.signOut();
    expect(b.state.phase).toBe('signed-out');
    expect(await syncDb.records.count()).toBe(0);

    await wipeDevice();
    const c = s.controller();
    await c.init();
    await c.startEmailSignIn('pianist@example.org');
    await c.finishEmailSignIn({ token: s.lastToken() });
    expect(await c.unlock({ recoveryCode: code ?? '' })).toBe(true);
    await c.syncNow();
    expect((await db.library.toArray()).map((i) => i.title)).toEqual(['Device B piece']);

    await c.deleteAccount();
    expect(c.state.phase).toBe('signed-out');
  });
});
