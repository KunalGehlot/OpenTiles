// State of a waiting service-worker update, kept outside React so the registration code (which
// runs before the first render) and the update bar can share it via useSyncExternalStore.

/**
 * `idle`: nothing to do. `available`: a new version is installed and waiting. `dismissed`: the
 * user closed the bar; it stays closed for this page load (no nagging) and the new version takes
 * over the next time the app is opened. `applying`: the user asked to reload.
 */
export type UpdateStatus = 'idle' | 'available' | 'dismissed' | 'applying';

export interface UpdateStore {
  getSnapshot(): UpdateStatus;
  subscribe(listener: () => void): () => void;
  /** Called by the registration when a new version is waiting; `apply` activates it and reloads. */
  offer(apply: () => Promise<void>): void;
  dismiss(): void;
  apply(): Promise<void>;
}

export function createUpdateStore(): UpdateStore {
  let status: UpdateStatus = 'idle';
  let applyUpdate: (() => Promise<void>) | null = null;
  const listeners = new Set<() => void>();
  const set = (next: UpdateStatus) => {
    if (next === status) return;
    status = next;
    for (const l of listeners) l();
  };
  return {
    getSnapshot: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    offer(apply) {
      applyUpdate = apply;
      // A second "waiting" event after a dismissal must not bring the bar back.
      if (status === 'idle') set('available');
    },
    dismiss() {
      if (status === 'available') set('dismissed');
    },
    async apply() {
      if (!applyUpdate || status === 'applying') return;
      set('applying');
      try {
        await applyUpdate();
      } catch {
        // The page normally reloads once the new worker takes control; if that fails, let the
        // user try again rather than leaving a dead button.
        set('available');
      }
    },
  };
}

/** The app-wide store used by src/pwa/register.ts and <UpdateBar />. */
export const updates = createUpdateStore();

/** How often a long-running app (an iPad Home Screen app can stay open for days) looks for updates. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function shouldCheckForUpdate(now: number, lastCheck: number, online: boolean): boolean {
  return online && now - lastCheck >= UPDATE_CHECK_INTERVAL_MS;
}
