// Library files in their own table (P6-04): the upgrade from a version 1 database, which kept every
// file in its row, and how fast the library lists with many large PDFs. Songs and "PDFs" here are
// generated (CC0); the bytes only have to be big.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import type { Song } from '@opentiles/song-model';
import { buildCollection } from '../src/player/collection';
import { db } from '../src/storage/db';
import {
  addLibraryItem,
  allLibraryItems,
  deleteLibraryItem,
  getLibraryItem,
  libraryRows,
  setLibrarySheet,
} from '../src/storage/library';

function song(title: string, notes = 8): Song {
  return {
    title,
    format: 'midi',
    notes: Array.from({ length: notes }, (_, i) => ({
      id: `n${i}`,
      pitch: 60 + (i % 12),
      startBeat: i,
      durationBeats: 1,
      hand: 'right' as const,
      staff: 1,
      voice: 1,
      part: 0,
      measureIndex: Math.floor(i / 4),
      sourceRefs: [],
    })),
    measures: [],
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: notes,
    warnings: [],
  };
}

const bytes = (n: number, fill: number) => new Uint8Array(n).fill(fill);
const MAP = {
  layout: { pages: [{ width: 595, height: 842 }], bars: [], source: 'vector' },
  barOfMeasure: [],
  edited: true,
  analyser: 1,
};

describe('the upgrade from version 1', () => {
  it('moves every file and PDF out of the rows, and loses none', async () => {
    await db.close();
    await Dexie.delete('opentiles');
    const v1 = new Dexie('opentiles');
    v1.version(1).stores({
      library: '++id, title, addedAt',
      progress: 'key',
      days: 'day',
      settings: 'key',
    });
    const base = {
      format: 'midi',
      settings: { transpose: 0, swapHands: false },
      tags: ['mine'],
    };
    await v1.table('library').bulkAdd([
      {
        ...base,
        title: 'Plain',
        fileName: 'plain.mid',
        bytes: bytes(10, 1),
        song: song('Plain'),
        addedAt: 1,
      },
      {
        ...base,
        title: 'With Sheet',
        fileName: 'sheet.mid',
        bytes: bytes(20, 2),
        song: song('With Sheet'),
        addedAt: 2,
        sheet: { fileName: 'sheet.pdf', bytes: bytes(300, 3), addedAt: 5, map: MAP },
      },
      {
        ...base,
        title: 'Damaged Sheet',
        fileName: 'damaged.mid',
        bytes: bytes(30, 4),
        song: song('Damaged Sheet'),
        addedAt: 3,
        sheet: { fileName: 'gone.pdf', addedAt: 6 },
      },
    ]);
    await v1.table('progress').put({
      key: 'library:2',
      bestAccuracy: 0.8,
      runs: 1,
      lastPlayedAt: 9,
      secondsPractised: 30,
    });
    v1.close();

    await db.open();
    expect(db.verno).toBe(2);
    const rows = await db.library.orderBy('addedAt').toArray();
    expect(rows.map((r) => [r.id, r.title, r.size, 'bytes' in r])).toEqual([
      [1, 'Plain', 10, false],
      [2, 'With Sheet', 20, false],
      [3, 'Damaged Sheet', 30, false],
    ]);
    expect(rows[1]?.sheet).toEqual({ fileName: 'sheet.pdf', addedAt: 5, size: 300, map: MAP });
    expect(rows[2]?.sheet).toBeUndefined();
    const sheet = await getLibraryItem(2);
    expect(sheet?.bytes).toEqual(bytes(20, 2));
    expect(sheet?.sheet).toEqual({
      fileName: 'sheet.pdf',
      addedAt: 5,
      bytes: bytes(300, 3),
      map: MAP,
    });
    expect((await getLibraryItem(1))?.bytes).toEqual(bytes(10, 1));
    expect((await getLibraryItem(3))?.bytes).toEqual(bytes(30, 4));
    // Progress and everything else stay as they were.
    expect((await db.progress.get('library:2'))?.bestAccuracy).toBe(0.8);
  });
});

describe('library pieces across rows and files', () => {
  it('adds, reads, changes the sheet of and deletes a whole piece', async () => {
    await Promise.all([db.library.clear(), db.files.clear()]);
    const id = await addLibraryItem({
      title: 'Study',
      fileName: 'study.mid',
      format: 'midi',
      bytes: bytes(8, 7),
      song: song('Study'),
      settings: { transpose: 0, swapHands: false },
      tags: [],
      addedAt: 10,
    });
    expect(await db.files.get(id)).toEqual({ id, bytes: bytes(8, 7) });
    await setLibrarySheet(id, { fileName: 'study.pdf', bytes: bytes(50, 8), addedAt: 11 });
    expect((await db.library.get(id))?.sheet).toEqual({
      fileName: 'study.pdf',
      addedAt: 11,
      size: 50,
    });
    expect((await getLibraryItem(id))?.sheet?.bytes).toEqual(bytes(50, 8));
    await setLibrarySheet(id, undefined);
    expect((await db.library.get(id))?.sheet).toBeUndefined();
    expect(await db.files.get(id)).toEqual({ id, bytes: bytes(8, 7) });
    expect(await setLibrarySheet(id + 100, undefined)).toBe(false);
    await deleteLibraryItem(id);
    expect(await db.library.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
  });

  it('lists 200 pieces with large PDFs without reading a byte of them', async () => {
    await Promise.all([db.library.clear(), db.files.clear()]);
    const pdf = bytes(512 * 1024, 9);
    await db.transaction('rw', db.library, db.files, async () => {
      for (let i = 0; i < 200; i++) {
        await addLibraryItem({
          title: `Piece ${i}`,
          fileName: `piece-${i}.mid`,
          format: 'midi',
          bytes: bytes(2_000, 1),
          song: song(`Piece ${i}`, 200),
          settings: { transpose: 0, swapHands: false },
          tags: [],
          addedAt: i,
          sheet: { fileName: `piece-${i}.pdf`, bytes: pdf, addedAt: i },
        });
      }
    });
    const started = performance.now();
    const rows = await libraryRows();
    const entries = buildCollection({
      catalogue: [],
      library: rows,
      progress: [],
      catalogueSeconds: {},
      showUnverified: false,
    });
    const ms = performance.now() - started;
    expect(entries).toHaveLength(200);
    expect(entries[0]).toMatchObject({ title: 'Piece 199', hasSheet: true, seconds: 100 });
    expect(rows.some((r) => 'bytes' in r || (r.sheet && 'bytes' in r.sheet))).toBe(false);
    expect(ms).toBeLessThan(200);
    // The backup still gets every file.
    const whole = await allLibraryItems();
    expect(whole.every((i) => i.sheet?.bytes.length === pdf.length)).toBe(true);
  });
});
