// The encrypted backup file (P2-13, spec §10 "Backup file"): one .zip the user keeps.
//
//   manifest.json        plaintext: format version, creation time, the key bundle (KDF params,
//                        salts, wrapped keys). Nothing about the library itself.
//   README.txt           plaintext: one paragraph saying what the file is.
//   index.otr            encrypted: the list of entries and what each holds.
//   progress.otr         encrypted
//   settings.otr         encrypted
//   library/000001.otr   encrypted, one per library item (titles and file names included)
//
// Every encrypted entry is bound to this backup's id and its own path, and the encrypted index
// lists every entry, so entries cannot be dropped, swapped or mixed in from another backup without
// the import failing. The only export is the user's own encrypted file (AGENTS.md hard rule 1).
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { randomBytes, toBase64Url, utf8Decode, utf8Encode, type Bytes } from './bytes';
import { VaultError } from './errors';
import { decryptRecord, encryptRecord } from './record';
import { parseKeyBundle, unlockVault, type KeyBundle, type Vault, type VaultSecret } from './vault';

export const BACKUP_FORMAT = 'opentiles-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MIME_TYPE = 'application/zip';

const MANIFEST = 'manifest.json';
const README = 'README.txt';
const INDEX = 'index.otr';
const PROGRESS = 'progress.otr';
const SETTINGS = 'settings.otr';
const LIBRARY_PATH = /^library\/\d{6}\.otr$/;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024;

const README_TEXT =
  'This is an encrypted OpenTiles backup. Everything except this note and manifest.json is ' +
  'encrypted on your device. To restore it, open OpenTiles and choose Restore backup; you will ' +
  'need your passphrase or your recovery code. Without them nobody, including the OpenTiles ' +
  'project, can read it.\n';

/** What a backup holds. All values are plain data; `Uint8Array`s are kept as bytes. */
export interface BackupData {
  /** Library items: song model, import settings, original file bytes, title, file name. */
  library: unknown[];
  /** Practice progress. */
  progress: unknown;
  /** App settings. */
  settings: unknown;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  backupId: string;
  /** ISO 8601. */
  createdAt: string;
  keys: KeyBundle;
}

type EntryKind = 'progress' | 'settings' | 'library';

interface BackupIndex {
  backupId: string;
  createdAt: string;
  entries: { path: string; kind: EntryKind }[];
}

function context(backupId: string, path: string): string {
  return `backup/${backupId}/${path}`;
}

/** A file name like `opentiles-backup-2026-10-07.zip`. */
export function backupFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `opentiles-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.zip`;
}

/**
 * Builds the encrypted backup file. `vault` is either the sync vault or one created just for
 * backups with `createVault`; its key bundle goes into the manifest so the file can be opened
 * with the passphrase or recovery code on any device.
 */
export async function exportBackup(
  vault: Vault,
  data: BackupData,
  options: { createdAt?: Date } = {},
): Promise<Bytes> {
  if (!Array.isArray(data.library)) {
    throw new VaultError('invalid-argument', 'The library must be an array');
  }
  const backupId = toBase64Url(randomBytes(16));
  const createdAt = (options.createdAt ?? new Date()).toISOString();
  const files: Zippable = {};
  const entries: BackupIndex['entries'] = [];
  const add = async (path: string, kind: EntryKind, value: unknown) => {
    files[path] = [await encryptRecord(vault.key, value, context(backupId, path)), { level: 0 }];
    entries.push({ path, kind });
  };

  await add(PROGRESS, 'progress', data.progress ?? null);
  await add(SETTINGS, 'settings', data.settings ?? null);
  for (let i = 0; i < data.library.length; i++) {
    await add(`library/${String(i + 1).padStart(6, '0')}.otr`, 'library', data.library[i] ?? null);
  }
  const index: BackupIndex = { backupId, createdAt, entries };
  files[INDEX] = [await encryptRecord(vault.key, index, context(backupId, INDEX)), { level: 0 }];

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId,
    createdAt,
    keys: vault.bundle,
  };
  files[MANIFEST] = [utf8Encode(JSON.stringify(manifest, null, 2)), { level: 6 }];
  files[README] = [utf8Encode(README_TEXT), { level: 6 }];
  // A fixed timestamp keeps the zip from carrying the device clock at a finer grain than the
  // manifest already does.
  return zipSync(files, { mtime: new Date(Date.UTC(2000, 0, 1)) });
}

function unzip(file: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(file, {
      filter: (f) => {
        const known =
          f.name === MANIFEST ||
          f.name === INDEX ||
          f.name === PROGRESS ||
          f.name === SETTINGS ||
          LIBRARY_PATH.test(f.name);
        const limit = f.name === MANIFEST ? MAX_MANIFEST_BYTES : MAX_ENTRY_BYTES;
        if (known && f.originalSize > limit) throw new VaultError('corrupt', 'Entry too large');
        return known;
      },
    });
  } catch (cause) {
    if (cause instanceof VaultError) throw cause;
    throw new VaultError('corrupt', 'This is not a readable backup file', { cause });
  }
}

function parseManifest(bytes: Uint8Array | undefined): BackupManifest {
  if (bytes === undefined) throw new VaultError('corrupt', 'This is not an OpenTiles backup');
  let value: unknown;
  try {
    value = JSON.parse(utf8Decode(bytes));
  } catch (cause) {
    throw new VaultError('corrupt', 'The backup manifest is damaged', { cause });
  }
  if (typeof value !== 'object' || value === null) {
    throw new VaultError('corrupt', 'The backup manifest is damaged');
  }
  const m = value as Record<string, unknown>;
  if (m.format !== BACKUP_FORMAT)
    throw new VaultError('corrupt', 'This is not an OpenTiles backup');
  if (m.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new VaultError('unsupported', 'This backup was made by a newer version of OpenTiles');
  }
  if (typeof m.backupId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(m.backupId)) {
    throw new VaultError('corrupt', 'The backup manifest is damaged');
  }
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) {
    throw new VaultError('corrupt', 'The backup manifest is damaged');
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: m.backupId,
    createdAt: m.createdAt,
    keys: parseKeyBundle(m.keys),
  };
}

/**
 * Reads the plaintext manifest without any secret, so the UI can say when the backup was made
 * and whether the current device already holds its key (`manifest.keys.keyId`). The creation
 * time here is unauthenticated; `importBackup` returns the authenticated one.
 */
export function readBackupManifest(file: Uint8Array): BackupManifest {
  return parseManifest(unzip(file)[MANIFEST]);
}

function parseIndex(value: unknown, backupId: string): BackupIndex {
  const bad = () => new VaultError('corrupt', 'The backup index is damaged');
  if (typeof value !== 'object' || value === null) throw bad();
  const v = value as Record<string, unknown>;
  if (v.backupId !== backupId || typeof v.createdAt !== 'string' || !Array.isArray(v.entries)) {
    throw bad();
  }
  const entries: BackupIndex['entries'] = [];
  for (const e of v.entries as unknown[]) {
    if (typeof e !== 'object' || e === null) throw bad();
    const { path, kind } = e as Record<string, unknown>;
    if (typeof path !== 'string') throw bad();
    if (kind === 'progress' && path === PROGRESS) entries.push({ path, kind });
    else if (kind === 'settings' && path === SETTINGS) entries.push({ path, kind });
    else if (kind === 'library' && LIBRARY_PATH.test(path)) entries.push({ path, kind });
    else throw bad();
  }
  return { backupId, createdAt: v.createdAt, entries };
}

async function decryptFiles(
  files: Record<string, Uint8Array>,
  manifest: BackupManifest,
  key: CryptoKey,
): Promise<{ data: BackupData; manifest: BackupManifest }> {
  const indexBlob = files[INDEX];
  if (indexBlob === undefined) throw new VaultError('corrupt', 'The backup index is missing');
  const index = parseIndex(
    await decryptRecord(key, indexBlob, context(manifest.backupId, INDEX)),
    manifest.backupId,
  );

  const listed = new Set(index.entries.map((e) => e.path));
  if (listed.size !== index.entries.length) {
    throw new VaultError('corrupt', 'The backup index is damaged');
  }
  for (const name of Object.keys(files)) {
    if (name !== MANIFEST && name !== INDEX && !listed.has(name)) {
      throw new VaultError('corrupt', 'The backup contains entries it does not list');
    }
  }

  const data: BackupData = { library: [], progress: null, settings: null };
  for (const entry of index.entries) {
    const blob = files[entry.path];
    if (blob === undefined) throw new VaultError('corrupt', 'Part of the backup is missing');
    const value = await decryptRecord(key, blob, context(manifest.backupId, entry.path));
    if (entry.kind === 'library') data.library.push(value);
    else data[entry.kind] = value;
  }
  return { data, manifest: { ...manifest, createdAt: index.createdAt } };
}

/** Decrypts a backup with a key the device already holds (for example the sync vault). */
export async function importBackupWithKey(
  file: Uint8Array,
  key: CryptoKey,
): Promise<{ data: BackupData; manifest: BackupManifest }> {
  const files = unzip(file);
  return decryptFiles(files, parseManifest(files[MANIFEST]), key);
}

/** Unlocks a backup with the passphrase or recovery code and decrypts it. */
export async function importBackup(
  file: Uint8Array,
  secret: VaultSecret,
): Promise<{ data: BackupData; manifest: BackupManifest; vault: Vault }> {
  const files = unzip(file);
  const manifest = parseManifest(files[MANIFEST]);
  const vault = await unlockVault(manifest.keys, secret);
  return { ...(await decryptFiles(files, manifest, vault.key)), vault };
}
