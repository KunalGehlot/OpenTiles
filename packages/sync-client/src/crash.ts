// Builds an anonymous crash report from an error (P3-08). The app calls this only after the user
// has switched crash reports on; nothing is sent by default.
import type { CrashReportInput } from './api';

// Not one regex: `[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}` takes quadratic time on a long run
// of address characters without an `@`, because every start position scans the whole run. This walks
// the text once and only looks around the `@` signs. Same result as that regex. (The two crash
// scrubbers, here and in apps/sync-api/src/crash.ts, must keep identical behaviour.)
const NOT_ADDRESS_CHAR = /[\s@<>()"',;:]/;
const ASCII_LETTER = /[A-Za-z]/;

function isAddressChar(text: string, i: number): boolean {
  return !NOT_ADDRESS_CHAR.test(text.charAt(i));
}

/** End of the domain's top-level part, given the domain `text[from, end)`, or -1 if it has none. */
function domainEnd(text: string, from: number, end: number): number {
  // The last dot that is followed by two letters and has at least one character before it.
  for (let dot = end - 3; dot > from; dot -= 1) {
    if (text.charAt(dot) !== '.') continue;
    if (!ASCII_LETTER.test(text.charAt(dot + 1)) || !ASCII_LETTER.test(text.charAt(dot + 2))) {
      continue;
    }
    let stop = dot + 3;
    while (stop < end && ASCII_LETTER.test(text.charAt(stop))) stop += 1;
    return stop;
  }
  return -1;
}

function scrubEmails(text: string): string {
  let out = '';
  let copied = 0;
  let at = text.indexOf('@');
  while (at !== -1) {
    let start = at;
    while (start > copied && isAddressChar(text, start - 1)) start -= 1;
    let end = at + 1;
    while (end < text.length && isAddressChar(text, end)) end += 1;
    const stop = start < at ? domainEnd(text, at + 1, end) : -1;
    if (stop !== -1) {
      out += `${text.slice(copied, start)}[email]`;
      copied = stop;
    }
    at = text.indexOf('@', Math.max(at + 1, copied));
  }
  return out + text.slice(copied);
}

const SECRET_PARAM = /\b(token|code|key|secret|password|session|auth)=([^&#\s)"'<>]+)/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** Strips email addresses and secret-looking URL parameters. The server does the same again. */
export function scrubText(text: string): string {
  return scrubEmails(text)
    .replace(SECRET_PARAM, '$1=[removed]')
    .replace(BEARER, 'Bearer [removed]');
}

/**
 * Turns an error into a report. Pass only non-identifying context (input source, mode); never
 * titles, file names or anything from the user's library.
 */
export function buildCrashReport(
  error: unknown,
  meta: {
    app: string;
    version: string;
    platform?: string;
    context?: Record<string, string | number | boolean>;
  },
): CrashReportInput {
  const err = error instanceof Error ? error : new Error(String(error));
  const report: CrashReportInput = {
    app: meta.app,
    version: meta.version,
    message: scrubText(`${err.name}: ${err.message}`).slice(0, 1000),
  };
  if (err.stack) report.stack = scrubText(err.stack).slice(0, 8000);
  if (meta.platform) report.platform = meta.platform.slice(0, 100);
  if (meta.context) report.context = meta.context;
  return report;
}
