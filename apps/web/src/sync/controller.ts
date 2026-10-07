// The app's one sync controller, created only when the build has a sync server (VITE_SYNC_URL).
import { useSyncExternalStore } from 'react';
import { syncServerUrl } from './config';
import { SyncController } from './local';
import type { SyncState } from './local';

let controller: SyncController | null | undefined;
let started: Promise<void> | null = null;

export function getSyncController(): SyncController | null {
  if (controller === undefined) {
    const url = syncServerUrl();
    controller = url === null ? null : new SyncController({ baseUrl: url });
  }
  return controller;
}

/** Restores a saved sync session and starts automatic sync. Does nothing without a server. */
export function startSync(): Promise<void> {
  const c = getSyncController();
  if (c === null) return Promise.resolve();
  started ??= c.init().then(() => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') c.onVisible();
    });
  });
  return started;
}

const OFF: SyncState = {
  phase: 'signed-out',
  email: null,
  accountHasVault: null,
  auto: false,
  busy: false,
  lastSync: null,
};
const noop = () => () => {};
const off = () => OFF;

export function useSyncState(): SyncState {
  const c = getSyncController();
  return useSyncExternalStore(c?.subscribe ?? noop, c?.getState ?? off, c?.getState ?? off);
}
