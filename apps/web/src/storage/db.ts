// The private library and progress, in IndexedDB on this device only (spec §10). Nothing here is
// ever sent anywhere; optional encrypted sync comes later (P3-03).
import Dexie from 'dexie';
import type { Table } from 'dexie';
import type { Song, SongFormat } from '@opentiles/song-model';

export interface ImportSettings {
  transpose: number;
  swapHands: boolean;
  /** MIDI only: split point for one-track files. */
  splitPoint?: number;
  /** Base tempo override (quarter notes per minute). */
  baseBpm?: number;
}

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
  library!: Table<LibraryItem, number>;
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
