// Where encrypted blob bytes live. The service only ever hands these adapters ciphertext.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';

export interface BlobStore {
  put(key: string, data: Uint8Array): Promise<void>;
  /** Null when the object does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Succeeds when the object is already gone. */
  delete(key: string): Promise<void>;
  /** Removes every object whose key starts with `prefix` (which ends in "/"). */
  deletePrefix(prefix: string): Promise<void>;
}

const KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\/?$/;

/** Keys are built by the service from random ids; this guards against mistakes, not users. */
export function assertKey(key: string): void {
  if (!KEY.test(key) || key.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error('Invalid object key');
  }
}

/** In-memory store for tests and local experiments. */
export function memoryBlobStore(): BlobStore & { keys(): string[] } {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(key, data) {
      assertKey(key);
      objects.set(key, data.slice());
    },
    async get(key) {
      assertKey(key);
      return objects.get(key)?.slice() ?? null;
    },
    async delete(key) {
      assertKey(key);
      objects.delete(key);
    },
    async deletePrefix(prefix) {
      assertKey(prefix);
      for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key);
    },
    keys() {
      return [...objects.keys()].sort();
    },
  };
}

/** Plain files under `root`, for development and tests. Writes are atomic (temp file + rename). */
export function fsBlobStore(root: string): BlobStore {
  const base = resolve(root);
  const pathFor = (key: string) => {
    assertKey(key);
    const path = resolve(base, ...key.split('/').filter(Boolean));
    if (path !== base && !path.startsWith(base + sep)) throw new Error('Invalid object key');
    return path;
  };
  return {
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      const tmp = join(dirname(path), `.tmp-${randomBytes(8).toString('hex')}`);
      await writeFile(tmp, data);
      await rename(tmp, path);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
    async deletePrefix(prefix) {
      if (!prefix.endsWith('/')) throw new Error('A prefix must end with "/"');
      await rm(pathFor(prefix), { recursive: true, force: true });
    },
  };
}
