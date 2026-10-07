import { describe, expect, it } from 'vitest';
import {
  concatBytes,
  crc32,
  equalBytes,
  fromBase64Url,
  randomBytes,
  toBase64Url,
  utf8Decode,
  utf8Encode,
} from '../src/bytes';

describe('base64url', () => {
  it('round-trips every length up to 40 bytes', () => {
    for (let n = 0; n <= 40; n++) {
      const bytes = randomBytes(n);
      const text = toBase64Url(bytes);
      expect(text).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(fromBase64Url(text)).toEqual(bytes);
    }
  });

  it('matches RFC 4648 test vectors (url alphabet, no padding)', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['f', 'Zg'],
      ['fo', 'Zm8'],
      ['foo', 'Zm9v'],
      ['foob', 'Zm9vYg'],
      ['fooba', 'Zm9vYmE'],
      ['foobar', 'Zm9vYmFy'],
    ];
    for (const [plain, encoded] of cases) {
      expect(toBase64Url(utf8Encode(plain))).toBe(encoded);
      expect(utf8Decode(fromBase64Url(encoded))).toBe(plain);
    }
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });

  it('rejects padding, foreign characters and non-canonical input', () => {
    expect(() => fromBase64Url('Zg==')).toThrow();
    expect(() => fromBase64Url('Zm9+')).toThrow();
    expect(() => fromBase64Url('Z')).toThrow();
    expect(() => fromBase64Url('Zh')).toThrow(); // trailing bits set
  });
});

describe('byte helpers', () => {
  it('concatenates and compares', () => {
    const a = new Uint8Array([1, 2]);
    const b = new Uint8Array([3]);
    expect(concatBytes(a, b)).toEqual(new Uint8Array([1, 2, 3]));
    expect(equalBytes(a, new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(a, new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(a, b)).toBe(false);
  });

  it('fills large random buffers past the 64 KiB getRandomValues limit', () => {
    const bytes = randomBytes(200_000);
    expect(bytes.length).toBe(200_000);
    expect(bytes.subarray(150_000).some((b) => b !== 0)).toBe(true);
  });

  it('computes the standard CRC-32 check value', () => {
    expect(crc32(utf8Encode('123456789'))).toBe(0xcbf43926);
  });

  it('rejects malformed UTF-8', () => {
    expect(() => utf8Decode(new Uint8Array([0xff]))).toThrow();
  });
});
