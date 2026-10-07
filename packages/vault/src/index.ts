// @opentiles/vault: everything that turns library data into ciphertext and back. Pure TypeScript
// over WebCrypto, so it runs unchanged in browsers, workers, Node 22 and the iOS shell.
export {
  asBytes,
  concatBytes,
  equalBytes,
  fromBase64Url,
  randomBytes,
  toBase64Url,
  utf8Decode,
  utf8Encode,
  type Bytes,
} from './bytes';
export { VaultError, isVaultError, type VaultErrorCode } from './errors';
export {
  DEFAULT_KDF_PARAMS,
  KDF_LIMITS,
  MIN_KDF_PARAMS,
  MIN_PASSPHRASE_LENGTH,
  argon2idRaw,
  assertPassphraseStrength,
  deriveWrappingKey,
  normalisePassphrase,
  validateKdfParams,
  type Argon2idParams,
} from './kdf';
export {
  RECOVERY_SECRET_BYTES,
  formatRecoveryCode,
  isWellFormedRecoveryCode,
  parseRecoveryCode,
} from './recovery-code';
export {
  KEY_BUNDLE_FORMAT,
  KEY_BUNDLE_VERSION,
  changePassphrase,
  createVault,
  generateLibraryKey,
  parseKeyBundle,
  replaceRecoveryCode,
  sameKey,
  unlockVault,
  type CreateVaultOptions,
  type KeyBundle,
  type PassphraseSlot,
  type RecoverySlot,
  type Vault,
  type VaultSecret,
} from './vault';
export { packValue, unpackValue } from './codec';
export {
  RECORD_OVERHEAD,
  decryptBytes,
  decryptRecord,
  encryptBytes,
  encryptRecord,
  padmeLength,
  type EncryptOptions,
} from './record';
export {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_MIME_TYPE,
  backupFileName,
  exportBackup,
  importBackup,
  importBackupWithKey,
  readBackupManifest,
  type BackupData,
  type BackupManifest,
} from './backup';
