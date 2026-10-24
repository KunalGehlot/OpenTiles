// The semitones each piece was last moved by on the practice screen (P5-04), so a piece opens in
// the key the learner chose for it. Kept in one setting, so the shifts go into the backup and sync
// with the other settings. Each piece needs a key that names it on every device: a catalogue piece
// has its slug; a library piece's id does not do (a restore elsewhere numbers pieces anew, and ids
// start again at 1 once IndexedDB is cleared while the localStorage copy of this setting lives on),
// so it goes by when it was added and its file name, which the backup also tells pieces apart by.
// Drills are made up on the spot and keep nothing.
import { getSetting, setSetting } from '../storage/db';
import type { LibraryItem } from '../storage/db';
import { MAX_SHIFT } from './transpose';

export const PIECE_SHIFTS_KEY = 'pieceShifts';

type Shifts = Record<string, number>;

export function catalogueShiftKey(slug: string): string {
  return `catalogue:${slug}`;
}

export function libraryShiftKey(item: Pick<LibraryItem, 'addedAt' | 'fileName'>): string {
  return `library:${item.addedAt}:${item.fileName}`;
}

/** The stored map with every damaged entry left out, since the value may be old or edited. */
export function normaliseShifts(value: unknown): Shifts {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Shifts = {};
  for (const [key, shift] of Object.entries(value)) {
    if (typeof shift !== 'number' || !Number.isInteger(shift) || shift === 0) continue;
    if (Math.abs(shift) > MAX_SHIFT) continue;
    out[key] = shift;
  }
  return out;
}

async function read(): Promise<Shifts> {
  try {
    return normaliseShifts(await getSetting<unknown>(PIECE_SHIFTS_KEY, null));
  } catch {
    return {};
  }
}

/** The shift a piece opens with: 0 when none is stored or storage is unavailable. */
export async function loadPieceShift(key: string): Promise<number> {
  return (await read())[key] ?? 0;
}

let saving: Promise<void> = Promise.resolve();

/** Remembers a piece's shift; 0 forgets it. Saves are queued in order and never reject. */
export function savePieceShift(key: string, shift: number): Promise<void> {
  saving = saving
    .then(async () => {
      const shifts = await read();
      if (shift === 0) delete shifts[key];
      else shifts[key] = shift;
      await setSetting(PIECE_SHIFTS_KEY, normaliseShifts(shifts));
    })
    .catch(() => {});
  return saving;
}
