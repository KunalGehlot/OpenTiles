// Scrubbing for opt-in crash reports (P3-08). A report may hold the error message, a stack trace
// of the app's own code and a few coarse facts; never a title, a file name, a library id or a
// link that points at a user's data. `scrubText` from sync-client removes email addresses and
// tokens; this adds what only the app knows about. The server scrubs again.
import { buildCrashReport, scrubText, type CrashReportInput } from '@opentiles/sync-client';

export interface SensitiveStrings {
  /** Titles and file names in this device's library; matched case-insensitively. */
  names: readonly string[];
}

const FILE_EXTENSIONS =
  'musicxml|mxl|xml|mid|midi|kar|mscz|mscx|abc|wav|mp3|m4a|aac|flac|ogg|oga|opus|webm|pdf|png|jpe?g|zip';
const FILE_NAME = new RegExp(
  String.raw`(?:[\w\-.()~+&]|[^\x00-\x7f\s])+\.(?:${FILE_EXTENSIONS})\b`,
  'giu',
);
const BLOB_URL = /\bblob:[^\s)"'<>]+/gi;
const DATA_URL = /\bdata:[^\s)"'<>]+/gi;
/** Hash routes that carry an id: #/practice/library/12, #/sign-in/<token>, ... */
const ID_ROUTE = /#\/(practice\/(?:library|catalogue|drill)|sign-in|sync\/sign-in)\/[^\s)"'<>:]+/gi;
const ANY_FRAGMENT = /#[^\s)"'<>/][^\s)"'<>]*/g;
const QUERY = /\?[^\s)"'<>#:]+/g;
/** Text in quotes in a message is usually data (a title, a value), not code. */
const QUOTED = /“[^”]{1,200}”|"[^"\n]{1,200}"|‘[^’]{1,200}’/g;
const LONG_ID = /\b[A-Za-z0-9_-]{24,}\b/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes anything that could name the user's music or point at their data. Script locations
 * (`https://app.example/assets/index-abc.js:12:3`) are reduced to the path within the app.
 */
export function scrubCrashText(
  text: string,
  sensitive: SensitiveStrings = { names: [] },
  origin = '',
): string {
  let out = text;
  // Longest first, so a title that contains another is removed whole.
  const names = [
    ...new Set(sensitive.names.map((n) => n.trim()).filter((n) => n.length >= 2)),
  ].sort((a, b) => b.length - a.length);
  for (const name of names) {
    out = out.replace(new RegExp(escapeRegExp(name), 'gi'), '[title]');
  }
  out = scrubText(out)
    .replace(BLOB_URL, '[blob-url]')
    .replace(DATA_URL, '[data-url]')
    .replace(ID_ROUTE, (_m, route: string) => `#/${route.toLowerCase()}/[id]`)
    .replace(ANY_FRAGMENT, (m) => (m.startsWith('#/') ? m : '#[removed]'))
    .replace(QUERY, '?[removed]')
    .replace(FILE_NAME, '[file]')
    .replace(QUOTED, '"[text]"')
    .replace(LONG_ID, '[id]');
  if (origin) out = out.split(origin).join('');
  return out;
}

export interface CrashMeta {
  app: string;
  version: string;
  platform?: string;
  context?: Record<string, string | number | boolean>;
}

/** Builds a report from an error and scrubs every free-text field. */
export function buildScrubbedReport(
  error: unknown,
  meta: CrashMeta,
  sensitive: SensitiveStrings,
  origin = '',
): CrashReportInput {
  const report = buildCrashReport(error, meta);
  const clean: CrashReportInput = {
    ...report,
    message: scrubCrashText(report.message, sensitive, origin).slice(0, 1000),
  };
  if (report.stack !== undefined) {
    clean.stack = scrubCrashText(report.stack, sensitive, origin).slice(0, 8000);
  }
  return clean;
}

/** A coarse platform label: browser family and OS, no versions beyond the major one. */
export function coarsePlatform(userAgent: string, touchPoints = 0): string {
  const os =
    /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(userAgent)
            ? 'macOS'
            : /Linux|CrOS/.test(userAgent)
              ? 'Linux'
              : 'other';
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\/|CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'other';
  return `${os} / ${browser}`;
}
