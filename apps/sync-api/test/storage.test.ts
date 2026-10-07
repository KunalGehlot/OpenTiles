import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertKey, fsBlobStore, memoryBlobStore, type BlobStore } from '../src/blob-store.js';
import { S3Error, s3BlobStore, signV4, uriEncode, type Credentials } from '../src/s3.js';

// The worked examples in the Amazon S3 documentation ("Signature Calculations for the
// Authorization Header: Transferring Payload in a Single Chunk"), with AWS's published example
// credentials.
const AWS_EXAMPLE: Credentials = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
};
const EXAMPLE_DATE = new Date('2013-05-24T00:00:00Z');
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const signature = (headers: Record<string, string>) =>
  /Signature=([0-9a-f]{64})/.exec(headers.authorization!)![1];

describe('signV4', () => {
  it('matches the S3 documentation: GET object with a range', () => {
    const h = signV4(
      {
        method: 'GET',
        path: '/test.txt',
        headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9' },
        payloadHash: EMPTY,
      },
      AWS_EXAMPLE,
      EXAMPLE_DATE,
    );
    expect(signature(h)).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(h.authorization).toContain(
      'Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date',
    );
  });

  it('matches the S3 documentation: PUT object with an encoded key', () => {
    const body = 'Welcome to Amazon S3.';
    const h = signV4(
      {
        method: 'PUT',
        path: '/test$file.text',
        headers: {
          host: 'examplebucket.s3.amazonaws.com',
          date: 'Fri, 24 May 2013 00:00:00 GMT',
          'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        },
        payloadHash: createHash('sha256').update(body).digest('hex'),
      },
      AWS_EXAMPLE,
      EXAMPLE_DATE,
    );
    expect(signature(h)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('matches the S3 documentation: GET bucket lifecycle and list objects', () => {
    const host = { host: 'examplebucket.s3.amazonaws.com' };
    const lifecycle = signV4(
      { method: 'GET', path: '/', query: [['lifecycle', '']], headers: host, payloadHash: EMPTY },
      AWS_EXAMPLE,
      EXAMPLE_DATE,
    );
    expect(signature(lifecycle)).toBe(
      'fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543',
    );
    const list = signV4(
      {
        method: 'GET',
        path: '/',
        query: [
          ['prefix', 'J'],
          ['max-keys', '2'],
        ],
        headers: host,
        payloadHash: EMPTY,
      },
      AWS_EXAMPLE,
      EXAMPLE_DATE,
    );
    expect(signature(list)).toBe(
      '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7',
    );
  });

  it('percent-encodes like RFC 3986', () => {
    expect(uriEncode("a b!'()*~._-")).toBe('a%20b%21%27%28%29%2A~._-');
  });
});

/**
 * A fake S3 endpoint as a fetch function. It re-derives the signature from the request it
 * actually received, so a mismatch between what was signed and what was sent fails the test.
 */
function fakeS3(opts: { bucket: string; pathStyle: boolean; credentials: Credentials }) {
  const objects = new Map<string, Uint8Array>();
  const calls: string[] = [];
  let failNext = 0;

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    const body =
      init.body === undefined || init.body === null
        ? new Uint8Array()
        : new Uint8Array(init.body as Uint8Array);
    calls.push(`${method} ${url.pathname}${url.search}`);
    if (failNext > 0) {
      failNext -= 1;
      return new Response('<Error><Code>InternalError</Code></Error>', { status: 500 });
    }

    expect(headers.get('x-amz-content-sha256')).toBe(
      createHash('sha256').update(body).digest('hex'),
    );
    const auth = headers.get('authorization')!;
    const signed = /SignedHeaders=([^,]+)/.exec(auth)![1]!.split(';');
    const toSign: Record<string, string> = {};
    for (const name of signed) {
      if (name === 'x-amz-date' || name === 'x-amz-content-sha256') continue;
      toSign[name] = name === 'host' ? url.host : headers.get(name)!;
    }
    const stamp = headers.get('x-amz-date')!;
    const date = new Date(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
    );
    const expected = signV4(
      {
        method,
        path: url.pathname.split('/').map(decodeURIComponent).join('/'),
        query: [...url.searchParams.entries()],
        headers: toSign,
        payloadHash: headers.get('x-amz-content-sha256')!,
      },
      opts.credentials,
      date,
    );
    expect(auth).toBe(expected.authorization);

    if (opts.pathStyle) {
      expect(url.host).toBe('s3.example.eu');
      expect(url.pathname.startsWith(`/${opts.bucket}`)).toBe(true);
    } else {
      expect(url.host).toBe(`${opts.bucket}.s3.example.eu`);
    }
    const rawPath = opts.pathStyle ? url.pathname.slice(opts.bucket.length + 1) : url.pathname;
    const key = decodeURIComponent(rawPath.replace(/^\//, ''));

    if (key === '' && method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      // Like S3, a continuation token resumes after the last key returned, so deleting the
      // objects of one page does not shift the next.
      const after = url.searchParams.get('continuation-token');
      const rest = after === null ? all : all.filter((k) => k > after);
      const page = rest.slice(0, 2); // tiny pages to exercise pagination
      const truncated = rest.length > 2;
      return new Response(
        `<ListBucketResult>${page.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}` +
          `<IsTruncated>${truncated}</IsTruncated>` +
          (truncated ? `<NextContinuationToken>${page.at(-1)}</NextContinuationToken>` : '') +
          '</ListBucketResult>',
      );
    }
    if (key === '' && method === 'POST' && url.searchParams.has('delete')) {
      expect(headers.get('content-md5')).toBe(createHash('md5').update(body).digest('base64'));
      const xml = new TextDecoder().decode(body);
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) objects.delete(m[1]!);
      return new Response('<DeleteResult></DeleteResult>');
    }
    if (method === 'PUT') {
      objects.set(key, body);
      return new Response(null, { status: 200 });
    }
    if (method === 'GET') {
      const data = objects.get(key);
      return data === undefined ? new Response('<Error/>', { status: 404 }) : new Response(data);
    }
    if (method === 'DELETE') {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  };
  return {
    objects,
    calls,
    fetch: fetchImpl as typeof fetch,
    failNext(n: number) {
      failNext = n;
    },
  };
}

async function exerciseStore(store: BlobStore) {
  await store.put('u/alice/rec/1-a', new Uint8Array([1, 2, 3]));
  await store.put('u/alice/rec/2-b', new Uint8Array([4]));
  await store.put('u/alice/other/1-c', new Uint8Array([5]));
  await store.put('u/bob/rec/1-d', new Uint8Array([6]));
  expect(await store.get('u/alice/rec/1-a')).toEqual(new Uint8Array([1, 2, 3]));
  expect(await store.get('u/alice/missing')).toBeNull();
  await store.delete('u/alice/rec/2-b');
  await store.delete('u/alice/rec/2-b'); // idempotent
  expect(await store.get('u/alice/rec/2-b')).toBeNull();
  await store.deletePrefix('u/alice/');
  expect(await store.get('u/alice/rec/1-a')).toBeNull();
  expect(await store.get('u/alice/other/1-c')).toBeNull();
  expect(await store.get('u/bob/rec/1-d')).toEqual(new Uint8Array([6]));
}

describe('s3BlobStore', () => {
  const credentials: Credentials = {
    accessKeyId: 'TESTKEY',
    secretAccessKey: 'test-secret',
    region: 'eu-central-1',
  };

  for (const pathStyle of [false, true]) {
    it(`stores, lists and deletes with ${pathStyle ? 'path-style' : 'virtual-hosted'} URLs`, async () => {
      const fake = fakeS3({ bucket: 'opentiles-sync', pathStyle, credentials });
      const store = s3BlobStore({
        endpoint: 'https://s3.example.eu',
        region: credentials.region,
        bucket: 'opentiles-sync',
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        forcePathStyle: pathStyle,
        fetch: fake.fetch,
      });
      await exerciseStore(store);
    });
  }

  it('prefixes keys and many objects are removed in pages', async () => {
    const fake = fakeS3({ bucket: 'b', pathStyle: true, credentials });
    const store = s3BlobStore({
      endpoint: 'https://s3.example.eu',
      region: credentials.region,
      bucket: 'b',
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      forcePathStyle: true,
      prefix: 'prod/',
      fetch: fake.fetch,
    });
    for (let i = 0; i < 7; i++) await store.put(`u/carol/r${i}/1-x`, new Uint8Array([i]));
    expect([...fake.objects.keys()].every((k) => k.startsWith('prod/u/carol/'))).toBe(true);
    await store.deletePrefix('u/carol/');
    expect(fake.objects.size).toBe(0);
    expect(fake.calls.filter((c) => c.includes('list-type=2'))).toHaveLength(4);
    expect(fake.calls.filter((c) => c.startsWith('POST'))).toHaveLength(4);
  });

  it('surfaces storage errors without echoing the response body', async () => {
    const fake = fakeS3({ bucket: 'b', pathStyle: true, credentials });
    const store = s3BlobStore({
      endpoint: 'https://s3.example.eu',
      region: credentials.region,
      bucket: 'b',
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      forcePathStyle: true,
      fetch: fake.fetch,
    });
    fake.failNext(1);
    const error = await store.put('u/x/y', new Uint8Array([1])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(S3Error);
    expect((error as S3Error).message).toBe('S3 put failed with HTTP 500');
  });
});

describe('filesystem and memory stores', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'opentiles-blobs-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('fsBlobStore behaves like object storage and leaves no temp files', async () => {
    await exerciseStore(fsBlobStore(dir));
    expect(await readdir(join(dir, 'u'))).toEqual(['bob']);
    expect(await readdir(join(dir, 'u', 'bob', 'rec'))).toEqual(['1-d']);
  });

  it('memoryBlobStore behaves the same', async () => {
    await exerciseStore(memoryBlobStore());
  });

  it('rejects keys that could escape the store', async () => {
    for (const key of ['../etc/passwd', 'u/../../x', '/abs', 'u//x', 'u/x y', 'u/.']) {
      expect(() => assertKey(key), key).toThrow();
    }
    await expect(fsBlobStore(dir).put('u/../../escape', new Uint8Array([1]))).rejects.toThrow();
  });
});
