// Sheet-music PDFs with a piece (P5-15, ADR 0018): grouping picked files into pieces, checking
// PDFs, sheet-only pieces and the library changes. File names here are made up.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { estimateDifficulty } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { SheetMap } from '@opentiles/sheet';
import { fileRole, pairKey, planImport } from '../src/library/pairing';
import { pieceNotes, sheetOnlyPending } from '../src/library/pending';
import {
  isSheetOnly,
  looksLikePdf,
  MAX_PDF_BYTES,
  readSheetFile,
  sheetOnlySong,
  titleFromFileName,
} from '../src/library/sheet';
import {
  addNotes,
  attachSheet,
  deletePiece,
  removeSheet,
  sheetForNewSong,
} from '../src/library/store';
import { db } from '../src/storage/db';
import { addLibraryItem, getLibraryItem } from '../src/storage/library';
import type { LibraryItem } from '../src/storage/db';

const file = (name: string, type = '') => ({ name, type });
const names = (plan: ReturnType<typeof planImport<{ name: string; type: string }>>) =>
  plan.groups.map((g) => [g.notes?.name ?? null, g.sheet?.name ?? null]);

const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

describe('grouping picked files into pieces', () => {
  it('pairs a MIDI file and a PDF with the same base name', () => {
    const plan = planImport([
      file('Study.mid', 'audio/midi'),
      file('Study.pdf', 'application/pdf'),
    ]);
    expect(plan.ask).toBeNull();
    expect(names(plan)).toEqual([['Study.mid', 'Study.pdf']]);
  });

  it('pairs whichever order the files come in, ignoring case and spacing', () => {
    const plan = planImport([file('my  study .PDF'), file('My Study.MID')]);
    expect(names(plan)).toEqual([['My Study.MID', 'my  study .PDF']]);
  });

  it('pairs names written the way score-sharing sites write them', () => {
    const base = 'Composer_ A. Person Arranger_ B. Other - Little Waltz in G_ Op. 3 No. 1';
    const plan = planImport([file(`${base}.mid`), file(`${base}.pdf`), file(`${base}.MID`)]);
    expect(names(plan)).toEqual([
      [`${base}.mid`, `${base}.pdf`],
      [`${base}.MID`, null],
    ]);
    expect(pairKey(`${base}.pdf`)).toBe(pairKey(`${base.toUpperCase()}.mid`));
  });

  it('makes a lone PDF a sheet-only piece and leaves a lone score file as it was', () => {
    expect(names(planImport([file('Only Sheet.pdf')]))).toEqual([[null, 'Only Sheet.pdf']]);
    expect(names(planImport([file('Only Notes.mid')]))).toEqual([['Only Notes.mid', null]]);
    expect(names(planImport([file('tune.abc')]))).toEqual([['tune.abc', null]]);
  });

  it('asks when exactly one score file and one PDF have different names', () => {
    const plan = planImport([file('Study.mid'), file('Study (scan).pdf')]);
    expect(plan.groups).toEqual([]);
    expect(plan.ask?.notes.name).toBe('Study.mid');
    expect(plan.ask?.sheet.name).toBe('Study (scan).pdf');
  });

  it('does not ask, but keeps the files apart, when more files were picked', () => {
    const plan = planImport([file('One.mid'), file('Two.pdf'), file('Three.mid')]);
    expect(plan.ask).toBeNull();
    expect(names(plan)).toEqual([
      ['One.mid', null],
      [null, 'Two.pdf'],
      ['Three.mid', null],
    ]);
  });

  it('pairs several pieces at once, in the order they came', () => {
    const plan = planImport([
      file('B.pdf'),
      file('A.mid'),
      file('C.mxl'),
      file('A.pdf'),
      file('B.mid'),
      file('D.pdf'),
    ]);
    expect(names(plan)).toEqual([
      ['A.mid', 'A.pdf'],
      ['C.mxl', null],
      ['B.mid', 'B.pdf'],
      [null, 'D.pdf'],
    ]);
  });

  it('gives a name with two score files its PDF on the first; the other stands alone', () => {
    const plan = planImport([file('Piece.mxl'), file('Piece.mid'), file('Piece.pdf')]);
    expect(names(plan)).toEqual([
      ['Piece.mxl', 'Piece.pdf'],
      ['Piece.mid', null],
    ]);
  });

  it('pairs only the first of two PDFs with one name; the other is sheet-only', () => {
    const plan = planImport([file('Piece.pdf'), file('Piece.mid'), file('PIECE.pdf')]);
    expect(names(plan)).toEqual([
      ['Piece.mid', 'Piece.pdf'],
      [null, 'PIECE.pdf'],
    ]);
  });

  it('never pairs a recording with a PDF, and does not ask about one', () => {
    const plan = planImport([file('Piece.mp3', 'audio/mpeg'), file('Piece.pdf')]);
    expect(plan.ask).toBeNull();
    expect(names(plan)).toEqual([
      ['Piece.mp3', null],
      [null, 'Piece.pdf'],
    ]);
    expect(names(planImport([file('Piece.mid'), file('Piece.mp3'), file('Piece.pdf')]))).toEqual([
      ['Piece.mid', 'Piece.pdf'],
      ['Piece.mp3', null],
    ]);
  });

  it('tells sheets, scores and recordings apart by name and type', () => {
    expect(fileRole('a.PDF')).toBe('sheet');
    expect(fileRole('download', 'application/pdf')).toBe('sheet');
    expect(fileRole('a.mid', 'audio/midi')).toBe('score');
    expect(fileRole('a.m4a')).toBe('recording');
    // Unknown names go to the score importer, which reads the content and says what is wrong.
    expect(fileRole('notes.txt')).toBe('score');
  });
});

describe('checking a PDF', () => {
  const blob = (bytes: Uint8Array, name: string) =>
    Object.assign(new Blob([new Uint8Array(bytes)]), { name });

  it('accepts the PDF header at the start or within the first 1024 bytes', () => {
    expect(looksLikePdf(PDF)).toBe(true);
    const late = new Uint8Array(1100);
    late.set(PDF, 1000);
    expect(looksLikePdf(late)).toBe(true);
    late.fill(0).set(PDF, 1020);
    expect(looksLikePdf(late)).toBe(false);
    expect(looksLikePdf(new TextEncoder().encode('MThd'))).toBe(false);
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
  });

  it('reads a PDF and refuses a file that only has the name of one', async () => {
    await expect(readSheetFile(blob(PDF, 'Study.pdf'))).resolves.toEqual({
      fileName: 'Study.pdf',
      bytes: PDF,
    });
    await expect(
      readSheetFile(blob(new TextEncoder().encode('<html>'), 'page.pdf')),
    ).rejects.toThrow('“page.pdf” is not a PDF file');
  });

  it('refuses a PDF over the limit before reading it', async () => {
    let read = false;
    const huge = {
      name: 'Volume.pdf',
      size: MAX_PDF_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as Blob & { name: string };
    await expect(readSheetFile(huge)).rejects.toThrow(
      'This PDF is too large (60 MB). The limit is 60 MB.',
    );
    expect(read).toBe(false);
    expect(MAX_PDF_BYTES).toBe(60_000_000);
  });
});

describe('a sheet-only piece', () => {
  it('has an empty song in the pdf format, named after the file', () => {
    const p = sheetOnlyPending({ fileName: 'Folder/Little Waltz.pdf', bytes: PDF });
    expect(p.title).toBe('Little Waltz');
    expect(p.bytes.length).toBe(0);
    expect(p.fileName).toBe('Folder/Little Waltz.pdf');
    expect(p.base).toMatchObject({
      format: 'pdf',
      notes: [],
      measures: [],
      lengthBeats: 0,
      tempos: [{ beat: 0, bpm: 120 }],
    });
    // The review screen reads these from every song.
    expect(estimateDifficulty(p.base).level).toBe(1);
    const saved = pieceNotes({ ...p, title: '  ' });
    expect(saved.format).toBe('pdf');
    expect(saved.title).toBe('Untitled');
    expect(isSheetOnly(saved)).toBe(true);
    expect(titleFromFileName('.pdf')).toBe('Untitled');
    expect(sheetOnlySong('x').parts).toHaveLength(1);
  });
});

function song(format: Song['format'], measures: number): Song {
  return {
    ...sheetOnlySong('t'),
    format,
    measures: Array.from({ length: measures }, (_, i) => ({
      index: i,
      number: String(i + 1),
      sourceIndex: i,
      startBeat: 4 * i,
      lengthBeats: 4,
    })),
    lengthBeats: 4 * measures,
  };
}

function map(edited: boolean): SheetMap {
  return {
    layout: {
      pages: [{ width: 595, height: 842 }],
      bars: [
        {
          page: 0,
          system: 0,
          box: { x: 50, y: 100, width: 120, height: 80 },
          start: 'none',
          end: 'single',
        },
      ],
      source: 'vector',
    },
    barOfMeasure: [],
    edited,
    analyser: 1,
  };
}

function sheetOnlyItem(edited?: boolean): LibraryItem {
  return {
    title: 'My Waltz',
    fileName: 'Waltz.pdf',
    format: 'pdf',
    bytes: new Uint8Array(0),
    song: sheetOnlySong('Waltz'),
    settings: { transpose: 0, swapHands: false },
    tags: ['mine'],
    addedAt: 1000,
    sheet: {
      fileName: 'Waltz.pdf',
      bytes: PDF,
      addedAt: 1000,
      ...(edited === undefined ? {} : { map: map(edited) }),
    },
  };
}

const notes = {
  title: 'Waltz',
  fileName: 'Waltz.mid',
  format: 'midi' as const,
  bytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64]),
  song: song('midi', 3),
  settings: { transpose: 0, swapHands: false },
};

describe('sheet music in the library', () => {
  beforeEach(async () => {
    await Promise.all([db.library.clear(), db.files.clear(), db.progress.clear()]);
  });

  it('adds the notes to a sheet-only piece, keeping its sheet, id, tags and date', async () => {
    const id = await addLibraryItem(sheetOnlyItem(false));
    await addNotes(id, notes);
    const item = await getLibraryItem(id);
    expect(item).toMatchObject({
      id,
      title: 'Waltz',
      fileName: 'Waltz.mid',
      format: 'midi',
      tags: ['mine'],
      addedAt: 1000,
      sheet: { fileName: 'Waltz.pdf', bytes: PDF, addedAt: 1000 },
    });
    expect(item?.song.measures).toHaveLength(3);
    // The map linked the old (empty) song's measures; the sheet view makes a new one.
    expect(item?.sheet && 'map' in item.sheet).toBe(false);
    expect(isSheetOnly(item ?? sheetOnlyItem())).toBe(false);
  });

  it('keeps a map the learner corrected when the song changes', async () => {
    const id = await addLibraryItem(sheetOnlyItem(true));
    await addNotes(id, notes);
    expect((await getLibraryItem(id))?.sheet?.map).toEqual(map(true));
    expect(sheetForNewSong(sheetOnlyItem(false).sheet!)).not.toHaveProperty('map');
    expect(sheetForNewSong(sheetOnlyItem().sheet!)).not.toHaveProperty('map');
  });

  it('adds, replaces and removes a piece’s PDF', async () => {
    const { sheet: _none, ...plain } = sheetOnlyItem();
    const id = await addLibraryItem({ ...plain, ...notes });
    await attachSheet(id, { fileName: 'First.pdf', bytes: PDF });
    expect((await getLibraryItem(id))?.sheet?.fileName).toBe('First.pdf');

    // A new PDF drops the old one's map, even a corrected one: its pages are different.
    await db.library.update(id, { 'sheet.map': map(true) });
    expect((await getLibraryItem(id))?.sheet?.map?.edited).toBe(true);
    const second = new Uint8Array([...PDF, 0x0a]);
    await attachSheet(id, { fileName: 'Second.pdf', bytes: second });
    const replaced = await getLibraryItem(id);
    expect(replaced?.sheet).toMatchObject({ fileName: 'Second.pdf', bytes: second });
    expect(replaced?.sheet && 'map' in replaced.sheet).toBe(false);

    await removeSheet(id);
    const removed = await getLibraryItem(id);
    expect(removed && 'sheet' in removed).toBe(false);
    expect(removed?.song.measures).toHaveLength(3);
    await expect(attachSheet(id + 100, { fileName: 'x.pdf', bytes: PDF })).rejects.toThrow();
  });

  it('deletes a piece with its sheet music and progress', async () => {
    const id = await addLibraryItem(sheetOnlyItem(false));
    await db.progress.put({
      key: `library:${id}`,
      bestAccuracy: 0.5,
      runs: 1,
      lastPlayedAt: 1,
      secondsPractised: 1,
    });
    await deletePiece(id);
    expect(await db.library.count()).toBe(0);
    expect(await db.progress.get(`library:${id}`)).toBeUndefined();
  });
});
