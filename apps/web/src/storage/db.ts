// The private library and progress, in IndexedDB on this device only (spec §10). Nothing here is
// ever sent anywhere; optional encrypted sync comes later (P3-03).
import Dexie from 'dexie';
import type { Table, Transaction } from 'dexie';
import type { Song, SongFormat } from '@opentiles/song-model';
import type { SheetMap } from '@opentiles/sheet';

export interface ImportSettings {
  transpose: number;
  swapHands: boolean;
  /** MIDI only: split point for one-track files. */
  splitPoint?: number;
  /** Base tempo override (quarter notes per minute). */
  baseBpm?: number;
}

/**
 * A sheet-music PDF kept with a piece (ADR 0018). It is only drawn, as the learner's own sheet with
 * the cursor on it; the notes come from the item's song. Like the rest of the library it stays on
 * this device and goes into the encrypted backup only.
 */
export interface SheetAttachment {
  /** The PDF's file name as imported. */
  fileName: string;
  bytes: Uint8Array;
  addedAt: number;
  /** Where the song's measures are on the pages; absent until the PDF has been analysed. */
  map?: SheetMap;
}

/**
 * A whole library piece, its files included: what an import, the backup and sync hand over. In the
 * database it is split in two (P6-04): a `LibraryRow` with everything but the bytes, which lists
 * open fast, and its `LibraryFiles`.
 */
export interface LibraryItem {
  id?: number;
  title: string;
  fileName: string;
  format: SongFormat;
  /** The original file, kept so it can be re-imported when the importers improve. */
  bytes: Uint8Array;
  /** The song after the review-screen settings were applied. */
  song: Song;
  settings: ImportSettings;
  tags: string[];
  addedAt: number;
  /** The sheet-music PDF for this piece, when the learner added one. */
  sheet?: SheetAttachment;
}

/** A piece's sheet music without its bytes, as a library row keeps it. */
export interface SheetInfo {
  fileName: string;
  addedAt: number;
  /** Size of the PDF in bytes, to tell one PDF from its replacement. */
  size: number;
  map?: SheetMap;
}

/** A library piece without its files: what the Library page and the Player list. */
export interface LibraryRow extends Omit<LibraryItem, 'bytes' | 'sheet'> {
  /** Size of the original file in bytes. */
  size: number;
  sheet?: SheetInfo;
}

/** A piece's files, kept apart from its row under the same id (P6-04). */
export interface LibraryFiles {
  id: number;
  bytes: Uint8Array;
  sheetBytes?: Uint8Array;
}

/** A sheet's info without its bytes. */
export function sheetInfo(sheet: SheetAttachment): SheetInfo {
  const { bytes, ...rest } = sheet;
  return { ...rest, size: bytes.length };
}

/** Splits a whole piece into its row and its files. */
export function splitLibraryItem(item: LibraryItem & { id: number }): {
  row: LibraryRow & { id: number };
  files: LibraryFiles;
} {
  const { bytes, sheet, ...rest } = item;
  return {
    row: { ...rest, size: bytes.length, ...(sheet ? { sheet: sheetInfo(sheet) } : {}) },
    files: { id: item.id, bytes, ...(sheet ? { sheetBytes: sheet.bytes } : {}) },
  };
}

/**
 * A whole piece from its row and files. Files that went missing read as empty, so a damaged
 * database still opens the piece's other parts.
 */
export function joinLibraryItem(row: LibraryRow, files: LibraryFiles | undefined): LibraryItem {
  const { size: _size, sheet, ...rest } = row;
  const empty = new Uint8Array(0);
  return {
    ...rest,
    bytes: files?.bytes ?? empty,
    ...(sheet
      ? {
          sheet: {
            fileName: sheet.fileName,
            addedAt: sheet.addedAt,
            bytes: files?.sheetBytes ?? empty,
            ...(sheet.map ? { map: sheet.map } : {}),
          },
        }
      : {}),
  };
}

/**
 * Version 1 kept each piece's file and PDF in its row, so listing the library read every byte.
 * Version 2 moves them to `files`, one piece at a time so a large library never sits in memory at
 * once. A row without bytes (damaged) is left as it is.
 */
export async function moveFilesOutOfRows(tx: Transaction): Promise<void> {
  const library = tx.table('library');
  const files = tx.table('files');
  const ids = (await library.toCollection().primaryKeys()) as number[];
  for (const id of ids) {
    const old = (await library.get(id)) as (LibraryItem & { id: number }) | undefined;
    if (!old || !(old.bytes instanceof Uint8Array)) continue;
    // A sheet without bytes has no PDF to keep; its map alone is of no use.
    const { sheet, ...piece } = old;
    const keep = sheet && sheet.bytes instanceof Uint8Array ? { sheet } : {};
    const { row, files: f } = splitLibraryItem({ ...piece, ...keep });
    await files.put(f);
    await library.put(row);
  }
}

export interface Progress {
  /** `catalogue:<slug>` or `library:<id>`. */
  key: string;
  bestAccuracy: number;
  runs: number;
  lastPlayedAt: number;
  secondsPractised: number;
}

export interface DayStat {
  /** Local date, YYYY-MM-DD. */
  day: string;
  seconds: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

class OpenTilesDb extends Dexie {
  library!: Table<LibraryRow, number>;
  files!: Table<LibraryFiles, number>;
  progress!: Table<Progress, string>;
  days!: Table<DayStat, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('opentiles');
    this.version(1).stores({
      library: '++id, title, addedAt',
      progress: 'key',
      days: 'day',
      settings: 'key',
    });
    this.version(2).stores({ files: 'id' }).upgrade(moveFilesOutOfRows);
  }
}

export const db = new OpenTilesDb();

const MIRROR_PREFIX = 'opentiles:setting:';

/** localStorage, or null where reading it throws (blocked storage, some private modes). */
function mirror(): Storage | null {
  // Not touched outside a browser: Node warns about its own experimental localStorage.
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function readMirror<T>(key: string): { value: T } | null {
  try {
    const raw = mirror()?.getItem(MIRROR_PREFIX + key);
    return raw == null ? null : { value: JSON.parse(raw) as T };
  } catch {
    return null;
  }
}

function writeMirror(key: string, value: unknown): void {
  try {
    const json = JSON.stringify(value);
    // Settings are small. A large value (a calibration trace, say) stays in IndexedDB only.
    if (json !== undefined && json.length <= 20_000) mirror()?.setItem(MIRROR_PREFIX + key, json);
  } catch {
    // Quota or blocked storage: IndexedDB still has the value.
  }
}

/**
 * Reads a setting. IndexedDB is the store; a small copy in localStorage covers browsers where
 * IndexedDB is unavailable or was cleared on its own, so settings survive in either.
 */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const s = await db.settings.get(key);
    if (s !== undefined) return s.value as T;
  } catch {
    // Fall through to the copy.
  }
  return readMirror<T>(key)?.value ?? fallback;
}

/** Saves a setting to IndexedDB and the localStorage copy; rejects only if both fail. */
export async function setSetting(key: string, value: unknown): Promise<void> {
  writeMirror(key, value);
  try {
    await db.settings.put({ key, value });
  } catch (e) {
    if (readMirror(key) === null) throw e;
  }
}

export function localDay(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Records the end of a practice run. */
export async function recordRun(key: string, accuracy: number, seconds: number): Promise<Progress> {
  return db.transaction('rw', db.progress, db.days, async () => {
    const prev = await db.progress.get(key);
    const next: Progress = {
      key,
      bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, accuracy),
      runs: (prev?.runs ?? 0) + 1,
      lastPlayedAt: Date.now(),
      secondsPractised: (prev?.secondsPractised ?? 0) + seconds,
    };
    await db.progress.put(next);
    const day = localDay();
    const d = await db.days.get(day);
    await db.days.put({ day, seconds: (d?.seconds ?? 0) + seconds });
    return next;
  });
}

/**
 * Adds practice time to today without a progress record: for sight-reading drills (P5-05), which
 * are made up on the spot and have no piece to track.
 */
export async function recordPracticeTime(seconds: number): Promise<void> {
  if (!(seconds > 0)) return;
  await db.transaction('rw', db.days, async () => {
    const day = localDay();
    const d = await db.days.get(day);
    await db.days.put({ day, seconds: (d?.seconds ?? 0) + seconds });
  });
}

/** Consecutive days with practice, ending today or yesterday. */
export function streak(days: readonly DayStat[], today = new Date()): number {
  const set = new Set(days.filter((d) => d.seconds > 0).map((d) => d.day));
  const cursor = new Date(today);
  if (!set.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  let n = 0;
  while (set.has(localDay(cursor))) {
    n += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return n;
}
