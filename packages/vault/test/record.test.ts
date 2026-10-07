import { describe, expect, it } from 'vitest';
import { randomBytes, utf8Encode } from '../src/bytes';
import {
  RECORD_OVERHEAD,
  decryptBytes,
  decryptRecord,
  encryptBytes,
  encryptRecord,
  padmeLength,
} from '../src/record';
import { generateLibraryKey } from '../src/vault';
import { contains, flip } from './helpers';

const item = {
  title: 'Self-made Waltz in A minor',
  fileName: 'my-waltz.musicxml',
  bytes: utf8Encode('<score-partwise>'.padEnd(5000, '<note/>')),
  song: { notes: [{ pitch: 69, startBeat: 0 }] },
};

describe('encryptRecord / decryptRecord', () => {
  it('round-trips a library item', async () => {
    const key = await generateLibraryKey();
    const blob = await encryptRecord(key, item, 'sync/abc/1');
    expect(await decryptRecord(key, blob, 'sync/abc/1')).toEqual(item);
  });

  it('never contains the title or file name in the clear', async () => {
    const key = await generateLibraryKey();
    for (const compress of [true, false]) {
      const blob = await encryptRecord(key, item, 'ctx', { compress });
      expect(contains(blob, utf8Encode(item.title))).toBe(false);
      expect(contains(blob, utf8Encode(item.fileName))).toBe(false);
      expect(contains(blob, utf8Encode('<score-partwise>'))).toBe(false);
    }
  });

  it('uses a fresh IV each time', async () => {
    const key = await generateLibraryKey();
    const a = await encryptRecord(key, item, 'ctx');
    const b = await encryptRecord(key, item, 'ctx');
    expect(a).not.toEqual(b);
  });

  it('compresses repetitive content', async () => {
    const key = await generateLibraryKey();
    const blob = await encryptRecord(key, item, 'ctx');
    expect(blob.length).toBeLessThan(item.bytes.length / 4);
    const raw = await encryptRecord(key, item, 'ctx', { compress: false });
    expect(raw.length).toBeGreaterThan(item.bytes.length);
  });

  it('keeps incompressible content close to its size, plus at most 12 % padding', async () => {
    const key = await generateLibraryKey();
    const noise = randomBytes(10_000);
    const blob = await encryptBytes(key, noise, 'ctx');
    expect(blob.length).toBeGreaterThanOrEqual(noise.length + RECORD_OVERHEAD);
    expect(blob.length).toBeLessThanOrEqual(Math.ceil((noise.length + 9) * 1.12) + 32);
    expect(await decryptBytes(key, blob, 'ctx')).toEqual(noise);
  });

  it('fails with corrupt for the wrong key or the wrong context', async () => {
    const key = await generateLibraryKey();
    const other = await generateLibraryKey();
    const blob = await encryptRecord(key, item, 'sync/abc/2');
    await expect(decryptRecord(other, blob, 'sync/abc/2')).rejects.toMatchObject({
      code: 'corrupt',
    });
    // A blob replayed under another record id or an older version number.
    await expect(decryptRecord(key, blob, 'sync/xyz/2')).rejects.toMatchObject({ code: 'corrupt' });
    await expect(decryptRecord(key, blob, 'sync/abc/1')).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('detects tampering anywhere in the blob', async () => {
    const key = await generateLibraryKey();
    const blob = await encryptRecord(key, { small: 'record' }, 'ctx');
    // IV, first ciphertext byte, last tag byte.
    for (const index of [4, 10, 16, blob.length - 1]) {
      await expect(decryptRecord(key, flip(blob, index), 'ctx')).rejects.toMatchObject({
        code: 'corrupt',
      });
    }
    await expect(decryptRecord(key, flip(blob, 0), 'ctx')).rejects.toMatchObject({
      code: 'corrupt',
    });
    const newer = blob.slice();
    newer[3] = 2;
    await expect(decryptRecord(key, newer, 'ctx')).rejects.toMatchObject({
      code: 'unsupported',
    });
    await expect(decryptRecord(key, blob.subarray(0, 20), 'ctx')).rejects.toMatchObject({
      code: 'corrupt',
    });
    await expect(
      decryptRecord(key, blob.subarray(0, blob.length - 1), 'ctx'),
    ).rejects.toMatchObject({ code: 'corrupt' });
  });
});

describe('padmeLength', () => {
  it('matches the Padmé definition on known points', () => {
    expect(padmeLength(0)).toBe(0);
    expect(padmeLength(1)).toBe(1);
    expect(padmeLength(9)).toBe(10);
    expect(padmeLength(1000)).toBe(1024);
    expect(padmeLength(1025)).toBe(1088);
    expect(padmeLength(1_000_000)).toBe(1_015_808);
  });

  it('never shrinks, never adds more than 12 %, and is idempotent', () => {
    for (let n = 2; n < 200_000; n += 997) {
      const p = padmeLength(n);
      expect(p).toBeGreaterThanOrEqual(n);
      expect(p).toBeLessThanOrEqual(Math.ceil(n * 1.12));
      expect(padmeLength(p)).toBe(p);
    }
  });
});
