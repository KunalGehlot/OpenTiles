// Thin client for the sync service (apps/sync-api). It only ever uploads ciphertext: blob uploads
// must carry the vault's sealed-record header, and the key bundle must parse as a wrapped bundle.
import { parseKeyBundle, type KeyBundle } from '@opentiles/vault';
import { QuotaExceededError, SyncApiError, VersionConflictError } from './errors';

/** Opaque WebAuthn JSON, passed between the browser's passkey API and the service unchanged. */
export type WebAuthnJson = Record<string, unknown>;

export interface Session {
  token: string;
  /** ISO 8601. */
  expiresAt: string;
  /** True when this sign-in created the account. */
  created?: boolean;
}

export interface Change {
  id: string;
  version: number;
  seq: number;
  size: number;
  deleted: boolean;
}

export interface ChangesPage {
  changes: Change[];
  cursor: number;
  more: boolean;
}

export interface AccountInfo {
  email: string;
  createdAt: string;
  usage: { bytes: number; records: number };
  quota: { bytes: number; records: number };
  passkeys: { id: string; createdAt: string; lastUsedAt: string | null; backedUp: boolean }[];
}

export type RemoteBlob =
  { deleted: false; version: number; bytes: Uint8Array } | { deleted: true; version: number };

export interface CrashReportInput {
  app: string;
  version: string;
  message: string;
  stack?: string;
  platform?: string;
  context?: Record<string, string | number | boolean>;
}

export interface SyncApiOptions {
  /** e.g. `https://sync.opentiles.example` */
  baseUrl: string;
  fetch?: typeof fetch;
  token?: string | null;
}

const SEALED_MAGIC = [0x4f, 0x54, 0x52, 0x01];

function isSealed(bytes: Uint8Array): boolean {
  return SEALED_MAGIC.every((b, i) => bytes[i] === b);
}

function preconditionHeaders(baseVersion: number): Record<string, string> {
  return baseVersion === 0 ? { 'if-none-match': '*' } : { 'if-match': `"${baseVersion}"` };
}

export type SyncApi = ReturnType<typeof createSyncApi>;

export function createSyncApi(options: SyncApiOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  let token = options.token ?? null;

  async function call(
    path: string,
    init: {
      method?: string;
      headers?: Record<string, string>;
      body?: BodyInit;
      auth?: boolean;
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...init.headers };
    if (init.auth !== false) {
      if (token === null) throw new SyncApiError(401, 'unauthorised', 'Please sign in.');
      headers.authorization = `Bearer ${token}`;
    }
    const res = await doFetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body,
    });
    if (res.ok) return res;
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      // Not JSON (a proxy error page, for example).
    }
    const code = typeof body.error === 'string' ? body.error : `http-${res.status}`;
    const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`;
    if (res.status === 412) {
      const current = (body.current ?? {}) as { version?: unknown; deleted?: unknown };
      throw new VersionConflictError(message, {
        version: typeof current.version === 'number' ? current.version : 0,
        deleted: current.deleted === true,
      });
    }
    if (res.status === 507) throw new QuotaExceededError(code, message);
    if (res.status === 401 && init.auth !== false) token = null;
    throw new SyncApiError(res.status, code, message, body);
  }

  const json = (body: unknown) => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  async function session(res: Response): Promise<Session> {
    const s = (await res.json()) as Session;
    token = s.token;
    return s;
  }

  return {
    get token(): string | null {
      return token;
    },
    setToken(value: string | null): void {
      token = value;
    },

    // Sign-in ---------------------------------------------------------------------------------

    async startEmailSignIn(email: string): Promise<void> {
      await call('/v1/auth/email/start', { method: 'POST', auth: false, ...json({ email }) });
    },

    /** Finishes with the token from the link, or with the address and the typed code. */
    async finishEmailSignIn(proof: { token: string } | { email: string; code: string }) {
      const res = await call('/v1/auth/email/verify', {
        method: 'POST',
        auth: false,
        ...json(proof),
      });
      return session(res);
    },

    async passkeyLoginOptions(): Promise<{ challengeId: string; options: WebAuthnJson }> {
      const res = await call('/v1/auth/passkey/options', { method: 'POST', auth: false });
      return (await res.json()) as { challengeId: string; options: WebAuthnJson };
    },

    async finishPasskeyLogin(challengeId: string, response: WebAuthnJson): Promise<Session> {
      const res = await call('/v1/auth/passkey/verify', {
        method: 'POST',
        auth: false,
        ...json({ challengeId, response }),
      });
      return session(res);
    },

    async passkeyRegistrationOptions(): Promise<{ challengeId: string; options: WebAuthnJson }> {
      const res = await call('/v1/passkeys/options', { method: 'POST' });
      return (await res.json()) as { challengeId: string; options: WebAuthnJson };
    },

    async addPasskey(challengeId: string, response: WebAuthnJson): Promise<{ id: string }> {
      const res = await call('/v1/passkeys', {
        method: 'POST',
        ...json({ challengeId, response }),
      });
      return (await res.json()) as { id: string };
    },

    async removePasskey(id: string): Promise<void> {
      await call(`/v1/passkeys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    async signOut(): Promise<void> {
      if (token === null) return;
      try {
        await call('/v1/auth/sign-out', { method: 'POST' });
      } finally {
        token = null;
      }
    },

    // Account ---------------------------------------------------------------------------------

    async account(): Promise<AccountInfo> {
      return (await (await call('/v1/account')).json()) as AccountInfo;
    },

    /** Deletes the account and every blob in one step. */
    async deleteAccount(): Promise<void> {
      await call('/v1/account', { method: 'DELETE' });
      token = null;
    },

    // Wrapped key -----------------------------------------------------------------------------

    async getKeyBundle(): Promise<{ version: number; bundle: KeyBundle } | null> {
      try {
        const res = await call('/v1/keys');
        const body = (await res.json()) as { version: number; bundle: unknown };
        return { version: body.version, bundle: parseKeyBundle(body.bundle) };
      } catch (error) {
        if (error instanceof SyncApiError && error.status === 404) return null;
        throw error;
      }
    },

    /** `baseVersion` 0 creates the bundle; otherwise it must match the stored version. */
    async putKeyBundle(bundle: KeyBundle, baseVersion: number): Promise<{ version: number }> {
      // Re-validate so nothing but a wrapped key bundle can go up this way.
      const checked = parseKeyBundle(bundle);
      const res = await call('/v1/keys', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', ...preconditionHeaders(baseVersion) },
        body: JSON.stringify({ bundle: checked }),
      });
      return (await res.json()) as { version: number };
    },

    // Blobs -----------------------------------------------------------------------------------

    async changes(since: number, limit = 500): Promise<ChangesPage> {
      const res = await call(`/v1/changes?since=${since}&limit=${limit}`);
      return (await res.json()) as ChangesPage;
    },

    /** Null when the record does not exist. */
    async getBlob(id: string): Promise<RemoteBlob | null> {
      try {
        const res = await call(`/v1/blobs/${encodeURIComponent(id)}`);
        const version = Number(res.headers.get('x-blob-version'));
        if (!Number.isSafeInteger(version) || version < 1) {
          throw new SyncApiError(502, 'bad-response', 'The server sent no record version.');
        }
        return { deleted: false, version, bytes: new Uint8Array(await res.arrayBuffer()) };
      } catch (error) {
        if (error instanceof SyncApiError && error.status === 404) return null;
        if (error instanceof SyncApiError && error.status === 410) {
          const version = error.details.version;
          return {
            deleted: true,
            version: typeof version === 'number' && Number.isSafeInteger(version) ? version : 0,
          };
        }
        throw error;
      }
    },

    /** Uploads an encrypted record. Refuses anything without the vault's sealed-record header. */
    async putBlob(
      id: string,
      sealed: Uint8Array<ArrayBuffer>,
      baseVersion: number,
    ): Promise<{ version: number; seq: number }> {
      if (!isSealed(sealed)) {
        throw new Error('Refusing to upload data that is not an encrypted OpenTiles record');
      }
      const res = await call(`/v1/blobs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          ...preconditionHeaders(baseVersion),
        },
        body: sealed,
      });
      return (await res.json()) as { version: number; seq: number };
    },

    async deleteBlob(id: string, baseVersion: number): Promise<{ version: number; seq: number }> {
      const res = await call(`/v1/blobs/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'if-match': `"${baseVersion}"` },
      });
      return (await res.json()) as { version: number; seq: number };
    },

    // Crash reports ---------------------------------------------------------------------------

    /** Sends an anonymous crash report. Call only after the user has opted in. */
    async sendCrashReport(report: CrashReportInput): Promise<void> {
      await call('/v1/crash', { method: 'POST', auth: false, ...json(report) });
    },
  };
}
