// Saves a sheet's map on its library item (ADR 0018). Only the map is written, by key path, so
// the PDF's bytes are never rewritten from here; and only while the item still holds the sheet that
// was analysed, since the learner may replace or remove it meanwhile.
import type { SheetMap } from '@opentiles/sheet';
import { db } from '../../storage/db';
import type { SheetAttachment } from '../../storage/db';

const sameSheet = (a: SheetAttachment, b: SheetAttachment) =>
  a.addedAt === b.addedAt && a.fileName === b.fileName && a.bytes.length === b.bytes.length;

/**
 * Stores a map. A map the learner corrected is never replaced by one they did not make
 * (`map.edited` false); returns whether the map was stored.
 */
export async function saveSheetMap(
  itemId: number,
  sheet: SheetAttachment,
  map: SheetMap,
): Promise<boolean> {
  return db.transaction('rw', db.library, async () => {
    const item = await db.library.get(itemId);
    const stored = item?.sheet;
    if (!stored || !sameSheet(stored, sheet)) return false;
    if (stored.map?.edited && !map.edited) return false;
    await db.library.update(itemId, { 'sheet.map': map });
    return true;
  });
}

/** Forgets a map, corrections included, so the sheet is analysed afresh ("Find the bars again"). */
export async function clearSheetMap(itemId: number, sheet: SheetAttachment): Promise<boolean> {
  return db.transaction('rw', db.library, async () => {
    const item = await db.library.get(itemId);
    const stored = item?.sheet;
    if (!stored || !sameSheet(stored, sheet)) return false;
    await db.library.update(itemId, { 'sheet.map': undefined });
    return true;
  });
}
