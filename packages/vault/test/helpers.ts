import type { Argon2idParams } from '../src/kdf';

/** Cheap Argon2id parameters so the suite stays fast. Never use outside tests. */
export const TEST_KDF: Argon2idParams = {
  algorithm: 'argon2id',
  memoryKiB: 256,
  iterations: 1,
  parallelism: 1,
};

export const testVaultOptions = { kdf: TEST_KDF, unsafeAllowWeakKdf: true } as const;

/** Flips one bit of a copy of `bytes`. */
export function flip(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

/** True when `needle` occurs anywhere in `haystack`. */
export function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
