// Opt-in anonymous crash reports (P3-08). The app sends one only after the user has switched
// reports on. The server keeps a fixed set of short fields, scrubs anything that looks like an
// email address or a token, stores the time rounded to the hour and never stores the sender's
// address. No account is linked, even when the request carries a session token.

export interface CrashReport {
  /** Which client: `web`, `ios`, ... */
  app: string;
  version: string;
  message: string;
  stack?: string;
  /** Coarse platform, e.g. `iPadOS 18 / Safari`. */
  platform?: string;
  /** A few non-identifying facts (input source, practice mode, ...). */
  context?: Record<string, string | number | boolean>;
}

const LIMITS = {
  app: 32,
  version: 32,
  message: 1000,
  stack: 8000,
  platform: 100,
  contextKeys: 20,
  contextKey: 40,
  contextValue: 200,
};

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}/g;
const SECRET_PARAM = /\b(token|code|key|secret|password|session|auth)=([^&#\s)"'<>]+)/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** Removes things that could identify a person or unlock an account. */
export function scrub(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(SECRET_PARAM, '$1=[removed]')
    .replace(BEARER, 'Bearer [removed]');
}

function shortText(value: unknown, max: number, pattern?: RegExp): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Strip control characters except newlines and tabs, which stack traces use.
  // eslint-disable-next-line no-control-regex
  const cleaned = scrub(value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')).slice(0, max);
  if (pattern !== undefined && !pattern.test(cleaned)) return undefined;
  return cleaned;
}

/** Validates and trims an incoming report. Returns null when required fields are missing. */
export function sanitiseCrashReport(value: unknown): CrashReport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const app = shortText(v.app, LIMITS.app, /^[a-z0-9-]+$/);
  const version = shortText(v.version, LIMITS.version, /^[0-9A-Za-z.+-]+$/);
  const message = shortText(v.message, LIMITS.message);
  if (app === undefined || version === undefined || message === undefined || message === '') {
    return null;
  }
  const report: CrashReport = { app, version, message };
  const stack = shortText(v.stack, LIMITS.stack);
  if (stack) report.stack = stack;
  const platform = shortText(v.platform, LIMITS.platform);
  if (platform) report.platform = platform;
  if (typeof v.context === 'object' && v.context !== null && !Array.isArray(v.context)) {
    const context: Record<string, string | number | boolean> = {};
    let n = 0;
    for (const [key, item] of Object.entries(v.context as Record<string, unknown>)) {
      if (n >= LIMITS.contextKeys) break;
      if (!/^[A-Za-z0-9_.-]+$/.test(key) || key.length > LIMITS.contextKey) continue;
      if (typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) {
        context[key] = item;
      } else if (typeof item === 'string') {
        context[key] = shortText(item, LIMITS.contextValue) ?? '';
      } else {
        continue;
      }
      n += 1;
    }
    if (n > 0) report.context = context;
  }
  return report;
}

/** Rounds a timestamp down to the hour, so report times cannot be matched to other activity. */
export function hourFloor(ms: number): number {
  return ms - (ms % 3_600_000);
}
