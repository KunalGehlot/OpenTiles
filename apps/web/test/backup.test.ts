import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { isVaultError, readBackupManifest } from '@opentiles/vault';
import {
  collectBackupData,
  createBackupFile,
  isDeviceSetting,
  mergeBackupData,
  restoreBackupFile,
} from '../src/backup/backup';
import { db } from '../src/storage/db';
import { addLibraryItem, allLibraryItems, getLibraryItem } from '../src/storage/library';
import type { LibraryItem } from '../src/storage/db';
import type { Song } from '@opentiles/song-model';
import type { SheetMap } from '@opentiles/sheet';

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
    db.files.clear(),
    db.progress.clear(),
    db.days.clear(),
    db.settings.clear(),
  ]);
}

beforeEach(clearAll);

describe('encrypted backup', () => {
  it('round-trips library, progress, days and settings without duplicates', async () => {
    const a = await addLibraryItem(item('Little Scale', [1, 2, 3], 1000));
    const b = await addLibraryItem(item('Second Study', [4, 5, 6, 7], 2000));
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
    const other = await addLibraryItem(item('Unrelated', [9], 3000));
    const summary = await restoreBackupFile(file, { passphrase: PASS });
    expect(summary).toMatchObject({ added: 2, skipped: 0, days: 1, settings: 2 });

    const restored = await allLibraryItems();
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
    await addLibraryItem(item('Only One', [1], 1));
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

// Sheet-music PDFs kept with a piece (P5-15, ADR 0018).
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');

function sheetMap(): SheetMap {
  return {
    layout: {
      pages: [{ width: 595, height: 842 }],
      bars: [
        {
          page: 0,
          system: 0,
          box: { x: 40, y: 90, width: 130, height: 70 },
          start: 'none',
          end: 'repeat-end',
          ending: 1,
        },
        {
          page: 0,
          system: 0,
          box: { x: 170, y: 90, width: 130, height: 70 },
          start: 'single',
          end: 'final',
        },
      ],
      source: 'vector',
    },
    barOfMeasure: [0, null, 1],
    edited: true,
    analyser: 2,
  };
}

function withSheet(title: string, addedAt: number): LibraryItem {
  return {
    ...item(title, [7, 7, 7], addedAt),
    sheet: {
      fileName: 'Private Sheet Name.pdf',
      bytes: PDF,
      addedAt: addedAt + 1,
      map: sheetMap(),
    },
  };
}

describe('backup with sheet music', () => {
  it('keeps the PDF and its map, encrypted, and brings them back', async () => {
    await addLibraryItem(withSheet('Sheet Study', 5000));
    const sheetOnly: LibraryItem = {
      ...item('Only The Sheet', [], 6000),
      fileName: 'Only The Sheet.pdf',
      format: 'pdf',
      sheet: { fileName: 'Only The Sheet.pdf', bytes: PDF, addedAt: 6000 },
    };
    await addLibraryItem(sheetOnly);
    const file = await createBackupFile(PASS, weak);
    const text = new TextDecoder('latin1').decode(file);
    expect(text).not.toContain('Private Sheet Name');
    expect(text).not.toContain('Only The Sheet');
    expect(text).not.toContain('%PDF-');

    await clearAll();
    expect(await restoreBackupFile(file, { passphrase: PASS })).toMatchObject({
      added: 2,
      sheets: 0,
    });
    const restored = await allLibraryItems();
    const study = restored.find((i) => i.title === 'Sheet Study');
    expect(study?.sheet).toEqual({
      fileName: 'Private Sheet Name.pdf',
      bytes: PDF,
      addedAt: 5001,
      map: sheetMap(),
    });
    const only = restored.find((i) => i.title === 'Only The Sheet');
    expect(only).toMatchObject({ format: 'pdf', bytes: new Uint8Array(0) });
    expect(only?.sheet?.bytes).toEqual(PDF);
    expect(only?.sheet && 'map' in only.sheet).toBe(false);

    // Restoring again adds nothing twice.
    expect(await restoreBackupFile(file, { passphrase: PASS })).toMatchObject({
      added: 0,
      skipped: 2,
    });
  });

  it('restores a backup made before pieces had sheet music', async () => {
    // What older versions wrote: library items with no `sheet` key at all.
    const summary = await mergeBackupData({
      library: [{ ...item('Old Piece', [1, 2], 10), originalId: 1 }],
      progress: { progress: [], days: [] },
      settings: [],
    });
    expect(summary).toMatchObject({ added: 1, sheets: 0 });
    const [restored] = await allLibraryItems();
    expect(restored?.title).toBe('Old Piece');
    expect(restored && 'sheet' in restored).toBe(false);
  });

  it('keeps the piece when its sheet is damaged, and the PDF when only its map is', async () => {
    const good = withSheet('Damaged Map', 20);
    const summary = await mergeBackupData({
      library: [
        { ...item('Damaged Sheet', [1], 10), sheet: { fileName: 'x.pdf', bytes: 'not bytes' } },
        {
          ...good,
          sheet: { ...good.sheet, map: { ...sheetMap(), barOfMeasure: [0, 5] } },
        },
        {
          ...withSheet('Odd Bar', 30),
          sheet: {
            ...good.sheet,
            map: {
              ...sheetMap(),
              layout: { ...sheetMap().layout, bars: [{ page: 0, box: null }] },
              barOfMeasure: [],
            },
          },
        },
      ],
      progress: null,
      settings: null,
    });
    expect(summary.added).toBe(3);
    const all = await allLibraryItems();
    const byTitle = (title: string) => all.find((i) => i.title === title);
    expect(byTitle('Damaged Sheet')).toBeDefined();
    expect(byTitle('Damaged Sheet')?.sheet).toBeUndefined();
    expect(byTitle('Damaged Map')?.sheet?.bytes).toEqual(PDF);
    expect(byTitle('Damaged Map')?.sheet?.map).toBeUndefined();
    expect(byTitle('Odd Bar')?.sheet?.map).toBeUndefined();
  });

  it('gives a piece already here the backup’s sheet music only if it has none', async () => {
    // Device B restored the pieces before they had sheets; device A then added them.
    const plain = item('Shared Piece', [3, 1, 4], 100);
    const other = item('Other Piece', [2, 7], 200);
    const here = await addLibraryItem(plain);
    await addLibraryItem({
      ...other,
      sheet: { fileName: 'Kept Here.pdf', bytes: PDF, addedAt: 1 },
    });
    const summary = await mergeBackupData({
      library: [
        { ...withSheet('Shared Piece', 100), bytes: plain.bytes, originalId: 1 },
        { ...withSheet('Other Piece', 200), bytes: other.bytes, originalId: 2 },
      ],
      progress: null,
      settings: null,
    });
    expect(summary).toMatchObject({ added: 0, skipped: 2, sheets: 1 });
    expect((await getLibraryItem(here))?.sheet?.fileName).toBe('Private Sheet Name.pdf');
    const kept = (await allLibraryItems()).find((i) => i.title === 'Other Piece');
    expect(kept?.sheet?.fileName).toBe('Kept Here.pdf');
  });
});
