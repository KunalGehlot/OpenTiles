// Service settings. Defaults follow spec §10: 250 MB per user, sign-in by passkey or email link.

export interface CrashReportConfig {
  enabled: boolean;
  /** Largest accepted report body in bytes. */
  maxBytes: number;
  /** Reports older than this are deleted by the maintenance job. */
  retentionDays: number;
  perClientPerHour: number;
  globalPerHour: number;
}

export interface Config {
  /** Origins of the web app. CORS allows only these; passkeys are bound to them. */
  appOrigins: string[];
  /** WebAuthn relying-party id: the app's registrable domain, e.g. `opentiles.org`. */
  rpId: string;
  rpName: string;
  /** Sign-in link with a `{token}` placeholder. The token sits in the fragment by default so it
   * never reaches the static host's logs. */
  magicLinkUrl: string;
  quotaBytes: number;
  maxBlobBytes: number;
  maxBlobs: number;
  maxKeyBundleBytes: number;
  maxPasskeys: number;
  sessionTtlMs: number;
  emailTokenTtlMs: number;
  challengeTtlMs: number;
  /** Read the client address from X-Forwarded-For (only behind a trusted reverse proxy). The
   * address is used for in-memory rate limiting and is never stored. */
  trustProxy: boolean;
  crashReports: CrashReportConfig;
}

export const MB = 1000 * 1000;
const DAY = 24 * 60 * 60 * 1000;

export function makeConfig(overrides: Partial<Config> & { appOrigins: string[] }): Config {
  const primary = overrides.appOrigins[0];
  if (primary === undefined) throw new Error('At least one app origin is required');
  const host = new URL(primary).hostname;
  return {
    rpId: host,
    rpName: 'OpenTiles',
    magicLinkUrl: `${primary}/sync/sign-in#token={token}`,
    quotaBytes: 250 * MB,
    maxBlobBytes: 32 * MB,
    maxBlobs: 100_000,
    maxKeyBundleBytes: 16 * 1024,
    maxPasskeys: 20,
    sessionTtlMs: 90 * DAY,
    emailTokenTtlMs: 15 * 60 * 1000,
    challengeTtlMs: 5 * 60 * 1000,
    trustProxy: false,
    ...overrides,
    crashReports: {
      enabled: true,
      maxBytes: 16 * 1024,
      retentionDays: 30,
      perClientPerHour: 10,
      globalPerHour: 1000,
      ...overrides.crashReports,
    },
  };
}

export type StorageSettings =
  | { kind: 'fs'; root: string }
  | {
      kind: 's3';
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      forcePathStyle: boolean;
      prefix: string;
    };

export type MailerSettings =
  | { kind: 'console' }
  | { kind: 'smtp'; url: string; from: string }
  | { kind: 'http'; url: string; token: string; from: string };

export interface ServerSettings {
  port: number;
  host: string;
  databasePath: string;
  storage: StorageSettings;
  mailer: MailerSettings;
  config: Config;
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} must be set`);
  return value.trim();
}

function number(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function flag(env: Record<string, string | undefined>, name: string, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`${name} must be true or false`);
}

/** Reads settings from environment variables; see apps/sync-api/.env.example. */
export function settingsFromEnv(env: Record<string, string | undefined>): ServerSettings {
  const production = env.NODE_ENV === 'production';
  const appOrigins = required(env, 'APP_ORIGIN')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of appOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin) throw new Error(`APP_ORIGIN entry ${origin} is not a bare origin`);
    if (production && url.protocol !== 'https:') {
      throw new Error('APP_ORIGIN must use https in production');
    }
  }

  const storageKind = (env.STORAGE ?? 'fs').trim();
  let storage: StorageSettings;
  if (storageKind === 'fs') {
    storage = { kind: 'fs', root: env.FS_ROOT?.trim() || './data/blobs' };
  } else if (storageKind === 's3') {
    storage = {
      kind: 's3',
      endpoint: required(env, 'S3_ENDPOINT'),
      region: required(env, 'S3_REGION'),
      bucket: required(env, 'S3_BUCKET'),
      accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
      forcePathStyle: flag(env, 'S3_FORCE_PATH_STYLE', false),
      prefix: env.S3_PREFIX?.trim() ?? '',
    };
  } else {
    throw new Error('STORAGE must be fs or s3');
  }

  const mailerKind = (env.MAILER ?? 'console').trim();
  let mailer: MailerSettings;
  if (mailerKind === 'console') {
    if (production) throw new Error('MAILER=console prints sign-in links; not for production');
    mailer = { kind: 'console' };
  } else if (mailerKind === 'smtp') {
    mailer = { kind: 'smtp', url: required(env, 'SMTP_URL'), from: required(env, 'MAIL_FROM') };
  } else if (mailerKind === 'http') {
    mailer = {
      kind: 'http',
      url: required(env, 'HTTP_MAILER_URL'),
      token: required(env, 'HTTP_MAILER_TOKEN'),
      from: required(env, 'MAIL_FROM'),
    };
  } else {
    throw new Error('MAILER must be console, smtp or http');
  }

  const base = makeConfig({ appOrigins });
  const config = makeConfig({
    appOrigins,
    rpId: env.RP_ID?.trim() || base.rpId,
    rpName: env.RP_NAME?.trim() || base.rpName,
    magicLinkUrl: env.MAGIC_LINK_URL?.trim() || base.magicLinkUrl,
    quotaBytes: number(env, 'QUOTA_BYTES', base.quotaBytes),
    maxBlobBytes: number(env, 'MAX_BLOB_BYTES', base.maxBlobBytes),
    maxBlobs: number(env, 'MAX_BLOBS', base.maxBlobs),
    trustProxy: flag(env, 'TRUST_PROXY', false),
    crashReports: {
      ...base.crashReports,
      enabled: flag(env, 'CRASH_REPORTS', true),
      retentionDays: number(env, 'CRASH_RETENTION_DAYS', base.crashReports.retentionDays),
    },
  });
  if (!config.magicLinkUrl.includes('{token}')) {
    throw new Error('MAGIC_LINK_URL must contain {token}');
  }

  return {
    port: number(env, 'PORT', 8787),
    host: env.HOST?.trim() || '0.0.0.0',
    databasePath: env.DATABASE_PATH?.trim() || './data/sync.db',
    storage,
    mailer,
    config,
  };
}
