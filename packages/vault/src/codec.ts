// Turns plain JS data (JSON values plus `Uint8Array`) into bytes and back, so records such as a
// library item (song model + original file bytes) can be encrypted as one unit without base64
// bloat.
//
// Layout: [0x01][u32 json length][json][u32 n][n × u32 length][binary parts...]
// In the JSON, a `Uint8Array` becomes {"$bin": index}. A plain object that itself has a "$bin" or
// "$esc" key is wrapped as {"$esc": {...}} so it cannot be mistaken for a binary reference.
import { concatBytes, utf8Decode, utf8Encode, type Bytes } from './bytes';
import { VaultError } from './errors';

const CODEC_VERSION = 1;

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function describe(path: string): string {
  return path === '' ? 'the value' : `"${path}"`;
}

/** Serialises plain data. Throws `invalid-argument` for values JSON would silently mangle. */
export function packValue(value: unknown): Bytes {
  const parts: Uint8Array[] = [];
  const ancestors = new Set<object>();

  const encode = (v: unknown, path: string): unknown => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) {
        throw new VaultError('invalid-argument', `${describe(path)} is not a finite number`);
      }
      return v;
    }
    if (v instanceof Uint8Array) {
      parts.push(v);
      return { $bin: parts.length - 1 };
    }
    if (typeof v !== 'object') {
      throw new VaultError('invalid-argument', `${describe(path)} cannot be stored (${typeof v})`);
    }
    if (ancestors.has(v)) {
      throw new VaultError('invalid-argument', `${describe(path)} refers to itself`);
    }
    ancestors.add(v);
    try {
      if (Array.isArray(v)) {
        return v.map((item: unknown, i) =>
          item === undefined ? null : encode(item, `${path}[${i}]`),
        );
      }
      if (!isPlainObject(v)) {
        throw new VaultError(
          'invalid-argument',
          `${describe(path)} is a ${v.constructor?.name ?? 'non-plain object'}; only plain data can be stored`,
        );
      }
      const entries: [string, unknown][] = [];
      for (const [k, item] of Object.entries(v)) {
        if (item === undefined) continue;
        entries.push([k, encode(item, path === '' ? k : `${path}.${k}`)]);
      }
      const obj = Object.fromEntries(entries);
      return Object.hasOwn(v, '$bin') || Object.hasOwn(v, '$esc') ? { $esc: obj } : obj;
    } finally {
      ancestors.delete(v);
    }
  };

  const json = utf8Encode(JSON.stringify(encode(value, '')));
  const header = new Uint8Array(1 + 4 + json.length + 4 + 4 * parts.length);
  const view = new DataView(header.buffer);
  header[0] = CODEC_VERSION;
  view.setUint32(1, json.length);
  header.set(json, 5);
  view.setUint32(5 + json.length, parts.length);
  parts.forEach((p, i) => view.setUint32(9 + json.length + 4 * i, p.length));
  return concatBytes(header, ...parts);
}

function corrupt(): VaultError {
  return new VaultError('corrupt', 'The stored data is malformed');
}

/** Inverse of `packValue`. Binary parts come back as fresh `Uint8Array`s. */
export function unpackValue(bytes: Uint8Array): unknown {
  if (bytes.length < 9 || bytes[0] !== CODEC_VERSION) throw corrupt();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(1);
  if (5 + jsonLength + 4 > bytes.length) throw corrupt();
  let tree: unknown;
  try {
    tree = JSON.parse(utf8Decode(bytes.subarray(5, 5 + jsonLength)));
  } catch {
    throw corrupt();
  }
  const count = view.getUint32(5 + jsonLength);
  let offset = 9 + jsonLength + 4 * count;
  if (offset > bytes.length) throw corrupt();
  const parts: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const length = view.getUint32(9 + jsonLength + 4 * i);
    if (offset + length > bytes.length) throw corrupt();
    parts.push(bytes.slice(offset, offset + length));
    offset += length;
  }
  if (offset !== bytes.length) throw corrupt();

  const decode = (v: unknown, tagged: boolean): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((item: unknown) => decode(item, true));
    const keys = Object.keys(v);
    const rec = v as Record<string, unknown>;
    if (tagged && keys.length === 1 && keys[0] === '$bin') {
      const index = rec.$bin;
      if (typeof index !== 'number' || !Number.isInteger(index)) throw corrupt();
      const part = parts[index];
      if (part === undefined) throw corrupt();
      return part;
    }
    if (tagged && keys.length === 1 && keys[0] === '$esc') {
      if (typeof rec.$esc !== 'object' || rec.$esc === null || Array.isArray(rec.$esc)) {
        throw corrupt();
      }
      return decode(rec.$esc, false);
    }
    // Object.fromEntries defines own properties, so a "__proto__" key stays a plain key.
    return Object.fromEntries(keys.map((k) => [k, decode(rec[k], true)]));
  };
  return decode(tree, true);
}
