// Whole library pieces across the two tables they live in (P6-04): the row (metadata, song, sheet
// map) and its files (the original file and the PDF). Lists read rows only; opening a piece, the
// backup and sync read the files too. Every write touches both tables in one transaction, so a
// piece is never left half saved. Nothing here leaves the device (hard rule 3).
import { db, joinLibraryItem, sheetInfo, splitLibraryItem } from './db';
import type { LibraryFiles, LibraryItem, LibraryRow, SheetAttachment } from './db';

/** Adds a whole piece; returns its id. */
export async function addLibraryItem(item: LibraryItem): Promise<number> {
  return db.transaction('rw', db.library, db.files, async () => {
    const { id: _none, bytes, sheet, ...rest } = item;
    const id = await db.library.add({
      ...rest,
      size: bytes.length,
      ...(sheet ? { sheet: sheetInfo(sheet) } : {}),
    });
    await db.files.put({ id, bytes, ...(sheet ? { sheetBytes: sheet.bytes } : {}) });
    return id;
  });
}

/** Replaces a whole piece under its id (or adds it there). */
export async function putLibraryItem(item: LibraryItem & { id: number }): Promise<void> {
  const { row, files } = splitLibraryItem(item);
  await db.transaction('rw', db.library, db.files, async () => {
    await db.library.put(row);
    await db.files.put(files);
  });
}

/** A piece's files, or undefined when there is no such piece. */
export async function getLibraryFiles(id: number): Promise<LibraryFiles | undefined> {
  return db.files.get(id);
}

/** A whole piece, files included, or undefined when there is no such piece. */
export async function getLibraryItem(
  id: number,
): Promise<(LibraryItem & { id: number }) | undefined> {
  return db.transaction('r', db.library, db.files, async () => {
    const row = await db.library.get(id);
    if (!row) return undefined;
    return { ...joinLibraryItem(row, await db.files.get(id)), id };
  });
}

/** Every piece with its files, for the backup. Holds them all in memory, as the backup must. */
export async function allLibraryItems(): Promise<(LibraryItem & { id: number })[]> {
  return db.transaction('r', db.library, db.files, async () => {
    const rows = await db.library.toArray();
    const out: (LibraryItem & { id: number })[] = [];
    for (const row of rows) {
      if (row.id === undefined) continue;
      out.push({ ...joinLibraryItem(row, await db.files.get(row.id)), id: row.id });
    }
    return out;
  });
}

/** Deletes a piece and its files. */
export async function deleteLibraryItem(id: number): Promise<void> {
  await db.transaction('rw', db.library, db.files, async () => {
    await db.library.delete(id);
    await db.files.delete(id);
  });
}

/**
 * Gives a piece sheet music, replaces it, or removes it (`undefined`). Returns false when there is
 * no such piece.
 */
export async function setLibrarySheet(
  id: number,
  sheet: SheetAttachment | undefined,
): Promise<boolean> {
  return db.transaction('rw', db.library, db.files, async () => {
    const row = await db.library.get(id);
    if (!row) return false;
    const files = (await db.files.get(id)) ?? { id, bytes: new Uint8Array(0) };
    const { sheet: _old, ...rest } = row;
    const { sheetBytes: _oldBytes, ...fileRest } = files;
    await db.library.put(sheet ? { ...rest, sheet: sheetInfo(sheet) } : rest);
    await db.files.put(sheet ? { ...fileRest, sheetBytes: sheet.bytes } : fileRest);
    return true;
  });
}

/** The rows of the library, newest first, without any file bytes. */
export async function libraryRows(): Promise<LibraryRow[]> {
  return db.library.orderBy('addedAt').reverse().toArray();
}
