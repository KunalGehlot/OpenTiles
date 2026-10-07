import { describe, expect, it } from 'vitest';
import { utf8Encode } from '../src/bytes';
import {
  DEFAULT_KDF_PARAMS,
  argon2idRaw,
  assertPassphraseStrength,
  normalisePassphrase,
  validateKdfParams,
} from '../src/kdf';

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

describe('Argon2id', () => {
  it('matches the reference implementation (phc-winner-argon2 test vector, v=19)', async () => {
    // argon2id, t=2, m=2^16 KiB, p=1, password "password", salt "somesalt".
    const out = await argon2idRaw(utf8Encode('password'), utf8Encode('somesalt'), {
      algorithm: 'argon2id',
      memoryKiB: 65536,
      iterations: 2,
      parallelism: 1,
    });
    expect(hex(out)).toBe('09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7');
  });

  it('uses the RFC 9106 second recommended option by default', () => {
    expect(DEFAULT_KDF_PARAMS).toEqual({
      algorithm: 'argon2id',
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 4,
    });
  });
});

describe('validateKdfParams', () => {
  it('accepts sane parameters and copies only known fields', () => {
    expect(validateKdfParams({ ...DEFAULT_KDF_PARAMS, extra: 1 })).toEqual(DEFAULT_KDF_PARAMS);
  });

  it('rejects other algorithms as unsupported', () => {
    expect(() => validateKdfParams({ ...DEFAULT_KDF_PARAMS, algorithm: 'scrypt' })).toThrow(
      expect.objectContaining({ code: 'unsupported' }),
    );
  });

  it('rejects parameters that would freeze the device or are not integers', () => {
    for (const bad of [
      { memoryKiB: 4 * 1024 * 1024 },
      { iterations: 1000 },
      { parallelism: 64 },
      { iterations: 1.5 },
      { memoryKiB: 4, parallelism: 1 },
      { memoryKiB: '65536' },
    ]) {
      expect(() => validateKdfParams({ ...DEFAULT_KDF_PARAMS, ...bad })).toThrow(
        expect.objectContaining({ code: 'corrupt' }),
      );
    }
    expect(() => validateKdfParams(null)).toThrow();
  });
});

describe('passphrases', () => {
  it('normalises composed and decomposed accents to the same string', () => {
    expect(normalisePassphrase('Müller')).toBe(normalisePassphrase('Müller'));
  });

  it('rejects passphrases shorter than eight characters', () => {
    expect(() => assertPassphraseStrength('short')).toThrow(
      expect.objectContaining({ code: 'weak-passphrase' }),
    );
    expect(() => assertPassphraseStrength('long enough')).not.toThrow();
  });
});
