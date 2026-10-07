import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../src/bytes';
import { DEFAULT_KDF_PARAMS } from '../src/kdf';
import { decryptRecord, encryptRecord } from '../src/record';
import {
  changePassphrase,
  createVault,
  parseKeyBundle,
  replaceRecoveryCode,
  sameKey,
  unlockVault,
  type KeyBundle,
} from '../src/vault';
import { TEST_KDF, flip, testVaultOptions } from './helpers';

const PASS = 'correct horse battery staple';

function tamper(bundle: KeyBundle, path: 'passphrase' | 'recovery', field: 'wrappedKey' | 'iv') {
  const slot = bundle[path]!;
  const bytes = flip(fromBase64Url(slot[field]), 0);
  return { ...bundle, [path]: { ...slot, [field]: toBase64Url(bytes) } };
}

describe('createVault / unlockVault', () => {
  it('unlocks with the passphrase and yields the same key', async () => {
    const { vault, recoveryCode } = await createVault(PASS, testVaultOptions);
    expect(recoveryCode).not.toBeNull();
    const reopened = await unlockVault(vault.bundle, { passphrase: PASS });
    expect(await sameKey(vault.key, reopened.key)).toBe(true);
    // And the key actually decrypts what the original encrypted.
    const blob = await encryptRecord(vault.key, { hello: 'world' }, 'ctx');
    expect(await decryptRecord(reopened.key, blob, 'ctx')).toEqual({ hello: 'world' });
  });

  it('survives a JSON round trip, as it would through the server or a file', async () => {
    const { vault } = await createVault(PASS, testVaultOptions);
    const stored: unknown = JSON.parse(JSON.stringify(vault.bundle));
    const reopened = await unlockVault(stored, { passphrase: PASS });
    expect(await sameKey(vault.key, reopened.key)).toBe(true);
  });

  it('fails with wrong-secret for a wrong passphrase', async () => {
    const { vault } = await createVault(PASS, testVaultOptions);
    await expect(
      unlockVault(vault.bundle, { passphrase: 'correct horse battery stapler' }),
    ).rejects.toMatchObject({
      code: 'wrong-secret',
    });
  });

  it('normalises the passphrase, so composed and decomposed accents both work', async () => {
    const { vault } = await createVault('Grüße aus Köln', testVaultOptions);
    const reopened = await unlockVault(vault.bundle, {
      passphrase: 'Grüße aus Köln',
    });
    expect(await sameKey(vault.key, reopened.key)).toBe(true);
  });

  it('unlocks with the recovery code', async () => {
    const { vault, recoveryCode } = await createVault(PASS, testVaultOptions);
    const reopened = await unlockVault(vault.bundle, {
      recoveryCode: recoveryCode!.toLowerCase().replaceAll('-', ' '),
    });
    expect(await sameKey(vault.key, reopened.key)).toBe(true);
  });

  it('rejects another library’s recovery code and mistyped codes', async () => {
    const a = await createVault(PASS, testVaultOptions);
    const b = await createVault(PASS, testVaultOptions);
    await expect(
      unlockVault(a.vault.bundle, { recoveryCode: b.recoveryCode! }),
    ).rejects.toMatchObject({ code: 'wrong-secret' });
    const typo = `${a.recoveryCode!.slice(0, -1)}${a.recoveryCode!.endsWith('0') ? '1' : '0'}`;
    await expect(unlockVault(a.vault.bundle, { recoveryCode: typo })).rejects.toMatchObject({
      code: 'invalid-recovery-code',
    });
  });

  it('can be created without a recovery code', async () => {
    const { vault, recoveryCode } = await createVault(PASS, {
      ...testVaultOptions,
      recoveryCode: false,
    });
    expect(recoveryCode).toBeNull();
    expect(vault.bundle.recovery).toBeNull();
    const other = await createVault(PASS, testVaultOptions);
    await expect(
      unlockVault(vault.bundle, { recoveryCode: other.recoveryCode! }),
    ).rejects.toMatchObject({ code: 'wrong-secret' });
  });

  it('detects a tampered wrapped key, IV or key id', async () => {
    const { vault, recoveryCode } = await createVault(PASS, testVaultOptions);
    for (const field of ['wrappedKey', 'iv'] as const) {
      await expect(
        unlockVault(tamper(vault.bundle, 'passphrase', field), { passphrase: PASS }),
      ).rejects.toMatchObject({ code: 'wrong-secret' });
      await expect(
        unlockVault(tamper(vault.bundle, 'recovery', field), { recoveryCode: recoveryCode! }),
      ).rejects.toMatchObject({ code: 'wrong-secret' });
    }
    const otherId = { ...vault.bundle, keyId: toBase64Url(new Uint8Array(16)) };
    await expect(unlockVault(otherId, { passphrase: PASS })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
    // Changing the KDF parameters derives a different wrapping key.
    const otherKdf = {
      ...vault.bundle,
      passphrase: { ...vault.bundle.passphrase, kdf: { ...TEST_KDF, iterations: 2 } },
    };
    await expect(unlockVault(otherKdf, { passphrase: PASS })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
  });

  it('can hand out a non-extractable key', async () => {
    const { vault } = await createVault(PASS, testVaultOptions);
    const reopened = await unlockVault(vault.bundle, { passphrase: PASS }, { extractable: false });
    expect(reopened.key.extractable).toBe(false);
  });

  it('refuses weak passphrases and weak KDF parameters', async () => {
    await expect(createVault('1234567', testVaultOptions)).rejects.toMatchObject({
      code: 'weak-passphrase',
    });
    await expect(createVault(PASS, { kdf: TEST_KDF })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('works end to end with the default (production) parameters', async () => {
    const { vault, recoveryCode } = await createVault(PASS);
    expect(vault.bundle.passphrase.kdf).toEqual(DEFAULT_KDF_PARAMS);
    const a = await unlockVault(vault.bundle, { passphrase: PASS });
    const b = await unlockVault(vault.bundle, { recoveryCode: recoveryCode! });
    expect(await sameKey(a.key, b.key)).toBe(true);
  });
});

describe('changing secrets', () => {
  it('changes the passphrase and keeps the recovery code working', async () => {
    const { vault, recoveryCode } = await createVault(PASS, testVaultOptions);
    const changed = await changePassphrase(vault, 'a brand new passphrase', testVaultOptions);
    expect(changed.bundle.keyId).toBe(vault.bundle.keyId);
    await expect(unlockVault(changed.bundle, { passphrase: PASS })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
    const viaNew = await unlockVault(changed.bundle, { passphrase: 'a brand new passphrase' });
    const viaCode = await unlockVault(changed.bundle, { recoveryCode: recoveryCode! });
    expect(await sameKey(viaNew.key, vault.key)).toBe(true);
    expect(await sameKey(viaCode.key, vault.key)).toBe(true);
  });

  it('replaces the recovery code; the old one stops working', async () => {
    const { vault, recoveryCode: oldCode } = await createVault(PASS, testVaultOptions);
    const { vault: next, recoveryCode } = await replaceRecoveryCode(vault);
    expect(recoveryCode).not.toBe(oldCode);
    await expect(unlockVault(next.bundle, { recoveryCode: oldCode! })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
    const reopened = await unlockVault(next.bundle, { recoveryCode });
    expect(await sameKey(reopened.key, vault.key)).toBe(true);
  });
});

describe('parseKeyBundle', () => {
  it('rejects malformed bundles and newer versions', async () => {
    const { vault } = await createVault(PASS, testVaultOptions);
    expect(() => parseKeyBundle(null)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(() => parseKeyBundle({ ...vault.bundle, format: 'x' })).toThrow(
      expect.objectContaining({ code: 'corrupt' }),
    );
    expect(() => parseKeyBundle({ ...vault.bundle, version: 2 })).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
    expect(() =>
      parseKeyBundle({
        ...vault.bundle,
        passphrase: { ...vault.bundle.passphrase, wrappedKey: 'not base64!' },
      }),
    ).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(() =>
      parseKeyBundle({
        ...vault.bundle,
        passphrase: { ...vault.bundle.passphrase, kdf: { ...TEST_KDF, memoryKiB: 1 << 30 } },
      }),
    ).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });

  it('drops unknown fields', async () => {
    const { vault } = await createVault(PASS, testVaultOptions);
    const parsed = parseKeyBundle({ ...vault.bundle, comment: 'hello' });
    expect(parsed).toEqual(vault.bundle);
  });
});
