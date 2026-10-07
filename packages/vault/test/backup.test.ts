import { strFromU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  backupFileName,
  exportBackup,
  importBackup,
  importBackupWithKey,
  readBackupManifest,
  type BackupData,
} from '../src/backup';
import { utf8Encode } from '../src/bytes';
import { createVault } from '../src/vault';
import { contains, flip, testVaultOptions } from './helpers';

const PASS = 'a long backup passphrase';

// Self-made test data; nothing here is a real score.
function sampleData(): BackupData {
  return {
    library: [
      {
        title: 'My Own Little Etude',
        fileName: 'little-etude.mid',
        format: 'midi',
        bytes: new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 2, 1, 0xe0]),
        song: { title: 'My Own Little Etude', notes: [{ pitch: 60, startBeat: 0 }] },
        settings: { transpose: 0, swapHands: false },
        tags: ['mine'],
        addedAt: 1_790_000_000_000,
      },
      {
        title: 'Second Sketch',
        fileName: 'second-sketch.musicxml',
        format: 'musicxml',
        bytes: utf8Encode('<score-partwise version="4.0"></score-partwise>'),
        song: { title: 'Second Sketch', notes: [] },
        settings: { transpose: -2, swapHands: true, baseBpm: 90 },
        tags: [],
        addedAt: 1_790_000_100_000,
      },
    ],
    progress: {
      records: [{ key: 'library:1', bestAccuracy: 0.92, runs: 4 }],
      days: [{ day: '2026-10-06', seconds: 600 }],
    },
    settings: [{ key: 'theme', value: 'dark' }],
  };
}

async function makeBackup(data = sampleData()) {
  const { vault, recoveryCode } = await createVault(PASS, testVaultOptions);
  const file = await exportBackup(vault, data, { createdAt: new Date('2026-10-07T10:00:00Z') });
  return { vault, recoveryCode: recoveryCode!, file, data };
}

/** Rewrites the zip with `edit` applied to its entries. */
function rezip(file: Uint8Array, edit: (files: Record<string, Uint8Array>) => void): Uint8Array {
  const files = unzipSync(file);
  edit(files);
  const z: Zippable = {};
  for (const [k, v] of Object.entries(files)) z[k] = v;
  return zipSync(z);
}

describe('backup round trip', () => {
  it('restores everything with the passphrase', async () => {
    const { file, data } = await makeBackup();
    const restored = await importBackup(file, { passphrase: PASS });
    expect(restored.data).toEqual(data);
    expect(restored.manifest.createdAt).toBe('2026-10-07T10:00:00.000Z');
  });

  it('restores with the recovery code', async () => {
    const { file, data, recoveryCode } = await makeBackup();
    const restored = await importBackup(file, { recoveryCode });
    expect(restored.data).toEqual(data);
  });

  it('restores with a key the device already holds', async () => {
    const { file, data, vault } = await makeBackup();
    expect(readBackupManifest(file).keys.keyId).toBe(vault.bundle.keyId);
    const restored = await importBackupWithKey(file, vault.key);
    expect(restored.data).toEqual(data);
  });

  it('handles an empty library', async () => {
    const { file } = await makeBackup({ library: [], progress: null, settings: {} });
    const restored = await importBackup(file, { passphrase: PASS });
    expect(restored.data).toEqual({ library: [], progress: null, settings: {} });
  });

  it('suggests a dated file name', () => {
    expect(backupFileName(new Date(2026, 9, 7))).toBe('opentiles-backup-2026-10-07.zip');
  });
});

describe('what the file reveals', () => {
  it('has a plaintext manifest with no titles, file names or contents', async () => {
    const { file } = await makeBackup();
    const files = unzipSync(file);
    expect(Object.keys(files).sort()).toEqual([
      'README.txt',
      'index.otr',
      'library/000001.otr',
      'library/000002.otr',
      'manifest.json',
      'progress.otr',
      'settings.otr',
    ]);
    const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as Record<string, unknown>;
    expect(manifest.format).toBe('opentiles-backup');
    expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(Object.keys(manifest).sort()).toEqual([
      'backupId',
      'createdAt',
      'format',
      'formatVersion',
      'keys',
    ]);
    for (const secret of ['My Own Little Etude', 'little-etude.mid', 'Second Sketch', 'theme']) {
      expect(contains(file, utf8Encode(secret)), secret).toBe(false);
    }
  });
});

describe('failures', () => {
  it('rejects a wrong passphrase or another library’s recovery code', async () => {
    const { file } = await makeBackup();
    await expect(importBackup(file, { passphrase: 'not the passphrase' })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
    const other = await makeBackup();
    await expect(importBackup(file, { recoveryCode: other.recoveryCode })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
    await expect(importBackupWithKey(file, other.vault.key)).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('detects a modified entry', async () => {
    const { file } = await makeBackup();
    const bad = rezip(file, (f) => {
      f['library/000002.otr'] = flip(f['library/000002.otr']!, 30);
    });
    await expect(importBackup(bad, { passphrase: PASS })).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('detects a removed entry', async () => {
    const { file } = await makeBackup();
    const bad = rezip(file, (f) => {
      delete f['library/000001.otr'];
    });
    await expect(importBackup(bad, { passphrase: PASS })).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('detects swapped entries', async () => {
    const { file } = await makeBackup();
    const bad = rezip(file, (f) => {
      const a = f['library/000001.otr']!;
      f['library/000001.otr'] = f['library/000002.otr']!;
      f['library/000002.otr'] = a;
    });
    await expect(importBackup(bad, { passphrase: PASS })).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('detects an entry added from another backup made with the same key', async () => {
    const { file, vault } = await makeBackup();
    const second = await exportBackup(vault, {
      library: [{ title: 'x' }, { title: 'y' }, { title: 'z' }],
      progress: null,
      settings: null,
    });
    const bad = rezip(file, (f) => {
      f['library/000003.otr'] = unzipSync(second)['library/000003.otr']!;
    });
    await expect(importBackupWithKey(bad, vault.key)).rejects.toMatchObject({ code: 'corrupt' });
    const swapped = rezip(file, (f) => {
      f['library/000001.otr'] = unzipSync(second)['library/000001.otr']!;
    });
    await expect(importBackupWithKey(swapped, vault.key)).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('detects an edited manifest', async () => {
    const { file } = await makeBackup();
    const bad = rezip(file, (f) => {
      const m = JSON.parse(strFromU8(f['manifest.json']!)) as Record<string, unknown>;
      m.backupId = 'AAAAAAAAAAAAAAAAAAAAAA';
      f['manifest.json'] = utf8Encode(JSON.stringify(m));
    });
    await expect(importBackup(bad, { passphrase: PASS })).rejects.toMatchObject({
      code: 'corrupt',
    });
  });

  it('says when a backup comes from a newer version', async () => {
    const { file } = await makeBackup();
    const newer = rezip(file, (f) => {
      const m = JSON.parse(strFromU8(f['manifest.json']!)) as Record<string, unknown>;
      m.formatVersion = 99;
      f['manifest.json'] = utf8Encode(JSON.stringify(m));
    });
    expect(() => readBackupManifest(newer)).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });

  it('rejects files that are not backups', async () => {
    expect(() => readBackupManifest(utf8Encode('hello'))).toThrow(
      expect.objectContaining({ code: 'corrupt' }),
    );
    const otherZip = zipSync({ 'notes.txt': utf8Encode('hi') });
    expect(() => readBackupManifest(otherZip)).toThrow(
      expect.objectContaining({ code: 'corrupt' }),
    );
  });
});
