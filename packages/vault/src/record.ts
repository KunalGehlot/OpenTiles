// Record encryption (spec §10, step 3). Every library item, progress record and setting is sealed
// with AES-256-GCM under the library key before it is uploaded or written to a backup. Titles and
// file names live inside the encrypted payload, never beside it.
//
// Blob layout:   "OTR" 0x01 | 12-byte IV | AES-GCM ciphertext + 16-byte tag
// Plaintext:     flags u8 | stored length u32 | original length u32 | body | zero padding
// AAD:           the 4-byte header + "opentiles/record\0" + context
//
// The context names where the blob belongs (for example `sync/<record id>/<version>`), so the
// server cannot move a blob to another record or replay an old version under a newer number.
//
// The body is deflated when that helps (MusicXML shrinks a lot) and the plaintext is padded with
// the Padmé scheme, so a blob's size reveals only its rough magnitude: an exact size could
// otherwise fingerprint a well-known file.
import { deflateSync, inflateSync } from 'fflate';
import { asBytes, concatBytes, randomBytes, utf8Encode, type Bytes } from './bytes';
import { packValue, unpackValue } from './codec';
import { VaultError } from './errors';

const MAGIC = new Uint8Array([0x4f, 0x54, 0x52, 0x01]); // "OTR", version 1
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PLAIN_HEADER = 9;
const FLAG_DEFLATE = 1;
/** Only try compression for bodies at least this big; tiny records rarely shrink. */
const COMPRESS_MIN = 128;

/** Smallest valid blob: header, IV and tag around an empty padded plaintext. */
export const RECORD_OVERHEAD = MAGIC.length + IV_BYTES + TAG_BYTES + PLAIN_HEADER;

/**
 * Padmé (Nikitin et al., PETS 2019): rounds a length up so that at most O(log log n) bits of it
 * remain, with at most 12 % overhead.
 */
export function padmeLength(length: number): number {
  if (!Number.isInteger(length) || length < 0) throw new RangeError('Invalid length');
  if (length < 2) return length;
  const e = length < 2 ** 32 ? 31 - Math.clz32(length) : Math.floor(Math.log2(length));
  const s = 32 - Math.clz32(e);
  const step = 2 ** (e - s);
  return Math.ceil(length / step) * step;
}

function aadFor(context: string): Bytes {
  return concatBytes(MAGIC, utf8Encode(`opentiles/record\0${context}`));
}

export interface EncryptOptions {
  /** Deflate the body when that makes it smaller (default true). */
  compress?: boolean;
}

/** Encrypts raw bytes. Most callers want `encryptRecord`. */
export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array,
  context: string,
  options: EncryptOptions = {},
): Promise<Bytes> {
  let body: Uint8Array = plaintext;
  let flags = 0;
  if ((options.compress ?? true) && plaintext.length >= COMPRESS_MIN) {
    const deflated = deflateSync(plaintext, { level: 6 });
    if (deflated.length < plaintext.length) {
      body = deflated;
      flags |= FLAG_DEFLATE;
    }
  }
  const padded = new Uint8Array(padmeLength(PLAIN_HEADER + body.length));
  const view = new DataView(padded.buffer);
  padded[0] = flags;
  view.setUint32(1, body.length);
  view.setUint32(5, plaintext.length);
  padded.set(body, PLAIN_HEADER);

  const iv = randomBytes(IV_BYTES);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(context) },
    key,
    padded,
  );
  return concatBytes(MAGIC, iv, new Uint8Array(sealed));
}

/** Decrypts and authenticates a blob from `encryptBytes`. Throws `corrupt` on any mismatch. */
export async function decryptBytes(
  key: CryptoKey,
  blob: Uint8Array,
  context: string,
): Promise<Bytes> {
  if (blob.length < RECORD_OVERHEAD) throw new VaultError('corrupt', 'The record is truncated');
  if (blob[0] !== MAGIC[0] || blob[1] !== MAGIC[1] || blob[2] !== MAGIC[2]) {
    throw new VaultError('corrupt', 'This is not an OpenTiles record');
  }
  if (blob[3] !== MAGIC[3]) {
    throw new VaultError('unsupported', 'This record was made by a newer version of OpenTiles');
  }
  let plain: Bytes;
  try {
    const opened = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: asBytes(blob.slice(4, 4 + IV_BYTES)),
        additionalData: aadFor(context),
      },
      key,
      asBytes(blob.subarray(4 + IV_BYTES)),
    );
    plain = new Uint8Array(opened);
  } catch (cause) {
    throw new VaultError(
      'corrupt',
      'The record could not be decrypted: it was changed, or it belongs to another library',
      { cause },
    );
  }
  const view = new DataView(plain.buffer, plain.byteOffset, plain.byteLength);
  const flags = plain[0] ?? 0;
  const stored = view.getUint32(1);
  const original = view.getUint32(5);
  if (PLAIN_HEADER + stored > plain.length || (flags & ~FLAG_DEFLATE) !== 0) {
    throw new VaultError('corrupt', 'The record is malformed');
  }
  const body = plain.subarray(PLAIN_HEADER, PLAIN_HEADER + stored);
  if ((flags & FLAG_DEFLATE) === 0) {
    if (stored !== original) throw new VaultError('corrupt', 'The record is malformed');
    return body.slice();
  }
  let inflated: Bytes;
  try {
    inflated = inflateSync(body, { out: new Uint8Array(original) });
  } catch (cause) {
    throw new VaultError('corrupt', 'The record is malformed', { cause });
  }
  if (inflated.length !== original) throw new VaultError('corrupt', 'The record is malformed');
  return inflated;
}

/** Encrypts plain data (JSON values and `Uint8Array`s) under the library key. */
export async function encryptRecord(
  key: CryptoKey,
  value: unknown,
  context: string,
  options?: EncryptOptions,
): Promise<Bytes> {
  return encryptBytes(key, packValue(value), context, options);
}

export async function decryptRecord(
  key: CryptoKey,
  blob: Uint8Array,
  context: string,
): Promise<unknown> {
  return unpackValue(await decryptBytes(key, blob, context));
}
