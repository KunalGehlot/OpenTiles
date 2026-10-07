// Setting up and unlocking the library key on the server (spec §10, steps 1, 2, 4 and 5). Only the
// wrapped key bundle is uploaded; the passphrase and recovery code never leave the device.
import {
  changePassphrase,
  createVault,
  replaceRecoveryCode,
  unlockVault,
  type CreateVaultOptions,
  type Vault,
  type VaultSecret,
} from '@opentiles/vault';
import type { SyncApi } from './api';
import { VaultExistsError, VersionConflictError } from './errors';

export interface RemoteVault {
  vault: Vault;
  /** Version of the stored bundle, needed to change it later. */
  version: number;
}

/** Whether the account already has a library key (then unlock it rather than create one). */
export async function hasRemoteVault(api: SyncApi): Promise<boolean> {
  return (await api.getKeyBundle()) !== null;
}

/**
 * First device: creates the library key, uploads the wrapped bundle and returns the recovery code
 * to show once. Throws `VaultExistsError` when another device got there first.
 */
export async function createRemoteVault(
  api: SyncApi,
  passphrase: string,
  options?: CreateVaultOptions,
): Promise<RemoteVault & { recoveryCode: string | null }> {
  const { vault, recoveryCode } = await createVault(passphrase, options);
  try {
    const { version } = await api.putKeyBundle(vault.bundle, 0);
    return { vault, version, recoveryCode };
  } catch (error) {
    if (error instanceof VersionConflictError) throw new VaultExistsError();
    throw error;
  }
}

/** Another device: downloads the wrapped bundle and unlocks it locally. Null when none exists. */
export async function unlockRemoteVault(
  api: SyncApi,
  secret: VaultSecret,
): Promise<RemoteVault | null> {
  const stored = await api.getKeyBundle();
  if (stored === null) return null;
  return { vault: await unlockVault(stored.bundle, secret), version: stored.version };
}

/** Re-wraps the key under a new passphrase and uploads the new bundle. */
export async function changeRemotePassphrase(
  api: SyncApi,
  current: RemoteVault,
  newPassphrase: string,
  options?: Omit<CreateVaultOptions, 'recoveryCode'>,
): Promise<RemoteVault> {
  const vault = await changePassphrase(current.vault, newPassphrase, options);
  const { version } = await api.putKeyBundle(vault.bundle, current.version);
  return { vault, version };
}

/** Issues a new recovery code and uploads the bundle; the old code stops working. */
export async function replaceRemoteRecoveryCode(
  api: SyncApi,
  current: RemoteVault,
): Promise<RemoteVault & { recoveryCode: string }> {
  const { vault, recoveryCode } = await replaceRecoveryCode(current.vault);
  const { version } = await api.putKeyBundle(vault.bundle, current.version);
  return { vault, version, recoveryCode };
}
