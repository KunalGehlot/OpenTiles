// Sends scrubbed crash reports to the sync service's /v1/crash endpoint, only while the user has
// switched crash reports on in Settings (P3-08; off by default). Without a sync server configured
// (VITE_SYNC_URL unset) nothing is ever sent.
import { syncServerUrl } from '../sync/config';
import { appSettings } from '../settings/store';
import { db } from '../storage/db';
// One version for the site and the iPad app (PLAN.md P3-09); Vite keeps only this field.
import { version as APP_VERSION } from '../../package.json';

const MAX_REPORTS_PER_PAGE_LOAD = 5;

let installed = false;
let sent = 0;
const seen = new Set<string>();

/** Every title and file name in the library, removed from crash reports before they are sent. */
export async function libraryNames(): Promise<string[]> {
  try {
    const items = await db.library.toArray();
    return items.flatMap((i) => [
      i.title,
      i.fileName,
      i.song?.title ?? '',
      i.sheet?.fileName ?? '',
    ]);
  } catch {
    return [];
  }
}

export async function reportError(error: unknown, kind: 'error' | 'rejection'): Promise<boolean> {
  const url = syncServerUrl();
  if (url === null || !appSettings().crashReports) return false;
  if (sent >= MAX_REPORTS_PER_PAGE_LOAD) return false;
  // Loaded only when a report is actually sent.
  const [{ buildScrubbedReport, coarsePlatform }, { createSyncApi }] = await Promise.all([
    import('./scrub'),
    import('@opentiles/sync-client'),
  ]);
  const report = buildScrubbedReport(
    error,
    {
      app: 'web',
      version: APP_VERSION,
      platform: coarsePlatform(navigator.userAgent, navigator.maxTouchPoints),
      context: { kind },
    },
    { names: await libraryNames() },
    window.location.origin,
  );
  const signature = `${report.message}\n${report.stack?.slice(0, 300) ?? ''}`;
  if (seen.has(signature)) return false;
  seen.add(signature);
  sent += 1;
  try {
    // A fresh client without a session token: reports are never tied to an account.
    await createSyncApi({ baseUrl: url }).sendCrashReport(report);
    return true;
  } catch {
    return false;
  }
}

/** Listens for uncaught errors. Reports go out only while the setting is on. */
export function installCrashReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    void reportError(e.error ?? e.message, 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    void reportError(e.reason, 'rejection');
  });
}
