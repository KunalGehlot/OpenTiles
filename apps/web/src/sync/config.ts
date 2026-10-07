// The sync server is optional. Builds without VITE_SYNC_URL have no sync and no crash reports, and
// make no requests to any server but their own origin.

export function normaliseServerUrl(value: string | undefined | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  try {
    const url = new URL(v);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
    return url.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function syncServerUrl(): string | null {
  return normaliseServerUrl(import.meta.env.VITE_SYNC_URL as string | undefined);
}
