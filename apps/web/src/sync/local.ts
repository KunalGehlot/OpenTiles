// Optional encrypted sync (P3-03): connects the local IndexedDB library to @opentiles/sync-client.
//
// Everything is encrypted on this device before upload. Each library item, progress entry,
// practice day and the portable settings become one sealed record. Library records get random ids;
// progress, days and settings get ids from an HMAC under a key derived from the library key, so
// two devices map the same piece's progress to the same record, while the server learns nothing
// from the id. Sync state (session, unlocked key, record copies) lives in its own IndexedDB
// database, `opentiles-sync`, which is never part of a backup.
import Dexie from 'dexie';
import type { Table } from 'dexie';
import {
  SyncEngine,
  createRemoteVault,
  createSyncApi,
  hasRemoteVault,
  newDeviceId,
  newRecordId,
  unlockRemoteVault,
  type SyncApi,
  type SyncRecord,
  type SyncResult,
  type SyncStore,
  type StoredRecord,
} from '@opentiles/sync-client';
import {
  toBase64Url,
  utf8Encode,
  type Argon2idParams,
  type KeyBundle,
  type VaultSecret,
} from '@opentiles/vault';
import type { Song } from '@opentiles/song-model';
import { asSheetAttachment, isDeviceSetting } from '../backup/backup';
import { reloadAppSettings } from '../settings/store';
import { createPasskey, getPasskey } from './webauthn';
import { db } from '../storage/db';
import type { DayStat, LibraryItem, Progress, Setting } from '../storage/db';

interface MetaRow {
  key: string;
  value: unknown;
}

interface LinkRow {
  /** `library:<local id>` */
  localKey: string;
  recordId: string;
  /** Cheap fingerprint of what was last synced, to spot local edits. */
  signature: string;
}

class SyncDb extends Dexie {
  records!: Table<StoredRecord, string>;
  meta!: Table<MetaRow, string>;
  links!: Table<LinkRow, string>;

  constructor() {
    super('opentiles-sync');
    this.version(1).stores({
      records: 'record.id',
      meta: 'key',
      links: 'localKey, &recordId',
    });
  }
}

export const syncDb = new SyncDb();

class IndexedDbSyncStore implements SyncStore {
  async get(id: string) {
    return syncDb.records.get(id);
  }
  async put(entry: StoredRecord) {
    await syncDb.records.put(entry);
  }
  async pending() {
    return syncDb.records.filter((e) => e.pending).toArray();
  }
  async getCursor() {
    return ((await syncDb.meta.get('cursor'))?.value as number | undefined) ?? 0;
  }
  async setCursor(cursor: number) {
    await syncDb.meta.put({ key: 'cursor', value: cursor });
  }
}

interface StoredSession {
  token: string;
  expiresAt: string;
  email: string | null;
}

interface StoredVault {
  key: CryptoKey;
  bundle: KeyBundle;
  version: number;
}

export interface LastSync {
  at: number;
  result?: SyncResult;
  error?: string;
}

export type SyncPhase = 'loading' | 'signed-out' | 'needs-vault' | 'ready';

export interface SyncState {
  phase: SyncPhase;
  email: string | null;
  /** Set once the server is asked whether this account already has a library key. */
  accountHasVault: boolean | null;
  auto: boolean;
  busy: boolean;
  lastSync: LastSync | null;
}

async function meta<T>(key: string): Promise<T | undefined> {
  return (await syncDb.meta.get(key))?.value as T | undefined;
}

async function setMeta(key: string, value: unknown): Promise<void> {
  await syncDb.meta.put({ key, value });
}

/** HMAC key for deterministic record ids, derived from the library key. */
async function idKey(libraryKey: CryptoKey): Promise<CryptoKey> {
  const raw = await crypto.subtle.exportKey('raw', libraryKey);
  const ikm = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: utf8Encode('opentiles/sync/record-id/v1'),
    },
    ikm,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

function librarySignature(item: LibraryItem): string {
  const { sheet } = item;
  return JSON.stringify([
    item.title,
    item.fileName,
    item.addedAt,
    item.bytes.length,
    item.settings,
    item.tags,
    // Only pieces with sheet music get the extra entry, so the others keep the signature they had.
    ...(sheet ? [[sheet.fileName, sheet.bytes.length, sheet.addedAt]] : []),
  ]);
}

function sameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function libraryData(item: LibraryItem) {
  const { id: _id, ...rest } = item;
  return rest;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface SyncControllerOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Tests only: cheaper key derivation. */
  kdf?: Argon2idParams;
  unsafeAllowWeakKdf?: boolean;
}

export class SyncController {
  readonly api: SyncApi;
  private readonly options: SyncControllerOptions;
  private readonly store = new IndexedDbSyncStore();
  private engine: SyncEngine | null = null;
  /** Records another device changed, collected during a sync run. */
  private incoming: SyncRecord[] = [];
  private ids: CryptoKey | null = null;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  state: SyncState = {
    phase: 'loading',
    email: null,
    accountHasVault: null,
    auto: false,
    busy: false,
    lastSync: null,
  };

  constructor(options: SyncControllerOptions) {
    this.options = options;
    this.api = createSyncApi({
      baseUrl: options.baseUrl,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): SyncState => this.state;

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private initialised: Promise<void> | null = null;

  /** Restores the session and unlocked key saved on this device. Runs once; later calls wait. */
  init(): Promise<void> {
    this.initialised ??= this.restore();
    return this.initialised;
  }

  private async restore(): Promise<void> {
    const session = await meta<StoredSession>('session');
    const vault = await meta<StoredVault>('vault');
    const auto = (await meta<boolean>('auto')) ?? true;
    const lastSync = (await meta<LastSync>('lastSync')) ?? null;
    if (session && Date.parse(session.expiresAt) > Date.now()) {
      this.api.setToken(session.token);
      if (vault) await this.useKey(vault.key);
      this.set({
        phase: vault ? 'ready' : 'needs-vault',
        email: session.email,
        auto,
        lastSync,
      });
    } else {
      this.set({ phase: 'signed-out', auto, lastSync });
    }
    this.schedule();
  }

  private async deviceId(): Promise<string> {
    let id = await meta<string>('deviceId');
    if (!id) {
      id = newDeviceId();
      await setMeta('deviceId', id);
    }
    return id;
  }

  private async useKey(key: CryptoKey): Promise<void> {
    this.ids = await idKey(key);
    this.engine = new SyncEngine({
      api: this.api,
      key,
      store: this.store,
      deviceId: await this.deviceId(),
      onRemoteChange: (r) => {
        this.incoming.push(r);
      },
    });
  }

  private async afterSignIn(session: { token: string; expiresAt: string }, email: string | null) {
    await setMeta('session', { token: session.token, expiresAt: session.expiresAt, email });
    const exists = await hasRemoteVault(this.api);
    this.set({ phase: 'needs-vault', email, accountHasVault: exists });
  }

  // Sign-in -----------------------------------------------------------------------------------

  async startEmailSignIn(email: string): Promise<void> {
    await this.api.startEmailSignIn(email.trim());
    await setMeta('pendingEmail', email.trim());
  }

  async finishEmailSignIn(proof: { token: string } | { email: string; code: string }) {
    const email =
      'email' in proof ? proof.email.trim() : ((await meta<string>('pendingEmail')) ?? null);
    const session = await this.api.finishEmailSignIn(
      'email' in proof ? { email: proof.email.trim(), code: proof.code.replace(/\D/g, '') } : proof,
    );
    await syncDb.meta.delete('pendingEmail');
    await this.afterSignIn(session, email);
  }

  async signInWithPasskey(): Promise<void> {
    const { challengeId, options } = await this.api.passkeyLoginOptions();
    const session = await this.api.finishPasskeyLogin(challengeId, await getPasskey(options));
    let email: string | null = null;
    try {
      email = (await this.api.account()).email;
    } catch {
      // Not needed to sync.
    }
    await this.afterSignIn(session, email);
  }

  async addPasskey(): Promise<void> {
    const { challengeId, options } = await this.api.passkeyRegistrationOptions();
    await this.api.addPasskey(challengeId, await createPasskey(options));
  }

  // Library key ---------------------------------------------------------------------------------

  /** First device: creates the key. Returns the recovery code, to show once. */
  async createLibraryKey(passphrase: string): Promise<string | null> {
    const { vault, version, recoveryCode } = await createRemoteVault(this.api, passphrase, {
      ...(this.options.kdf ? { kdf: this.options.kdf } : {}),
      ...(this.options.unsafeAllowWeakKdf ? { unsafeAllowWeakKdf: true } : {}),
    });
    await this.saveVault({ key: vault.key, bundle: vault.bundle, version });
    return recoveryCode;
  }

  /** Other devices: unlocks the key with the passphrase or recovery code. */
  async unlock(secret: VaultSecret): Promise<boolean> {
    const remote = await unlockRemoteVault(this.api, secret);
    if (remote === null) {
      this.set({ accountHasVault: false });
      return false;
    }
    await this.saveVault({
      key: remote.vault.key,
      bundle: remote.vault.bundle,
      version: remote.version,
    });
    return true;
  }

  private async saveVault(vault: StoredVault): Promise<void> {
    await setMeta('vault', vault);
    await this.useKey(vault.key);
    this.set({ phase: 'ready', accountHasVault: true });
    this.schedule();
  }

  // Sync ----------------------------------------------------------------------------------------

  private async recordIdFor(name: string): Promise<string> {
    if (!this.ids) throw new Error('Sync is locked');
    const mac = await crypto.subtle.sign('HMAC', this.ids, utf8Encode(name));
    return toBase64Url(new Uint8Array(mac).slice(0, 16));
  }

  /** Turns local changes since the last sync into engine changes. */
  async collectLocalChanges(): Promise<number> {
    const engine = this.engine;
    if (!engine) throw new Error('Sync is locked');
    let changes = 0;

    const items = await db.library.toArray();
    const links = new Map((await syncDb.links.toArray()).map((l) => [l.localKey, l]));
    const live = new Set<string>();
    const libraryRecord = new Map<number, string>();
    for (const item of items) {
      if (item.id === undefined) continue;
      const localKey = `library:${item.id}`;
      live.add(localKey);
      const sig = librarySignature(item);
      const link = links.get(localKey);
      const recordId = link?.recordId ?? newRecordId();
      libraryRecord.set(item.id, recordId);
      if (link?.signature !== sig) {
        await engine.change(recordId, 'library', libraryData(item));
        await syncDb.links.put({ localKey, recordId, signature: sig });
        changes += 1;
      }
    }
    for (const [localKey, link] of links) {
      if (!live.has(localKey)) {
        await engine.remove(link.recordId);
        await syncDb.links.delete(localKey);
        changes += 1;
      }
    }

    const put = async (name: string, kind: string, data: unknown) => {
      const id = await this.recordIdFor(name);
      const existing = await this.store.get(id);
      if (existing && !existing.record.deleted && sameData(existing.record.data, data)) return;
      await engine.change(id, kind, data);
      changes += 1;
    };

    for (const p of await db.progress.toArray()) {
      const m = /^library:(\d+)$/.exec(p.key);
      let key = p.key;
      if (m) {
        const rid = libraryRecord.get(Number(m[1]));
        if (rid === undefined) continue;
        key = `libraryRecord:${rid}`;
      }
      await put(`progress:${key}`, 'progress', { ...p, key });
    }
    for (const d of await db.days.toArray()) await put(`day:${d.day}`, 'day', d);
    const settings = (await db.settings.toArray())
      .filter((s) => !isDeviceSetting(s.key))
      .sort((a, b) => (a.key < b.key ? -1 : 1));
    await put('settings', 'settings', { entries: settings });
    return changes;
  }

  /** Applies records that another device changed. Library items first, so progress can follow. */
  async applyRemote(records: SyncRecord[]): Promise<void> {
    const order = ['library', 'settings', 'day', 'progress'];
    const sorted = [...records].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    for (const r of sorted) {
      if (r.kind === 'library') await this.applyLibrary(r);
      else if (r.deleted || !isObj(r.data)) continue;
      else if (r.kind === 'progress') await this.applyProgress(r.data);
      else if (r.kind === 'day') await this.applyDay(r.data);
      else if (r.kind === 'settings') await this.applySettings(r.data);
    }
  }

  private async applyLibrary(r: SyncRecord): Promise<void> {
    const link = await syncDb.links.where('recordId').equals(r.id).first();
    if (r.deleted) {
      if (link) {
        const id = Number(link.localKey.slice('library:'.length));
        await db.library.delete(id);
        await db.progress.delete(`library:${id}`);
        await syncDb.links.delete(link.localKey);
      }
      return;
    }
    const d = r.data as Record<string, unknown> | null;
    if (!isObj(d) || typeof d.title !== 'string' || !(d.bytes instanceof Uint8Array)) return;
    // The record replaces the local item, sheet music included (ADR 0018).
    const sheet = asSheetAttachment(d.sheet);
    const item: LibraryItem = {
      title: d.title,
      fileName: String(d.fileName ?? ''),
      format: d.format as LibraryItem['format'],
      bytes: d.bytes,
      song: d.song as Song,
      settings: (d.settings ?? { transpose: 0, swapHands: false }) as LibraryItem['settings'],
      tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
      addedAt: typeof d.addedAt === 'number' ? d.addedAt : Date.now(),
      ...(sheet ? { sheet } : {}),
    };
    let id: number;
    if (link) {
      id = Number(link.localKey.slice('library:'.length));
      await db.library.put({ ...item, id });
    } else {
      id = await db.library.add(item);
    }
    await syncDb.links.put({
      localKey: `library:${id}`,
      recordId: r.id,
      signature: librarySignature({ ...item, id }),
    });
  }

  private async applyProgress(data: Record<string, unknown>): Promise<void> {
    if (typeof data.key !== 'string') return;
    let key = data.key;
    const m = /^libraryRecord:(.+)$/.exec(key);
    if (m) {
      const link = await syncDb.links
        .where('recordId')
        .equals(m[1] ?? '')
        .first();
      if (!link) return;
      key = link.localKey;
    } else if (!key.startsWith('catalogue:')) {
      return;
    }
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
    const prev = await db.progress.get(key);
    const next: Progress = {
      key,
      bestAccuracy: Math.max(prev?.bestAccuracy ?? 0, n(data.bestAccuracy)),
      runs: Math.max(prev?.runs ?? 0, n(data.runs)),
      lastPlayedAt: Math.max(prev?.lastPlayedAt ?? 0, n(data.lastPlayedAt)),
      secondsPractised: Math.max(prev?.secondsPractised ?? 0, n(data.secondsPractised)),
    };
    await db.progress.put(next);
  }

  private async applyDay(data: Record<string, unknown>): Promise<void> {
    if (typeof data.day !== 'string' || typeof data.seconds !== 'number') return;
    const prev = await db.days.get(data.day);
    if (!prev || prev.seconds < data.seconds) {
      await db.days.put({ day: data.day, seconds: data.seconds } satisfies DayStat);
    }
  }

  private async applySettings(data: Record<string, unknown>): Promise<void> {
    if (!Array.isArray(data.entries)) return;
    for (const s of data.entries as Setting[]) {
      if (isObj(s) && typeof s.key === 'string' && !isDeviceSetting(s.key)) {
        await db.settings.put({ key: s.key, value: s.value });
      }
    }
    await reloadAppSettings();
  }

  /** Collects local changes, syncs, applies what came back. */
  async syncNow(): Promise<SyncResult> {
    const engine = this.engine;
    if (!engine || this.state.phase !== 'ready') throw new Error('Sync is not set up');
    this.set({ busy: true });
    try {
      // A device that has never synced takes the account's copy first, so its defaults (empty
      // settings, say) do not overwrite real data under last-writer-wins.
      if ((await this.store.getCursor()) > 0) await this.collectLocalChanges();
      this.incoming = [];
      const result = await engine.sync();
      const changed = this.incoming;
      this.incoming = [];
      await this.applyRemote(changed);
      // What was just applied is now the local state. Anything new or merged locally (a better
      // score kept from this device) goes straight back up.
      if ((await this.collectLocalChanges()) > 0) {
        const more = await engine.sync();
        result.pulled += more.pulled;
        result.pushed += more.pushed;
        result.conflicts += more.conflicts;
        result.failed.push(...more.failed);
      }
      const lastSync: LastSync = { at: Date.now(), result };
      await setMeta('lastSync', lastSync);
      this.set({ lastSync });
      return result;
    } catch (error) {
      const lastSync: LastSync = {
        at: Date.now(),
        error: error instanceof Error ? error.message : String(error),
      };
      await setMeta('lastSync', lastSync);
      if (this.api.token === null) await this.forgetSession();
      this.set({ lastSync });
      throw error;
    } finally {
      this.set({ busy: false });
    }
  }

  async setAuto(on: boolean): Promise<void> {
    await setMeta('auto', on);
    this.set({ auto: on });
    this.schedule();
  }

  /** Automatic sync: every five minutes while the app is open, and when it comes back into view. */
  private schedule(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (typeof window === 'undefined' || !this.state.auto || this.state.phase !== 'ready') return;
    const run = () => {
      if (!this.state.busy && navigator.onLine !== false) void this.syncNow().catch(() => {});
    };
    this.timer = setInterval(run, 5 * 60_000);
    run();
  }

  onVisible(): void {
    if (this.state.auto && this.state.phase === 'ready' && !this.state.busy) {
      void this.syncNow().catch(() => {});
    }
  }

  private async forgetSession(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.engine = null;
    this.ids = null;
    // Local copies of synced records go too; the library itself stays on this device.
    await Promise.all([
      syncDb.records.clear(),
      syncDb.links.clear(),
      syncDb.meta.bulkDelete(['session', 'vault', 'cursor', 'lastSync', 'pendingEmail']),
    ]);
    this.set({ phase: 'signed-out', email: null, accountHasVault: null, lastSync: null });
  }

  /** Signs out on this device. The library stays here; the server copy stays too. */
  async signOut(): Promise<void> {
    try {
      await this.api.signOut();
    } catch {
      // Sign out locally even when the server cannot be reached.
    }
    await this.forgetSession();
  }

  /** Deletes the account and everything stored on the server, in one step. */
  async deleteAccount(): Promise<void> {
    await this.api.deleteAccount();
    await this.forgetSession();
  }
}
