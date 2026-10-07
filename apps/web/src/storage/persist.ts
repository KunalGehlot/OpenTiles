// Safari can delete script-written data after seven days without a visit unless the site runs as
// a Home Screen app (spec §5). Ask for persistent storage and nudge iPad users to install.
import { isNativeShell } from '../lib/native-shell';

export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function isAppleTouchDevice(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** True for a Home Screen web app, and in the iPad app, where there is no Home Screen step. */
export function isStandalone(): boolean {
  return (
    isNativeShell() ||
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function shouldSuggestHomeScreen(): boolean {
  return isAppleTouchDevice() && !isStandalone();
}
