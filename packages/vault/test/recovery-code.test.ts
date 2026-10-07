import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  generateRecoverySecret,
  isWellFormedRecoveryCode,
  parseRecoveryCode,
} from '../src/recovery-code';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const fixedSecret = new Uint8Array(20).map((_, i) => (i * 37 + 11) & 0xff);

describe('recovery code', () => {
  it('prints 160 bits as nine groups of four Crockford characters', () => {
    const code = formatRecoveryCode(generateRecoverySecret());
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){8}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('round-trips', () => {
    for (let i = 0; i < 50; i++) {
      const secret = generateRecoverySecret();
      expect(parseRecoveryCode(formatRecoveryCode(secret))).toEqual(secret);
    }
  });

  it('forgives case, spacing, and I/L/O look-alikes', () => {
    const code = formatRecoveryCode(fixedSecret);
    const sloppy = ` ${code.toLowerCase().replaceAll('-', ' ')} `;
    expect(parseRecoveryCode(sloppy)).toEqual(fixedSecret);
    const withLookAlikes = code.replaceAll('0', 'O').replaceAll('1', 'l');
    expect(parseRecoveryCode(withLookAlikes)).toEqual(fixedSecret);
  });

  it('catches every single-character typo in a fixed code', () => {
    const chars = formatRecoveryCode(fixedSecret).replaceAll('-', '');
    for (let i = 0; i < chars.length; i++) {
      const original = chars[i]!;
      const replacement = ALPHABET[(ALPHABET.indexOf(original) + 7) % ALPHABET.length]!;
      const typo = chars.slice(0, i) + replacement + chars.slice(i + 1);
      expect(isWellFormedRecoveryCode(typo), `position ${i}`).toBe(false);
    }
  });

  it('explains what is wrong', () => {
    expect(() => parseRecoveryCode('ABCD-EFGH')).toThrow(/36 characters/);
    const code = formatRecoveryCode(fixedSecret);
    expect(() => parseRecoveryCode(`U${code.slice(1)}`)).toThrow(/not used/);
    expect(() => parseRecoveryCode('ABCD-EFGH')).toThrow(
      expect.objectContaining({ code: 'invalid-recovery-code' }),
    );
  });

  it('rejects secrets of the wrong size', () => {
    expect(() => formatRecoveryCode(new Uint8Array(16))).toThrow();
  });
});
