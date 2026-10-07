// One-tap encrypted backup and restore (P2-13, spec §10 "Backup file"). The file is built by
// @opentiles/vault on this device; everything but a short README and the wrapped key is encrypted.
// It is the user's own copy: OpenTiles never uploads it anywhere (docs/development.md hard rule 1).
import {
  backupFileName,
  createVault,
  exportBackup,
  importBackup,
  type Argon2idParams,
  type BackupData,
  type VaultSecret,
} from '@opentiles/vault';
import type { Song } from '@opentiles/song-model';
import { db } from '../storage/db';
import type { DayStat, LibraryItem, Progress, Setting } from '../storage/db';

export { backupFileName };

/** A library item as stored in a backup: everything but the local id, which is kept separately. */
export interface BackupLibraryItem extends Omit<LibraryItem, 'id'> {
  /** The id on the device that made the backup, so progress records can be matched up. */
  originalId: number | null;
}

export interface BackupProgress {
  progress: Progress[];
  days: DayStat[];
}

export type BackupStage = 'collecting' | 'deriving-key' | 'encrypting' | 'decrypting' | 'merging';

export interface BackupOptions {
  onProgress?: (stage: BackupStage) => void;
  /** Tests only: cheaper key derivation. */
  kdf?: Argon2idParams;
  unsafeAllowWeakKdf?: boolean;
}

/** Settings that belong to this device only and are never put in a backup. */
export function isDeviceSetting(key: string): boolean {
  return key.startsWith('device.') || key.startsWith('sync.');
}

export async function collectBackupData(): Promise<BackupData> {
  const [library, progress, days, settings] = await Promise.all([
    db.library.toArray(),
    db.progress.toArray(),
    db.days.toArray(),
    db.settings.toArray(),
  ]);
  const items: BackupLibraryItem[] = library.map(({ id, ...rest }) => ({
    ...rest,
    originalId: id ?? null,
  }));
  const p: BackupProgress = { progress, days };
  return {
    library: items,
    progress: p,
    settings: settings.filter((s) => !isDeviceSetting(s.key)),
  };
}

/** Builds the encrypted .zip from everything on this device. */
export async function createBackupFile(
  passphrase: string,
  options: BackupOptions = {},
): Promise<Uint8Array> {
  const report = options.onProgress ?? (() => {});
  report('collecting');
  const data = await collectBackupData();
  report('deriving-key');
  const { vault } = await createVault(passphrase, {
    recoveryCode: false,
    ...(options.kdf ? { kdf: options.kdf } : {}),
    ...(options.unsafeAllowWeakKdf ? { unsafeAllowWeakKdf: true } : {}),
  });
  report('encrypting');
  return exportBackup(vault, data);
}

export interface RestoreSummary {
  added: number;
  /** Items already on this device. */
  skipped: number;
  progress: number;
  days: number;
  settings: number;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copy));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Two items are the same import when file, time added and contents match. */
async function fingerprint(item: Pick<LibraryItem, 'fileName' | 'addedAt' | 'bytes'>) {
  return `${item.fileName}\u0000${item.addedAt}\u0000${await sha256(item.bytes)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asLibraryItem(v: unknown): BackupLibraryItem | null {
  if (!isRecord(v)) return null;
  if (typeof v.title !== 'string' || typeof v.fileName !== 'string') return null;
  if (!(v.bytes instanceof Uint8Array) || !isRecord(v.song)) return null;
  if (!Array.isArray((v.song as { notes?: unknown }).notes)) return null;
  if (typeof v.format !== 'string' || typeof v.addedAt !== 'number') return null;
  return {
    title: v.title,
    fileName: v.fileName,
    format: v.format as LibraryItem['format'],
    bytes: v.bytes,
    song: v.song as unknown as Song,
    settings: isRecord(v.settings)
      ? (v.settings as unknown as LibraryItem['settings'])
      : { transpose: 0, swapHands: false },
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [],
    addedAt: v.addedAt,
    originalId: typeof v.originalId === 'number' ? v.originalId : null,
  };
}

function asProgress(v: unknown): Progress | null {
  if (!isRecord(v) || typeof v.key !== 'string') return null;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
  return {
    key: v.key,
    bestAccuracy: Math.min(1, Math.max(0, n(v.bestAccuracy))),
    runs: n(v.runs),
    lastPlayedAt: n(v.lastPlayedAt),
    secondsPractised: n(v.secondsPractised),
  };
}

function asDay(v: unknown): DayStat | null {
  if (!isRecord(v) || typeof v.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return null;
  return { day: v.day, seconds: typeof v.seconds === 'number' ? Math.max(0, v.seconds) : 0 };
}

/**
 * Merges restored data into this device. Nothing local is deleted or overwritten with less:
 * library items already present are skipped, progress keeps the better of both, and settings
 * from the backup fill only keys this device has not set.
 */
export async function mergeBackupData(data: BackupData): Promise<RestoreSummary> {
  const summary: RestoreSummary = { added: 0, skipped: 0, progress: 0, days: 0, settings: 0 };
  const items = data.library.map(asLibraryItem).filter((i): i is BackupLibraryItem => i !== null);
  const p = isRecord(data.progress) ? data.progress : {};
  const progress = (Array.isArray(p.progress) ? p.progress : [])
    .map(asProgress)
    .filter((x): x is Progress => x !== null);
  const days = (Array.isArray(p.days) ? p.days : [])
    .map(asDay)
    .filter((x): x is DayStat => x !== null);
  const settings = (Array.isArray(data.settings) ? data.settings : []).filter(
    (s): s is Setting => isRecord(s) && typeof s.key === 'string' && !isDeviceSetting(s.key),
  );

  // Hash outside the transaction: IndexedDB transactions close while awaiting other promises.
  const local = await db.library.toArray();
  const known = new Map<string, number>();
  for (const item of local) {
    if (item.id !== undefined) known.set(await fingerprint(item), item.id);
  }
  const incoming = await Promise.all(
    items.map(async (i) => ({ item: i, fp: await fingerprint(i) })),
  );

  await db.transaction('rw', [db.library, db.progress, db.days, db.settings], async () => {
    // Old id on the backup's device -> id on this device.
    const idMap = new Map<number, number>();
    for (const { item, fp } of incoming) {
      let id = known.get(fp);
      if (id === undefined) {
        const { originalId: _drop, ...rest } = item;
        id = await db.library.add(rest);
        known.set(fp, id);
        summary.added += 1;
      } else {
        summary.skipped += 1;
      }
      if (item.originalId !== null) idMap.set(item.originalId, id);
    }

    for (const entry of progress) {
      let key = entry.key;
      const m = /^library:(\d+)$/.exec(key);
      if (m) {
        const id = idMap.get(Number(m[1]));
        if (id === undefined) continue;
        key = `library:${id}`;
      } else if (!key.startsWith('catalogue:')) {
        continue;
      }
      const prev = await db.progress.get(key);
      const next: Progress = prev
        ? {
            key,
            bestAccuracy: Math.max(prev.bestAccuracy, entry.bestAccuracy),
            runs: Math.max(prev.runs, entry.runs),
            lastPlayedAt: Math.max(prev.lastPlayedAt, entry.lastPlayedAt),
            secondsPractised: Math.max(prev.secondsPractised, entry.secondsPractised),
          }
        : { ...entry, key };
      await db.progress.put(next);
      summary.progress += 1;
    }

    for (const d of days) {
      const prev = await db.days.get(d.day);
      if (!prev || prev.seconds < d.seconds) {
        await db.days.put(d);
        summary.days += 1;
      }
    }

    for (const s of settings) {
      if ((await db.settings.get(s.key)) === undefined) {
        await db.settings.put({ key: s.key, value: s.value });
        summary.settings += 1;
      }
    }
  });
  return summary;
}

/** Opens a backup file with its passphrase or recovery code and merges it into this device. */
export async function restoreBackupFile(
  file: Uint8Array,
  secret: VaultSecret,
  options: Pick<BackupOptions, 'onProgress'> = {},
): Promise<RestoreSummary> {
  const report = options.onProgress ?? (() => {});
  report('decrypting');
  const { data } = await importBackup(file, secret);
  report('merging');
  return mergeBackupData(data);
}
