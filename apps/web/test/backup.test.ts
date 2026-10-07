import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { isVaultError, readBackupManifest } from '@opentiles/vault';
import {
  collectBackupData,
  createBackupFile,
  isDeviceSetting,
  restoreBackupFile,
} from '../src/backup/backup';
import { db } from '../src/storage/db';
import type { LibraryItem } from '../src/storage/db';
import type { Song } from '@opentiles/song-model';

const KDF = { algorithm: 'argon2id', memoryKiB: 256, iterations: 1, parallelism: 1 } as const;
const weak = { kdf: { ...KDF }, unsafeAllowWeakKdf: true };
const PASS = 'correct horse battery staple';

function song(title: string): Song {
  return {
    title,
    format: 'midi',
    notes: [],
    measures: [],
    tempos: [{ beat: 0, bpm: 100 }],
    timeSignatures: [],
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: 0,
    warnings: [],
  };
}

function item(title: string, bytes: number[], addedAt: number): LibraryItem {
  return {
    title,
    fileName: `${title.toLowerCase().replace(/\s+/g, '-')}.mid`,
    format: 'midi',
    bytes: new Uint8Array(bytes),
    song: song(title),
    settings: { transpose: 0, swapHands: false },
    tags: ['mine'],
    addedAt,
  };
}

async function clearAll() {
  await Promise.all([
    db.library.clear(),
    db.progress.clear(),
    db.days.clear(),
    db.settings.clear(),
  ]);
}

beforeEach(clearAll);

describe('encrypted backup', () => {
  it('round-trips library, progress, days and settings without duplicates', async () => {
    const a = await db.library.add(item('Little Scale', [1, 2, 3], 1000));
    const b = await db.library.add(item('Second Study', [4, 5, 6, 7], 2000));
    await db.progress.bulkPut([
      { key: `library:${a}`, bestAccuracy: 0.7, runs: 2, lastPlayedAt: 10, secondsPractised: 60 },
      { key: `library:${b}`, bestAccuracy: 0.9, runs: 1, lastPlayedAt: 20, secondsPractised: 30 },
      {
        key: 'catalogue:ode-to-joy',
        bestAccuracy: 0.5,
        runs: 3,
        lastPlayedAt: 5,
        secondsPractised: 90,
      },
    ]);
    await db.days.put({ day: '2026-10-01', seconds: 120 });
    await db.settings.bulkPut([
      { key: 'app', value: { largePrint: true } },
      { key: 'rightsConfirmed', value: true },
      { key: 'sync.token', value: 'never in a backup' },
    ]);

    const stages: string[] = [];
    const file = await createBackupFile(PASS, { ...weak, onProgress: (s) => stages.push(s) });
    expect(stages).toEqual(['collecting', 'deriving-key', 'encrypting']);

    // Nothing in the clear names a piece.
    const text = new TextDecoder('latin1').decode(file);
    expect(text).not.toContain('Little Scale');
    expect(text).not.toContain('little-scale.mid');
    expect(text).not.toContain('never in a backup');
    expect(readBackupManifest(file).format).toBe('opentiles-backup');
    for (const entry of ['index.otr', 'progress.otr', 'settings.otr', 'library/000002.otr']) {
      expect(text).toContain(entry);
    }
    expect(text).not.toContain('library/000003.otr');

    // A fresh device, where ids start elsewhere: one unrelated item first.
    await clearAll();
    const other = await db.library.add(item('Unrelated', [9], 3000));
    const summary = await restoreBackupFile(file, { passphrase: PASS });
    expect(summary).toMatchObject({ added: 2, skipped: 0, days: 1, settings: 2 });

    const restored = await db.library.toArray();
    expect(restored.map((i) => i.title).sort()).toEqual([
      'Little Scale',
      'Second Study',
      'Unrelated',
    ]);
    const scale = restored.find((i) => i.title === 'Little Scale');
    expect(scale?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(scale?.tags).toEqual(['mine']);
    expect(scale?.id).not.toBe(other);
    // Progress follows the item to its new id.
    expect(await db.progress.get(`library:${scale?.id}`)).toMatchObject({ bestAccuracy: 0.7 });
    expect(await db.progress.get('catalogue:ode-to-joy')).toMatchObject({ runs: 3 });
    expect(await db.days.get('2026-10-01')).toEqual({ day: '2026-10-01', seconds: 120 });
    expect(await db.settings.get('app')).toEqual({ key: 'app', value: { largePrint: true } });
    expect(await db.settings.get('sync.token')).toBeUndefined();

    // Restoring the same file again adds nothing and keeps the better progress.
    await db.progress.update('catalogue:ode-to-joy', { bestAccuracy: 0.95 });
    const again = await restoreBackupFile(file, { passphrase: PASS });
    expect(again).toMatchObject({ added: 0, skipped: 2 });
    expect(await db.library.count()).toBe(3);
    expect((await db.progress.get('catalogue:ode-to-joy'))?.bestAccuracy).toBe(0.95);
  });

  it('refuses the wrong passphrase and leaves the device unchanged', async () => {
    await db.library.add(item('Only One', [1], 1));
    const file = await createBackupFile(PASS, weak);
    await clearAll();
    await expect(restoreBackupFile(file, { passphrase: 'not the right one' })).rejects.toSatisfy(
      (e: unknown) => isVaultError(e, 'wrong-secret'),
    );
    expect(await db.library.count()).toBe(0);
  });

  it('refuses a passphrase shorter than eight characters', async () => {
    await expect(createBackupFile('short', weak)).rejects.toSatisfy((e: unknown) =>
      isVaultError(e, 'weak-passphrase'),
    );
  });

  it('keeps device-only settings out of the backup', async () => {
    await db.settings.bulkPut([
      { key: 'device.id', value: 'x' },
      { key: 'app', value: {} },
    ]);
    const data = await collectBackupData();
    expect((data.settings as { key: string }[]).map((s) => s.key)).toEqual(['app']);
    expect(isDeviceSetting('sync.session')).toBe(true);
    expect(isDeviceSetting('rightsConfirmed')).toBe(false);
  });
});
