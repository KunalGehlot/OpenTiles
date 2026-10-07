// The library key and its wrapped copies (spec §10, steps 1, 2, 4 and 5).
//
// One random AES-256-GCM key encrypts every record. It never leaves the device in the clear: the
// key bundle holds it wrapped twice, once under an Argon2id key from the passphrase and once under
// an HKDF key from the recovery code. The bundle is safe to store on the sync server or inside a
// backup file; without the passphrase or the code it is useless.
import { equalBytes, fromBase64Url, randomBytes, toBase64Url, utf8Encode } from './bytes';
import { VaultError } from './errors';
import {
  DEFAULT_KDF_PARAMS,
  MIN_KDF_PARAMS,
  SALT_BYTES,
  assertPassphraseStrength,
  deriveWrappingKey,
  isWeakerThan,
  validateKdfParams,
  type Argon2idParams,
} from './kdf';
import {
  deriveRecoveryWrappingKey,
  formatRecoveryCode,
  generateRecoverySecret,
  parseRecoveryCode,
} from './recovery-code';

const IV_BYTES = 12;
const KEY_ID_BYTES = 16;

export const KEY_BUNDLE_FORMAT = 'opentiles-keys';
export const KEY_BUNDLE_VERSION = 1;

export interface PassphraseSlot {
  kdf: Argon2idParams;
  /** base64url */
  salt: string;
  /** base64url */
  iv: string;
  /** base64url: the library key encrypted with AES-GCM (32 bytes + 16-byte tag). */
  wrappedKey: string;
}

export interface RecoverySlot {
  salt: string;
  iv: string;
  wrappedKey: string;
}

/** JSON-safe; safe to upload or store in a backup manifest. */
export interface KeyBundle {
  format: typeof KEY_BUNDLE_FORMAT;
  version: typeof KEY_BUNDLE_VERSION;
  /** Random identifier of the library key, so devices can tell whether they hold the same key. */
  keyId: string;
  passphrase: PassphraseSlot;
  recovery: RecoverySlot | null;
}

/** An unlocked library: the key plus the bundle it came from. Keep it in memory or IndexedDB. */
export interface Vault {
  readonly key: CryptoKey;
  readonly bundle: KeyBundle;
}

export type VaultSecret = { passphrase: string } | { recoveryCode: string };

export interface CreateVaultOptions {
  /** Defaults to `DEFAULT_KDF_PARAMS`. */
  kdf?: Argon2idParams;
  /** Create a recovery code too (default true). */
  recoveryCode?: boolean;
  /** Allow parameters weaker than `MIN_KDF_PARAMS`. For tests only. */
  unsafeAllowWeakKdf?: boolean;
}

function slotAad(slot: 'passphrase' | 'recovery', keyId: string): Uint8Array<ArrayBuffer> {
  return utf8Encode(`opentiles/keys/v1/${slot}/${keyId}`);
}

export async function generateLibraryKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function wrap(
  key: CryptoKey,
  wrappingKey: CryptoKey,
  aad: Uint8Array<ArrayBuffer>,
): Promise<{ iv: string; wrappedKey: string }> {
  if (!key.extractable) {
    throw new VaultError('invalid-argument', 'The library key must be extractable to wrap it');
  }
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.wrapKey('raw', key, wrappingKey, {
    name: 'AES-GCM',
    iv,
    additionalData: aad,
  });
  return { iv: toBase64Url(iv), wrappedKey: toBase64Url(new Uint8Array(wrapped)) };
}

async function unwrap(
  slot: { iv: string; wrappedKey: string },
  wrappingKey: CryptoKey,
  aad: Uint8Array<ArrayBuffer>,
  extractable: boolean,
): Promise<CryptoKey> {
  let iv: Uint8Array<ArrayBuffer>;
  let wrapped: Uint8Array<ArrayBuffer>;
  try {
    iv = fromBase64Url(slot.iv);
    wrapped = fromBase64Url(slot.wrappedKey);
  } catch (cause) {
    throw new VaultError('corrupt', 'The key bundle is damaged', { cause });
  }
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      wrapped,
      wrappingKey,
      { name: 'AES-GCM', iv, additionalData: aad },
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch (cause) {
    // AES-GCM cannot tell a wrong key from a modified ciphertext; for a key slot the likely cause
    // is the secret, so say that.
    throw new VaultError('wrong-secret', 'The passphrase or recovery code is not right', {
      cause,
    });
  }
}

async function passphraseSlot(
  key: CryptoKey,
  keyId: string,
  passphrase: string,
  kdf: Argon2idParams,
): Promise<PassphraseSlot> {
  const salt = randomBytes(SALT_BYTES);
  const wrappingKey = await deriveWrappingKey(passphrase, salt, kdf);
  const wrapped = await wrap(key, wrappingKey, slotAad('passphrase', keyId));
  return { kdf: { ...kdf }, salt: toBase64Url(salt), ...wrapped };
}

async function recoverySlot(
  key: CryptoKey,
  keyId: string,
): Promise<{ slot: RecoverySlot; code: string }> {
  const secret = generateRecoverySecret();
  const salt = randomBytes(SALT_BYTES);
  const wrappingKey = await deriveRecoveryWrappingKey(secret, salt);
  const wrapped = await wrap(key, wrappingKey, slotAad('recovery', keyId));
  const code = formatRecoveryCode(secret);
  secret.fill(0);
  return { slot: { salt: toBase64Url(salt), ...wrapped }, code };
}

function checkKdf(kdf: Argon2idParams, allowWeak: boolean | undefined): Argon2idParams {
  const p = validateKdfParams(kdf);
  if (!allowWeak && isWeakerThan(p, MIN_KDF_PARAMS)) {
    throw new VaultError('invalid-argument', 'Key derivation parameters are too weak');
  }
  return p;
}

/**
 * Creates a new library key and its bundle. The recovery code is returned once and stored
 * nowhere; the UI must show it and ask the user to keep it.
 */
export async function createVault(
  passphrase: string,
  options: CreateVaultOptions = {},
): Promise<{ vault: Vault; recoveryCode: string | null }> {
  assertPassphraseStrength(passphrase);
  const kdf = checkKdf(options.kdf ?? DEFAULT_KDF_PARAMS, options.unsafeAllowWeakKdf);
  const key = await generateLibraryKey();
  const keyId = toBase64Url(randomBytes(KEY_ID_BYTES));
  const pass = await passphraseSlot(key, keyId, passphrase, kdf);
  let recovery: RecoverySlot | null = null;
  let recoveryCode: string | null = null;
  if (options.recoveryCode ?? true) {
    const r = await recoverySlot(key, keyId);
    recovery = r.slot;
    recoveryCode = r.code;
  }
  const bundle: KeyBundle = {
    format: KEY_BUNDLE_FORMAT,
    version: KEY_BUNDLE_VERSION,
    keyId,
    passphrase: pass,
    recovery,
  };
  return { vault: { key, bundle }, recoveryCode };
}

/**
 * Unlocks a bundle with the passphrase or the recovery code. Throws `wrong-secret` when the
 * secret does not fit, `invalid-recovery-code` for a mistyped code, `corrupt` for a damaged
 * bundle. `extractable` defaults to true so the key can be re-wrapped later.
 */
export async function unlockVault(
  bundleValue: unknown,
  secret: VaultSecret,
  options: { extractable?: boolean } = {},
): Promise<Vault> {
  const bundle = parseKeyBundle(bundleValue);
  const extractable = options.extractable ?? true;
  if ('passphrase' in secret) {
    const salt = decodeField(bundle.passphrase.salt);
    const wrappingKey = await deriveWrappingKey(secret.passphrase, salt, bundle.passphrase.kdf);
    const key = await unwrap(
      bundle.passphrase,
      wrappingKey,
      slotAad('passphrase', bundle.keyId),
      extractable,
    );
    return { key, bundle };
  }
  const recoverySecret = parseRecoveryCode(secret.recoveryCode);
  if (bundle.recovery === null) {
    throw new VaultError('wrong-secret', 'This library has no recovery code');
  }
  const wrappingKey = await deriveRecoveryWrappingKey(
    recoverySecret,
    decodeField(bundle.recovery.salt),
  );
  recoverySecret.fill(0);
  const key = await unwrap(
    bundle.recovery,
    wrappingKey,
    slotAad('recovery', bundle.keyId),
    extractable,
  );
  return { key, bundle };
}

/** Re-wraps the library key under a new passphrase. The recovery code keeps working. */
export async function changePassphrase(
  vault: Vault,
  newPassphrase: string,
  options: Omit<CreateVaultOptions, 'recoveryCode'> = {},
): Promise<Vault> {
  assertPassphraseStrength(newPassphrase);
  const kdf = checkKdf(options.kdf ?? DEFAULT_KDF_PARAMS, options.unsafeAllowWeakKdf);
  const pass = await passphraseSlot(vault.key, vault.bundle.keyId, newPassphrase, kdf);
  return { key: vault.key, bundle: { ...vault.bundle, passphrase: pass } };
}

/** Issues a new recovery code; the old one stops working once the new bundle is saved. */
export async function replaceRecoveryCode(
  vault: Vault,
): Promise<{ vault: Vault; recoveryCode: string }> {
  const r = await recoverySlot(vault.key, vault.bundle.keyId);
  return {
    vault: { key: vault.key, bundle: { ...vault.bundle, recovery: r.slot } },
    recoveryCode: r.code,
  };
}

function decodeField(value: string): Uint8Array<ArrayBuffer> {
  try {
    return fromBase64Url(value);
  } catch (cause) {
    throw new VaultError('corrupt', 'The key bundle is damaged', { cause });
  }
}

function isB64(value: unknown, minBytes: number, maxBytes: number): value is string {
  if (typeof value !== 'string') return false;
  try {
    const n = fromBase64Url(value).length;
    return n >= minBytes && n <= maxBytes;
  } catch {
    return false;
  }
}

function isWrappedSlot(value: unknown): value is { iv: string; wrappedKey: string; salt: string } {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    isB64(s.salt, SALT_BYTES, 64) &&
    isB64(s.iv, IV_BYTES, IV_BYTES) &&
    // 32-byte key + 16-byte GCM tag.
    isB64(s.wrappedKey, 48, 48)
  );
}

/** Validates an untrusted value (from the server or a backup file) as a key bundle. */
export function parseKeyBundle(value: unknown): KeyBundle {
  if (typeof value !== 'object' || value === null) {
    throw new VaultError('corrupt', 'The key bundle is missing');
  }
  const b = value as Record<string, unknown>;
  if (b.format !== KEY_BUNDLE_FORMAT)
    throw new VaultError('corrupt', 'Not an OpenTiles key bundle');
  if (b.version !== KEY_BUNDLE_VERSION) {
    throw new VaultError('unsupported', 'This key bundle was made by a newer version of OpenTiles');
  }
  if (!isB64(b.keyId, KEY_ID_BYTES, KEY_ID_BYTES)) {
    throw new VaultError('corrupt', 'The key bundle is damaged');
  }
  const pass = b.passphrase;
  if (!isWrappedSlot(pass)) throw new VaultError('corrupt', 'The key bundle is damaged');
  const kdf = validateKdfParams((pass as unknown as Record<string, unknown>).kdf);
  let recovery: RecoverySlot | null = null;
  if (b.recovery !== null && b.recovery !== undefined) {
    if (!isWrappedSlot(b.recovery)) throw new VaultError('corrupt', 'The key bundle is damaged');
    recovery = { salt: b.recovery.salt, iv: b.recovery.iv, wrappedKey: b.recovery.wrappedKey };
  }
  return {
    format: KEY_BUNDLE_FORMAT,
    version: KEY_BUNDLE_VERSION,
    keyId: b.keyId,
    passphrase: { kdf, salt: pass.salt, iv: pass.iv, wrappedKey: pass.wrappedKey },
    recovery,
  };
}

/** True when both handles hold the same key material (used to check a re-unlocked vault). */
export async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  if (!a.extractable || !b.extractable) {
    throw new VaultError('invalid-argument', 'Both keys must be extractable to compare them');
  }
  const [ra, rb] = await Promise.all([
    crypto.subtle.exportKey('raw', a),
    crypto.subtle.exportKey('raw', b),
  ]);
  return equalBytes(new Uint8Array(ra), new Uint8Array(rb));
}
