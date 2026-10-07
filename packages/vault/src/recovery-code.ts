// The printable recovery code (spec §10, step 5): shown once, it unwraps the library key when the
// passphrase is forgotten.
//
// Layout: 160 random bits as 32 Crockford base32 characters, then a 20-bit checksum as 4 more,
// printed as nine groups of four: `7K3M-QX2P-...`. Crockford's alphabet has no I, L, O or U, and
// the parser reads I/L as 1 and O as 0, so handwriting and typing mistakes are forgiving. The
// checksum only catches typos early; the AES-GCM tag is the real check.
//
// The code carries 160 bits of entropy, so it needs no slow KDF: HKDF-SHA256 turns it into the
// wrapping key. Guessing it is as hopeless as guessing the key itself.
import { asBytes, crc32, randomBytes, utf8Encode, type Bytes } from './bytes';
import { VaultError } from './errors';

export const RECOVERY_SECRET_BYTES = 20;
const DATA_CHARS = 32;
const CHECK_CHARS = 4;
const GROUP = 4;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const DECODE = new Map<string, number>();
[...ALPHABET].forEach((c, i) => DECODE.set(c, i));
DECODE.set('O', 0);
DECODE.set('I', 1);
DECODE.set('L', 1);

function encodeBits(value: Uint8Array): string {
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const b of value) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

function checksumChars(secret: Uint8Array): string {
  const sum = crc32(secret) >>> 12; // top 20 bits
  let out = '';
  for (let shift = 15; shift >= 0; shift -= 5) out += ALPHABET[(sum >> shift) & 31];
  return out;
}

/** Formats a 20-byte secret as a grouped recovery code. */
export function formatRecoveryCode(secret: Uint8Array): string {
  if (secret.length !== RECOVERY_SECRET_BYTES) {
    throw new VaultError('invalid-argument', 'A recovery secret is 20 bytes');
  }
  const chars = encodeBits(secret) + checksumChars(secret);
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += GROUP) groups.push(chars.slice(i, i + GROUP));
  return groups.join('-');
}

export function generateRecoverySecret(): Bytes {
  return randomBytes(RECOVERY_SECRET_BYTES);
}

/**
 * Parses what the user typed back into the 20-byte secret. Spaces, hyphens and case are ignored.
 * Throws `invalid-recovery-code` with a reason the UI can show.
 */
export function parseRecoveryCode(input: string): Bytes {
  const cleaned = input.toUpperCase().replace(/[\s\-–—_.]/g, '');
  if (cleaned.length !== DATA_CHARS + CHECK_CHARS) {
    throw new VaultError(
      'invalid-recovery-code',
      `A recovery code has ${DATA_CHARS + CHECK_CHARS} characters; this one has ${cleaned.length}`,
    );
  }
  const values: number[] = [];
  for (const c of cleaned) {
    const v = DECODE.get(c);
    if (v === undefined) {
      throw new VaultError('invalid-recovery-code', `“${c}” is not used in recovery codes`);
    }
    values.push(v);
  }
  const secret = new Uint8Array(RECOVERY_SECRET_BYTES);
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (const v of values.slice(0, DATA_CHARS)) {
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      secret[o++] = (buffer >> bits) & 0xff;
    }
    buffer &= (1 << bits) - 1;
  }
  const expected = checksumChars(secret);
  const typed = values
    .slice(DATA_CHARS)
    .map((v) => ALPHABET[v])
    .join('');
  if (expected !== typed) {
    throw new VaultError('invalid-recovery-code', 'The recovery code has a typing mistake');
  }
  return secret;
}

export function isWellFormedRecoveryCode(input: string): boolean {
  try {
    parseRecoveryCode(input);
    return true;
  } catch {
    return false;
  }
}

/** HKDF-SHA256 from the recovery secret to the AES-GCM key that wraps the library key. */
export async function deriveRecoveryWrappingKey(
  secret: Uint8Array,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', asBytes(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: asBytes(salt),
      info: utf8Encode('opentiles/recovery-code/v1'),
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}
