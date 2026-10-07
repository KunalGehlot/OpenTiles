// Local sync state. The web app implements `SyncStore` on IndexedDB; `MemorySyncStore` is the
// reference implementation used in tests.

/** One synced record in plaintext, as the device sees it. Encrypted as a whole before upload. */
export interface SyncRecord {
  /** Opaque random id (see `newRecordId`). Never derived from a title or file name. */
  id: string;
  /** What the record holds, e.g. `library`, `progress`, `setting`. Encrypted like the rest. */
  kind: string;
  /** Plain data (JSON values and `Uint8Array`s); null once deleted. */
  data: unknown;
  deleted: boolean;
  /** Hybrid-clock time of the last change, used for last-writer-wins. */
  modifiedAt: number;
  /** The device that made the last change; breaks ties. */
  deviceId: string;
}

export interface StoredRecord {
  record: SyncRecord;
  /** The server version this copy is based on; 0 when it was never uploaded. */
  version: number;
  /** True while a local change waits to be uploaded. */
  pending: boolean;
}

export interface SyncStore {
  get(id: string): Promise<StoredRecord | undefined>;
  put(entry: StoredRecord): Promise<void>;
  /** Every entry with `pending: true`. */
  pending(): Promise<StoredRecord[]>;
  /** Position in the server's change log; 0 before the first sync. */
  getCursor(): Promise<number>;
  setCursor(cursor: number): Promise<void>;
}

function clone(entry: StoredRecord): StoredRecord {
  return { ...entry, record: { ...entry.record } };
}

export class MemorySyncStore implements SyncStore {
  private readonly entries = new Map<string, StoredRecord>();
  private cursor = 0;

  async get(id: string): Promise<StoredRecord | undefined> {
    const e = this.entries.get(id);
    return e === undefined ? undefined : clone(e);
  }

  async put(entry: StoredRecord): Promise<void> {
    this.entries.set(entry.record.id, clone(entry));
  }

  async pending(): Promise<StoredRecord[]> {
    return [...this.entries.values()].filter((e) => e.pending).map(clone);
  }

  async getCursor(): Promise<number> {
    return this.cursor;
  }

  async setCursor(cursor: number): Promise<void> {
    this.cursor = cursor;
  }

  /** Live (not deleted) records, for tests and simple callers. */
  records(): SyncRecord[] {
    return [...this.entries.values()]
      .filter((e) => !e.record.deleted)
      .map((e) => ({ ...e.record }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
}
