// Changes to library pieces and their sheet music (ADR 0018). Everything stays in IndexedDB on
// this device; the only way out is the learner's own encrypted backup.
import { db } from '../storage/db';
import type { LibraryItem, SheetAttachment } from '../storage/db';
import {
  deleteLibraryItem,
  getLibraryItem,
  putLibraryItem,
  setLibrarySheet,
} from '../storage/library';
import { sheetAttachment } from './sheet';
import type { SheetFile } from './sheet';

/** The parts of a piece that come from its MIDI or score file. */
export type PieceNotes = Pick<
  LibraryItem,
  'title' | 'fileName' | 'format' | 'bytes' | 'song' | 'settings'
>;

/** Adds or replaces a piece's PDF. A new PDF has new pages, so any map of the old one goes. */
export async function attachSheet(id: number, file: SheetFile): Promise<void> {
  if (!(await setLibrarySheet(id, sheetAttachment(file)))) throw new Error('No such piece');
}

/** Removes a piece's PDF; the piece and its notes stay. */
export async function removeSheet(id: number): Promise<void> {
  await setLibrarySheet(id, undefined);
}

/**
 * The sheet to keep when a piece's song changes. The map links the old song's measures to bars, so
 * it is dropped and the sheet view makes a new one, unless the learner corrected it: then it is
 * kept for its corrected bars, and the view must re-align it to the new measures.
 */
export function sheetForNewSong(sheet: SheetAttachment): SheetAttachment {
  if (sheet.map?.edited) return sheet;
  const { map: _stale, ...rest } = sheet;
  return rest;
}

/**
 * Gives a piece (usually a sheet-only one) the notes of a MIDI or score file, keeping its sheet,
 * id, tags and date so its place in the library and its links stay the same.
 */
export async function addNotes(id: number, notes: PieceNotes): Promise<void> {
  await db.transaction('rw', db.library, db.files, async () => {
    const item = await getLibraryItem(id);
    if (!item) throw new Error('No such piece');
    const { sheet, ...rest } = item;
    await putLibraryItem({
      ...rest,
      ...notes,
      id,
      ...(sheet ? { sheet: sheetForNewSong(sheet) } : {}),
    });
  });
}

/** Deletes a piece, its sheet music (which is part of it) and its progress. */
export async function deletePiece(id: number): Promise<void> {
  await db.transaction('rw', db.library, db.files, db.progress, async () => {
    await deleteLibraryItem(id);
    await db.progress.delete(`library:${id}`);
  });
}
