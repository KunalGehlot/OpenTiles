// Passphrase → wrapping key, with Argon2id (spec §10, step 2). hash-wasm ships the Argon2
// implementation as embedded WebAssembly, so nothing is fetched at run time.
import { argon2id } from 'hash-wasm';
import { asBytes, utf8Encode } from './bytes';
import { VaultError } from './errors';

export interface Argon2idParams {
  algorithm: 'argon2id';
  /** Memory cost in KiB. */
  memoryKiB: number;
  /** Number of passes over the memory. */
  iterations: number;
  /** Lanes. hash-wasm computes them one after another, so this does not change the cost. */
  parallelism: number;
}

/**
 * RFC 9106 §4, second recommended option: 64 MiB, 3 passes, 4 lanes.
 *
 * Why these numbers: the key is derived once per device (when sync is set up or a backup is
 * opened), not on every launch, so a second or two is acceptable. 64 MiB stays well inside what
 * Safari gives a WebAssembly page on an older iPad (A12, 3 GB RAM); the first recommended option
 * (2 GiB) would not. See docs/adr/0006-sync-design.md for measured timings.
 */
export const DEFAULT_KDF_PARAMS: Readonly<Argon2idParams> = Object.freeze({
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 4,
});

/**
 * Sanity limits for parameters read from a file or the server. The upper bounds stop a crafted
 * key bundle from freezing the device; the lower bounds are what Argon2 itself allows, so tests
 * can run with cheap parameters. Strength is enforced when creating a bundle, not when reading.
 */
export const KDF_LIMITS = Object.freeze({
  maxMemoryKiB: 1024 * 1024,
  maxIterations: 16,
  maxParallelism: 16,
});

/** The weakest parameters `createVault` accepts unless the caller opts out (tests only). */
export const MIN_KDF_PARAMS: Readonly<Argon2idParams> = Object.freeze({
  algorithm: 'argon2id',
  memoryKiB: 19 * 1024,
  iterations: 2,
  parallelism: 1,
});

export const SALT_BYTES = 16;
export const MIN_PASSPHRASE_LENGTH = 8;

function isInt(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;
}

export function validateKdfParams(value: unknown): Argon2idParams {
  if (typeof value !== 'object' || value === null) {
    throw new VaultError('corrupt', 'Key derivation parameters are missing');
  }
  const p = value as Record<string, unknown>;
  if (p.algorithm !== 'argon2id') {
    throw new VaultError('unsupported', 'Unknown key derivation algorithm');
  }
  if (
    !isInt(p.parallelism, 1, KDF_LIMITS.maxParallelism) ||
    !isInt(p.iterations, 1, KDF_LIMITS.maxIterations) ||
    !isInt(p.memoryKiB, 8 * p.parallelism, KDF_LIMITS.maxMemoryKiB)
  ) {
    throw new VaultError('corrupt', 'Key derivation parameters are out of range');
  }
  return {
    algorithm: 'argon2id',
    memoryKiB: p.memoryKiB,
    iterations: p.iterations,
    parallelism: p.parallelism,
  };
}

export function isWeakerThan(p: Argon2idParams, floor: Argon2idParams): boolean {
  return p.memoryKiB < floor.memoryKiB || p.iterations < floor.iterations;
}

/**
 * NFC-normalises the passphrase so the same characters typed on an iPad and on a desktop keyboard
 * produce the same bytes (accented letters can arrive composed or decomposed).
 */
export function normalisePassphrase(passphrase: string): string {
  return passphrase.normalize('NFC');
}

export function assertPassphraseStrength(passphrase: string): void {
  if ([...normalisePassphrase(passphrase)].length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultError(
      'weak-passphrase',
      `The passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters long`,
    );
  }
}

/** Raw Argon2id output (32 bytes by default). Exposed for tests against reference vectors. */
export async function argon2idRaw(
  password: Uint8Array,
  salt: Uint8Array,
  params: Argon2idParams,
  hashLength = 32,
): Promise<Uint8Array> {
  const p = validateKdfParams(params);
  return argon2id({
    password,
    salt,
    parallelism: p.parallelism,
    iterations: p.iterations,
    memorySize: p.memoryKiB,
    hashLength,
    outputType: 'binary',
  });
}

/** Derives the AES-GCM key that wraps the library key. Not extractable. */
export async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2idParams,
): Promise<CryptoKey> {
  if (salt.length < SALT_BYTES) throw new VaultError('corrupt', 'Salt is too short');
  const raw = await argon2idRaw(utf8Encode(normalisePassphrase(passphrase)), salt, params);
  try {
    return await crypto.subtle.importKey('raw', asBytes(raw), { name: 'AES-GCM' }, false, [
      'wrapKey',
      'unwrapKey',
    ]);
  } finally {
    raw.fill(0);
  }
}
