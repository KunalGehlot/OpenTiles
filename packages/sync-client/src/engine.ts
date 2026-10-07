// The sync engine (P3-03): pushes and pulls encrypted records against the server's version log.
//
// Conflict rule: last writer wins, per record. Every write carries the version it was based on;
// the server refuses a write whose base is stale, the engine downloads the newer copy and keeps
// whichever change is later by its hybrid-clock time (ties go to the higher device id). Every
// device applies the same rule, so all of them settle on the same copy.
//
// Nothing leaves the device unencrypted: each record (kind, data, times, device id) is sealed
// with the library key, bound to its record id and version so the server cannot swap or replay
// blobs.
import {
  VaultError,
  decryptRecord,
  encryptRecord,
  isVaultError,
  randomBytes,
  toBase64Url,
} from '@opentiles/vault';
import type { RemoteBlob, SyncApi } from './api';
import { VersionConflictError } from './errors';
import type { StoredRecord, SyncRecord, SyncStore } from './store';

const ENVELOPE_VERSION = 1;
const MAX_PUSH_ATTEMPTS = 5;

/** A fresh opaque record id (128 random bits). */
export function newRecordId(): string {
  return toBase64Url(randomBytes(16));
}

/** A fresh device id. Store it with the device's settings. */
export function newDeviceId(): string {
  return toBase64Url(randomBytes(12));
}

function context(id: string, version: number): string {
  return `sync/${id}/${version}`;
}

/** True when `a` should replace `b` under last-writer-wins. */
export function wins(a: SyncRecord, b: SyncRecord): boolean {
  return a.modifiedAt > b.modifiedAt || (a.modifiedAt === b.modifiedAt && a.deviceId > b.deviceId);
}

function envelope(record: SyncRecord) {
  return {
    v: ENVELOPE_VERSION,
    id: record.id,
    kind: record.kind,
    deleted: record.deleted,
    modifiedAt: record.modifiedAt,
    deviceId: record.deviceId,
    data: record.deleted ? null : record.data,
  };
}

function parseEnvelope(value: unknown, id: string): SyncRecord {
  const e = value as Record<string, unknown> | null;
  if (typeof e?.v === 'number' && e.v > ENVELOPE_VERSION) {
    throw new VaultError('unsupported', 'This record was synced by a newer version of OpenTiles');
  }
  if (
    typeof e !== 'object' ||
    e === null ||
    e.v !== ENVELOPE_VERSION ||
    e.id !== id ||
    typeof e.kind !== 'string' ||
    typeof e.deleted !== 'boolean' ||
    typeof e.modifiedAt !== 'number' ||
    typeof e.deviceId !== 'string'
  ) {
    throw new VaultError('corrupt', 'A synced record has an unexpected shape');
  }
  return {
    id,
    kind: e.kind,
    deleted: e.deleted,
    modifiedAt: e.modifiedAt,
    deviceId: e.deviceId,
    data: e.deleted ? null : (e.data ?? null),
  };
}

export interface SyncEngineOptions {
  api: SyncApi;
  /** The unlocked library key. */
  key: CryptoKey;
  store: SyncStore;
  deviceId: string;
  now?: () => number;
  /** Called after a change from another device replaced the local copy. */
  onRemoteChange?: (record: SyncRecord) => void | Promise<void>;
  pageSize?: number;
}

export interface SyncResult {
  /** Records taken from the server. */
  pulled: number;
  /** Records uploaded. */
  pushed: number;
  /** Concurrent changes resolved by last-writer-wins. */
  conflicts: number;
  /**
   * Records that could not be decrypted (damaged, or written by a newer app version). They are
   * skipped so one bad record cannot block the rest; they are retried when they change again.
   */
  failed: string[];
}

interface Remote {
  version: number;
  /** Null when the server holds only a deletion marker without content. */
  record: SyncRecord | null;
}

export class SyncEngine {
  private readonly api: SyncApi;
  private readonly key: CryptoKey;
  private readonly store: SyncStore;
  private readonly deviceId: string;
  private readonly now: () => number;
  private readonly onRemoteChange: SyncEngineOptions['onRemoteChange'];
  private readonly pageSize: number;
  private lastTime = 0;
  private lock: Promise<unknown> = Promise.resolve();
  private running: Promise<SyncResult> | null = null;

  constructor(options: SyncEngineOptions) {
    this.api = options.api;
    this.key = options.key;
    this.store = options.store;
    this.deviceId = options.deviceId;
    this.now = options.now ?? Date.now;
    this.onRemoteChange = options.onRemoteChange;
    this.pageSize = options.pageSize ?? 200;
  }

  /** Serialises reads-then-writes of the store, so a local edit never interleaves with a merge. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Hybrid logical clock: wall time, but never behind a time already seen. */
  private tick(): number {
    this.lastTime = Math.max(this.now(), this.lastTime + 1);
    return this.lastTime;
  }

  private observe(time: number): void {
    if (time > this.lastTime) this.lastTime = time;
  }

  /** Records a local change. Always go through this (not the store) so merges stay safe. */
  change(id: string, kind: string, data: unknown): Promise<SyncRecord> {
    return this.exclusive(async () => {
      const previous = await this.store.get(id);
      const record: SyncRecord = {
        id,
        kind,
        data,
        deleted: false,
        modifiedAt: this.tick(),
        deviceId: this.deviceId,
      };
      await this.store.put({ record, version: previous?.version ?? 0, pending: true });
      return record;
    });
  }

  /** Records a local deletion; it syncs as a sealed tombstone. */
  remove(id: string): Promise<void> {
    return this.exclusive(async () => {
      const previous = await this.store.get(id);
      if (previous === undefined || previous.record.deleted) return;
      const record: SyncRecord = {
        ...previous.record,
        data: null,
        deleted: true,
        modifiedAt: this.tick(),
        deviceId: this.deviceId,
      };
      await this.store.put({ record, version: previous.version, pending: true });
    });
  }

  /** Pulls remote changes, then pushes local ones. Concurrent calls share one run. */
  sync(): Promise<SyncResult> {
    this.running ??= (async () => {
      try {
        const result: SyncResult = { pulled: 0, pushed: 0, conflicts: 0, failed: [] };
        await this.pull(result);
        await this.push(result);
        return result;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private async fetchRemote(id: string): Promise<Remote | null> {
    const blob: RemoteBlob | null = await this.api.getBlob(id);
    if (blob === null) return null;
    if (blob.deleted) return { version: blob.version, record: null };
    const value = await decryptRecord(this.key, blob.bytes, context(id, blob.version));
    const record = parseEnvelope(value, id);
    this.observe(record.modifiedAt);
    return { version: blob.version, record };
  }

  private async pull(result: SyncResult): Promise<void> {
    let cursor = await this.store.getCursor();
    for (;;) {
      const page = await this.api.changes(cursor, this.pageSize);
      for (const change of page.changes) {
        const known = await this.store.get(change.id);
        // Our own uploads, or something we already merged.
        if (known !== undefined && change.version <= known.version) continue;
        try {
          const remote = change.deleted
            ? { version: change.version, record: null }
            : await this.fetchRemote(change.id);
          if (remote !== null) await this.merge(remote, change.id, result);
        } catch (error) {
          if (!isVaultError(error)) throw error;
          result.failed.push(change.id);
        }
      }
      cursor = page.cursor;
      await this.store.setCursor(cursor);
      if (!page.more) break;
    }
  }

  /** Applies a downloaded copy under last-writer-wins. Returns true when the remote copy won. */
  private merge(remote: Remote, id: string, result: SyncResult): Promise<boolean> {
    return this.exclusive(async () => {
      const local = await this.store.get(id);
      if (local !== undefined && remote.version <= local.version) return false;
      let incoming = remote.record;
      if (incoming === null) {
        // A deletion marker without content: it loses to any local change still waiting.
        if (local === undefined || local.pending || local.record.deleted) {
          if (local !== undefined) await this.store.put({ ...local, version: remote.version });
          return false;
        }
        incoming = { ...local.record, data: null, deleted: true };
      }
      if (local?.pending) {
        result.conflicts += 1;
        if (!wins(incoming, local.record)) {
          // Keep the local change; it is uploaded on top of the newer version.
          await this.store.put({ ...local, version: remote.version });
          return false;
        }
      }
      await this.store.put({ record: incoming, version: remote.version, pending: false });
      result.pulled += 1;
      await this.onRemoteChange?.(incoming);
      return true;
    });
  }

  private async push(result: SyncResult): Promise<void> {
    for (const entry of await this.store.pending()) await this.pushOne(entry.record.id, result);
  }

  private async pushOne(id: string, result: SyncResult): Promise<void> {
    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
      const entry: StoredRecord | undefined = await this.store.get(id);
      if (entry === undefined || !entry.pending) return;
      const version = entry.version + 1;
      const sealed = await encryptRecord(this.key, envelope(entry.record), context(id, version));
      try {
        const saved = await this.api.putBlob(id, sealed, entry.version);
        const done = await this.exclusive(async () => {
          const current = await this.store.get(id);
          if (current === undefined) return true;
          // A local edit made during the upload stays pending, now based on the new version.
          const same =
            current.record.modifiedAt === entry.record.modifiedAt &&
            current.record.deviceId === entry.record.deviceId;
          await this.store.put({ record: current.record, version: saved.version, pending: !same });
          return same;
        });
        result.pushed += 1;
        if (done) return;
      } catch (error) {
        if (!(error instanceof VersionConflictError)) throw error;
        let remote: Remote | null;
        try {
          remote = await this.fetchRemote(id);
        } catch (fetchError) {
          if (!isVaultError(fetchError)) throw fetchError;
          // The newer copy cannot be read, so last-writer-wins cannot be decided; keep ours.
          result.failed.push(id);
          return;
        }
        if (remote === null) {
          // The conflict came from a record that has since vanished; rebase on what we were told.
          await this.exclusive(async () => {
            const current = await this.store.get(id);
            if (current !== undefined) {
              await this.store.put({ ...current, version: error.current.version });
            }
          });
          continue;
        }
        if (await this.merge(remote, id, result)) return;
      }
    }
    // Still conflicting after several rounds (another device is busy); try again next sync.
  }
}
