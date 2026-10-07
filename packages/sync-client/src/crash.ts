// Builds an anonymous crash report from an error (P3-08). The app calls this only after the user
// has switched crash reports on; nothing is sent by default.
import type { CrashReportInput } from './api';

const EMAIL = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}/g;
const SECRET_PARAM = /\b(token|code|key|secret|password|session|auth)=([^&#\s)"'<>]+)/gi;
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;

/** Strips email addresses and secret-looking URL parameters. The server does the same again. */
export function scrubText(text: string): string {
  return text
    .replace(EMAIL, '[email]')
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
