import { createVault, utf8Encode, type KeyBundle } from '@opentiles/vault';
import { describe, expect, it } from 'vitest';
import { buildCrashReport, scrubText } from '../src/crash';
import { SyncApiError, VaultExistsError, VersionConflictError } from '../src/errors';
import {
  changeRemotePassphrase,
  createRemoteVault,
  hasRemoteVault,
  replaceRemoteRecoveryCode,
  unlockRemoteVault,
} from '../src/vault-setup';
import { inProcessServer, weakKdf } from './helpers';

const PASS = 'a sync passphrase for tests';

describe('sign-in', () => {
  it('signs in with the email link or the typed code', async () => {
    const server = inProcessServer();
    const api = server.api();
    await api.startEmailSignIn('typed@example.org');
    const code = /code in the app: (\d{4}-\d{4})/.exec(server.mailer.sent[0]!.text)![1]!;
    const session = await api.finishEmailSignIn({ email: 'typed@example.org', code });
    expect(session.created).toBe(true);
    expect(api.token).toBe(session.token);
    expect((await api.account()).email).toBe('typed@example.org');
  });

  it('turns error answers into typed errors and forgets a rejected token', async () => {
    const server = inProcessServer();
    const api = server.api();
    await expect(api.account()).rejects.toMatchObject({ status: 401, code: 'unauthorised' });
    api.setToken('A'.repeat(43));
    await expect(api.account()).rejects.toBeInstanceOf(SyncApiError);
    expect(api.token).toBeNull();
    await expect(api.finishEmailSignIn({ token: 'B'.repeat(43) })).rejects.toMatchObject({
      code: 'invalid-link',
    });
  });

  it('hands out passkey options for the browser', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    const reg = await api.passkeyRegistrationOptions();
    expect(reg.challengeId).toMatch(/^[\w-]+$/);
    expect(reg.options).toMatchObject({ rp: { id: 'app.opentiles.test' } });
    const login = await server.api().passkeyLoginOptions();
    expect(typeof login.options.challenge).toBe('string');
  });

  it('signs out', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    const token = api.token!;
    await api.signOut();
    expect(api.token).toBeNull();
    api.setToken(token);
    await expect(api.account()).rejects.toMatchObject({ status: 401 });
  });
});

describe('ciphertext only', () => {
  it('refuses to upload bytes that are not a sealed record', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    await expect(api.putBlob('record-plain-00000', utf8Encode('My Song Title'), 0)).rejects.toThrow(
      /not an encrypted/,
    );
    expect(server.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });

  it('refuses to upload anything but a wrapped key bundle', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    await expect(
      api.putKeyBundle({ raw: 'key material' } as unknown as KeyBundle, 0),
    ).rejects.toMatchObject({ code: 'corrupt' });
  });
});

describe('remote vault', () => {
  it('creates once, unlocks elsewhere, and refuses a second creation', async () => {
    const server = inProcessServer();
    const a = await server.signedIn();
    expect(await hasRemoteVault(a)).toBe(false);
    expect(await unlockRemoteVault(a, { passphrase: PASS })).toBeNull();
    const created = await createRemoteVault(a, PASS, weakKdf);
    expect(created.version).toBe(1);
    expect(created.recoveryCode).toMatch(/^(\w{4}-){8}\w{4}$/);

    const b = await server.signedIn();
    expect(await hasRemoteVault(b)).toBe(true);
    await expect(createRemoteVault(b, PASS, weakKdf)).rejects.toBeInstanceOf(VaultExistsError);
    await expect(unlockRemoteVault(b, { passphrase: 'not the passphrase' })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
    const viaCode = await unlockRemoteVault(b, { recoveryCode: created.recoveryCode! });
    expect(viaCode!.vault.bundle.keyId).toBe(created.vault.bundle.keyId);
  });

  it('changes the passphrase and the recovery code for every device', async () => {
    const server = inProcessServer();
    const a = await server.signedIn();
    const created = await createRemoteVault(a, PASS, weakKdf);
    const changed = await changeRemotePassphrase(
      a,
      created,
      'a completely new passphrase',
      weakKdf,
    );
    expect(changed.version).toBe(2);

    const b = await server.signedIn();
    await expect(unlockRemoteVault(b, { passphrase: PASS })).rejects.toMatchObject({
      code: 'wrong-secret',
    });
    expect(
      await unlockRemoteVault(b, { passphrase: 'a completely new passphrase' }),
    ).not.toBeNull();

    const replaced = await replaceRemoteRecoveryCode(a, changed);
    await expect(
      unlockRemoteVault(b, { recoveryCode: created.recoveryCode! }),
    ).rejects.toMatchObject({ code: 'wrong-secret' });
    expect(await unlockRemoteVault(b, { recoveryCode: replaced.recoveryCode })).not.toBeNull();

    // A device holding an old version cannot overwrite the newer bundle.
    await expect(
      changeRemotePassphrase(b, created, 'stale device passphrase', weakKdf),
    ).rejects.toBeInstanceOf(VersionConflictError);
  });
});

describe('account deletion', () => {
  it('removes the account and all its blobs in one call', async () => {
    const server = inProcessServer();
    const api = await server.signedIn();
    const { vault } = await createVault(PASS, weakKdf);
    await api.putKeyBundle(vault.bundle, 0);
    const { encryptRecord } = await import('@opentiles/vault');
    for (let i = 0; i < 3; i++) {
      const id = `record-${i}-000000000000`;
      await api.putBlob(id, await encryptRecord(vault.key, { i }, `sync/${id}/1`), 0);
    }
    expect(server.blobs.keys()).toHaveLength(3);
    await api.deleteAccount();
    expect(api.token).toBeNull();
    expect(server.blobs.keys()).toHaveLength(0);
    expect(server.db.counts()).toMatchObject({ users: 0, blobs: 0, key_bundles: 0 });
  });
});

describe('crash reports', () => {
  it('builds a scrubbed report and the server stores it anonymously', async () => {
    const server = inProcessServer();
    const api = server.api();
    const error = new TypeError('Upload failed for someone@example.org (token=abc123)');
    const report = buildCrashReport(error, {
      app: 'web',
      version: '1.0.0',
      platform: 'iPadOS 18 / Safari',
      context: { input: 'midi' },
    });
    expect(report.message).toBe('TypeError: Upload failed for [email] (token=[removed])');
    await api.sendCrashReport(report);
    const stored = server.db.listCrashReports();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.report).not.toContain('someone@example.org');
  });

  it('scrubText leaves normal messages alone', () => {
    expect(scrubText('Cannot read properties of undefined')).toBe(
      'Cannot read properties of undefined',
    );
  });
});
