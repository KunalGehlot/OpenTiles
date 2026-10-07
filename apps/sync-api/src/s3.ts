// S3-compatible object storage (any EU provider that speaks the S3 API), with a small AWS
// Signature Version 4 signer instead of the full AWS SDK. Only five calls are needed: put, get,
// delete, list by prefix and batch delete.
import { createHash, createHmac } from 'node:crypto';
import { assertKey, type BlobStore } from './blob-store.js';

export interface S3Options {
  /** e.g. `https://s3.fr-par.scw.cloud` or `https://fsn1.your-objectstorage.com`. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `https://endpoint/bucket/key` instead of `https://bucket.endpoint/key`. */
  forcePathStyle?: boolean;
  /** Prepended to every key, so one bucket can serve several environments. */
  prefix?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/** RFC 3986 percent-encoding, as SigV4 requires (encodeURIComponent leaves !'()* alone). */
export function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface SignInput {
  method: string;
  /** Decoded path, e.g. `/test$file.text`. Each segment is encoded once. */
  path: string;
  /** Decoded query parameters. */
  query?: [string, string][];
  /** Headers to sign. `host` is required. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

function amzDate(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

/**
 * Computes the SigV4 `Authorization` header. Returns the headers to send: the input headers plus
 * `x-amz-date`, `x-amz-content-sha256` and `authorization`.
 */
export function signV4(
  input: SignInput,
  credentials: Credentials,
  date: Date,
): Record<string, string> {
  const service = credentials.service ?? 's3';
  const stamp = amzDate(date);
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers)) headers[k.toLowerCase()] = v;
  headers['x-amz-date'] = stamp;
  headers['x-amz-content-sha256'] = input.payloadHash;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names
    .map((n) => `${n}:${(headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`)
    .join('');
  const signedHeaders = names.join(';');
  const canonicalUri = input.path
    .split('/')
    .map((segment) => uriEncode(segment))
    .join('/');
  const canonicalQuery = (input.query ?? [])
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join('\n');

  const scope = `${day}/${credentials.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, day);
  const kRegion = hmac(kDate, credentials.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

function xmlEscape(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xmlUnescape(s: string): string {
  return s
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function xmlValues(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  for (const m of xml.matchAll(re)) out.push(xmlUnescape(m[1] ?? ''));
  return out;
}

export class S3Error extends Error {
  readonly status: number;
  constructor(operation: string, status: number) {
    // The response body can echo object keys; keep it out of logs.
    super(`S3 ${operation} failed with HTTP ${status}`);
    this.name = 'S3Error';
    this.status = status;
  }
}

export function s3BlobStore(options: S3Options): BlobStore {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const endpoint = new URL(options.endpoint);
  const prefix = options.prefix ?? '';
  if (prefix !== '') assertKey(prefix);
  const credentials: Credentials = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
  };
  const host = options.forcePathStyle ? endpoint.host : `${options.bucket}.${endpoint.host}`;
  const basePath = options.forcePathStyle ? `/${options.bucket}` : '';

  async function send(
    method: string,
    key: string | null,
    query: [string, string][],
    body?: Uint8Array,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const path = key === null ? basePath || '/' : `${basePath}/${key}`;
    const payloadHash = body === undefined ? EMPTY_SHA256 : sha256Hex(body);
    const headers = signV4(
      { method, path, query, headers: { host, ...extraHeaders }, payloadHash },
      credentials,
      now(),
    );
    delete headers.host; // fetch sets it from the URL
    const encodedPath = path
      .split('/')
      .map((s) => uriEncode(s))
      .join('/');
    const search = query.map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`).join('&');
    const url = `${endpoint.protocol}//${host}${encodedPath}${search ? `?${search}` : ''}`;
    return doFetch(url, { method, headers, body });
  }

  return {
    async put(key, data) {
      assertKey(key);
      const res = await send('PUT', prefix + key, [], data, {
        'content-type': 'application/octet-stream',
      });
      await res.arrayBuffer();
      if (!res.ok) throw new S3Error('put', res.status);
    },

    async get(key) {
      assertKey(key);
      const res = await send('GET', prefix + key, []);
      if (res.status === 404) {
        await res.arrayBuffer();
        return null;
      }
      if (!res.ok) {
        await res.arrayBuffer();
        throw new S3Error('get', res.status);
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async delete(key) {
      assertKey(key);
      const res = await send('DELETE', prefix + key, []);
      await res.arrayBuffer();
      if (!res.ok && res.status !== 404) throw new S3Error('delete', res.status);
    },

    async deletePrefix(keyPrefix) {
      assertKey(keyPrefix);
      if (!keyPrefix.endsWith('/')) throw new Error('A prefix must end with "/"');
      let token: string | undefined;
      do {
        const query: [string, string][] = [
          ['list-type', '2'],
          ['prefix', prefix + keyPrefix],
          ['max-keys', '1000'],
        ];
        if (token !== undefined) query.push(['continuation-token', token]);
        const res = await send('GET', null, query);
        const xml = await res.text();
        if (!res.ok) throw new S3Error('list', res.status);
        const keys = xmlValues(xml, 'Key');
        token =
          xmlValues(xml, 'IsTruncated')[0] === 'true'
            ? xmlValues(xml, 'NextContinuationToken')[0]
            : undefined;
        if (keys.length > 0) {
          const body = new TextEncoder().encode(
            `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${keys
              .map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`)
              .join('')}</Delete>`,
          );
          const del = await send('POST', null, [['delete', '']], body, {
            'content-md5': createHash('md5').update(body).digest('base64'),
            'content-type': 'application/xml',
          });
          const result = await del.text();
          if (!del.ok) throw new S3Error('batch delete', del.status);
          if (result.includes('<Error>')) throw new S3Error('batch delete', 207);
        }
      } while (token !== undefined);
    },
  };
}
