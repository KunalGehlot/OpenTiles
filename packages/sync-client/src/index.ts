// @opentiles/sync-client: talks to the sync service and keeps the local library in step, uploading
// only records sealed by @opentiles/vault.
export {
  createSyncApi,
  type AccountInfo,
  type Change,
  type ChangesPage,
  type CrashReportInput,
  type RemoteBlob,
  type Session,
  type SyncApi,
  type SyncApiOptions,
  type WebAuthnJson,
} from './api';
export { buildCrashReport, scrubText } from './crash';
export {
  SyncEngine,
  newDeviceId,
  newRecordId,
  wins,
  type SyncEngineOptions,
  type SyncResult,
} from './engine';
export { QuotaExceededError, SyncApiError, VaultExistsError, VersionConflictError } from './errors';
export { MemorySyncStore, type StoredRecord, type SyncRecord, type SyncStore } from './store';
export {
  changeRemotePassphrase,
  createRemoteVault,
  hasRemoteVault,
  replaceRemoteRecoveryCode,
  unlockRemoteVault,
  type RemoteVault,
} from './vault-setup';
