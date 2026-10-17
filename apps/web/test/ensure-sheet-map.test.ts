// A sheet's map found once for the practice screen (P5-18): the Sheet view and the Score tab ask
// at the same time and share one reading of the PDF, and the map is saved on the item. The
// analysis itself is stood in for here; its own tests are in packages/sheet. Songs are generated
// (CC0).
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { SheetMap } from '@opentiles/sheet';
import type { Song } from '@opentiles/song-model';
import { db } from '../src/storage/db';
import type { SheetAttachment } from '../src/storage/db';
import { addLibraryItem } from '../src/storage/library';

const found: SheetMap = {
  layout: { pages: [{ width: 595, height: 842 }], bars: [], source: 'vector' },
  barOfMeasure: [0],
  edited: false,
  analyser: 2,
  score: { notes: { n0: { staff: 2 } }, clefs: {} },
};

/** The stand-in analysis finishes when the test lets it (or after a moment, by default). */
let gate: Promise<void> | null = null;
const analyse = vi.fn(
  async (_pdfjs: unknown, _doc: unknown, _song: unknown, signal?: AbortSignal) => {
    await (gate ?? new Promise((r) => setTimeout(r, 20)));
    // As the real one does between pages.
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    return { map: found, timing: { pages: [5], total: 5 } };
  },
);
const hold = () => {
  let release = () => {};
  gate = new Promise<void>((r) => (release = r));
  return () => {
    gate = null;
    release();
  };
};
vi.mock('../src/views/sheet/analyse', () => ({ analyseSheet: analyse }));

const { ensureSheetMap } = await import('../src/views/sheet/ensure-map');

const song: Song = {
  title: 'Shared',
  format: 'midi',
  notes: [
    {
      id: 'n0',
      pitch: 60,
      startBeat: 0,
      durationBeats: 4,
      hand: 'right',
      staff: 1,
      voice: 1,
      part: 0,
      measureIndex: 0,
      sourceRefs: [],
    },
  ],
  measures: [{ index: 0, number: '1', sourceIndex: 0, startBeat: 0, lengthBeats: 4 }],
  tempos: [{ beat: 0, bpm: 100 }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  keySignatures: [{ beat: 0, fifths: 0 }],
  parts: [{ name: 'Piano' }],
  lengthBeats: 4,
  warnings: [],
};

describe('finding a sheet’s map for the practice screen (P5-18)', () => {
  it('reads the PDF once for two views asking together, saves the map and closes its copy', async () => {
    const sheet: SheetAttachment = {
      fileName: 'Shared.pdf',
      bytes: new Uint8Array([1]),
      addedAt: 1,
    };
    const id = await addLibraryItem({
      title: 'Shared',
      fileName: 'Shared.mid',
      format: 'midi',
      bytes: new Uint8Array([2]),
      song,
      settings: { transpose: 0, swapHands: false },
      tags: [],
      addedAt: 1,
      sheet,
    });
    const done = vi.fn();
    const open = vi.fn(async () => ({ pdfjs: {} as never, doc: {} as never, done }));
    const finding = vi.fn();
    const [a, b] = await Promise.all([
      ensureSheetMap(id, sheet, song, open, { onFinding: finding }),
      ensureSheetMap(id, sheet, song, open, { signal: new AbortController().signal }),
    ]);
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(finding).toHaveBeenCalledTimes(1);
    expect(a.map).toEqual(found);
    expect(b.map).toEqual(found);
    expect((await db.library.get(id))?.sheet?.map).toEqual(found);

    // Asked again, the stored map is current: nothing is read.
    const again = await ensureSheetMap(id, sheet, song, open);
    expect(again).toEqual({ map: found, timing: null });
    expect(analyse).toHaveBeenCalledTimes(1);
  });

  it('stops reading only when every view asking for it has gone', async () => {
    const add = async (name: string, addedAt: number) => {
      const sheet: SheetAttachment = {
        fileName: `${name}.pdf`,
        bytes: new Uint8Array([1]),
        addedAt,
      };
      const id = await addLibraryItem({
        title: name,
        fileName: `${name}.mid`,
        format: 'midi',
        bytes: new Uint8Array([2]),
        song,
        settings: { transpose: 0, swapHands: false },
        tags: [],
        addedAt,
        sheet,
      });
      return { id, sheet };
    };
    const open = async () => ({ pdfjs: {} as never, doc: {} as never, done: () => {} });
    const signalOf = (call: number) => analyse.mock.calls[call]?.[3];

    // One view leaves while the other waits: the reading goes on for the other.
    analyse.mockClear();
    let release = hold();
    const one = await add('Left', 2);
    const first = new AbortController();
    const leaving = ensureSheetMap(one.id, one.sheet, song, open, { signal: first.signal });
    const staying = ensureSheetMap(one.id, one.sheet, song, open, {
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(analyse).toHaveBeenCalledTimes(1));
    first.abort();
    await expect(leaving).rejects.toThrow('Stopped');
    release();
    expect((await staying).map).toEqual(found);
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(signalOf(0)?.aborted).toBe(false);

    // The only view leaves: the reading stops, and the next visit reads afresh.
    analyse.mockClear();
    release = hold();
    const two = await add('Gone', 3);
    const only = new AbortController();
    const gone = ensureSheetMap(two.id, two.sheet, song, open, { signal: only.signal });
    await vi.waitFor(() => expect(analyse).toHaveBeenCalledTimes(1));
    only.abort();
    await expect(gone).rejects.toThrow('Stopped');
    expect(signalOf(0)?.aborted).toBe(true);
    release();
    await ensureSheetMap(two.id, two.sheet, song, open);
    expect(analyse).toHaveBeenCalledTimes(2);
  });
});
