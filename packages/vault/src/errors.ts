/**
 * Why a vault operation failed. The UI maps these to plain messages; none of them reveal anything
 * about the data.
 *
 * - `wrong-secret`: the passphrase or recovery code does not unlock this key bundle.
 * - `corrupt`: the data failed authentication or is malformed (tampering, truncation, wrong key).
 * - `unsupported`: a newer or unknown format version.
 * - `invalid-recovery-code`: the recovery code is mistyped (bad characters, length or checksum).
 * - `weak-passphrase`: the passphrase is too short to protect the library.
 * - `invalid-argument`: the caller passed data the vault cannot handle.
 */
export type VaultErrorCode =
  | 'wrong-secret'
  | 'corrupt'
  | 'unsupported'
  | 'invalid-recovery-code'
  | 'weak-passphrase'
  | 'invalid-argument';

export class VaultError extends Error {
  readonly code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'VaultError';
    this.code = code;
  }
}

export function isVaultError(error: unknown, code?: VaultErrorCode): error is VaultError {
  return error instanceof VaultError && (code === undefined || error.code === code);
}
