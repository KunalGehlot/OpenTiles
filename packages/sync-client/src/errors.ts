/** An error answer from the sync service. `code` is the service's machine-readable reason. */
export class SyncApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** The rest of the service's JSON answer (for example the current version on a 410). */
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'SyncApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The record or key bundle changed on another device since the version this device used. */
export class VersionConflictError extends SyncApiError {
  readonly current: { version: number; deleted: boolean };

  constructor(message: string, current: { version: number; deleted: boolean }) {
    super(412, 'version-conflict', message);
    this.name = 'VersionConflictError';
    this.current = current;
  }
}

/** The account's storage is full (250 MB by default) or has too many records. */
export class QuotaExceededError extends SyncApiError {
  constructor(code: string, message: string) {
    super(507, code, message);
    this.name = 'QuotaExceededError';
  }
}

/** Another device already created the library key; unlock it instead of creating a new one. */
export class VaultExistsError extends Error {
  constructor() {
    super('Sync is already set up for this account. Enter your passphrase to unlock it.');
    this.name = 'VaultExistsError';
  }
}
