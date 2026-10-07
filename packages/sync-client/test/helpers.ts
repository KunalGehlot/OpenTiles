import {
  createApp,
  makeConfig,
  memoryBlobStore,
  memoryMailer,
  openDatabase,
  type Config,
} from '@opentiles/sync-api';
import type { Argon2idParams } from '@opentiles/vault';
import { createSyncApi, type SyncApi } from '../src/api';
import { SyncEngine } from '../src/engine';
import { MemorySyncStore, type SyncRecord } from '../src/store';

export const TEST_KDF: Argon2idParams = {
  algorithm: 'argon2id',
  memoryKiB: 256,
  iterations: 1,
  parallelism: 1,
};
export const weakKdf = { kdf: TEST_KDF, unsafeAllowWeakKdf: true } as const;

export interface CapturedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Uint8Array;
}

/** The real sync service, running in this process with in-memory storage. */
export function inProcessServer(overrides: Partial<Omit<Config, 'appOrigins'>> = {}) {
  const config = makeConfig({ appOrigins: ['https://app.opentiles.test'], ...overrides });
  const blobs = memoryBlobStore();
  const mailer = memoryMailer();
  const db = openDatabase(':memory:');
  const sync = createApp({ config, db, blobs, mailer, log: () => undefined });
  const requests: CapturedRequest[] = [];

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    requests.push({
      method: req.method,
      url: req.url,
      headers: Object.fromEntries(req.headers.entries()),
      body: new Uint8Array(await req.clone().arrayBuffer()),
    });
    return sync.app.fetch(req);
  };

  function api(): SyncApi {
    return createSyncApi({
      baseUrl: 'https://sync.opentiles.test/',
      fetch: fetchImpl as typeof fetch,
    });
  }

  /** A signed-in client, via the email link. */
  async function signedIn(email = 'pianist@example.org'): Promise<SyncApi> {
    const client = api();
    await client.startEmailSignIn(email);
    const token = /#token=([\w-]+)/.exec(mailer.sent.at(-1)!.text)![1]!;
    await client.finishEmailSignIn({ token });
    return client;
  }

  return { config, blobs, mailer, db, sync, requests, api, signedIn };
}

/** A device: its own store, clock and engine. */
export function device(
  api: SyncApi,
  key: CryptoKey,
  deviceId: string,
  options: { pageSize?: number } = {},
) {
  let clock = 1_000;
  const store = new MemorySyncStore();
  const seen: SyncRecord[] = [];
  const engine = new SyncEngine({
    api,
    key,
    store,
    deviceId,
    now: () => clock,
    onRemoteChange: (r) => {
      seen.push(r);
    },
    pageSize: options.pageSize,
  });
  return {
    api,
    store,
    engine,
    seen,
    setClock(t: number) {
      clock = t;
    },
  };
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
