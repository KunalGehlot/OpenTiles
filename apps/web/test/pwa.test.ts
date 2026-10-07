import { describe, expect, it, vi } from 'vitest';
import {
  HINT_DISMISSED_KEY,
  deviceName,
  dismissHint,
  isHintDismissed,
  shouldShowHomeScreenHint,
} from '../src/pwa/install-hint';
import {
  UPDATE_CHECK_INTERVAL_MS,
  createUpdateStore,
  shouldCheckForUpdate,
} from '../src/pwa/update-store';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const items = new Map<string, string>();
  return {
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
  };
}

const throwingStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('update store', () => {
  it('offers a waiting update and applies it once', async () => {
    const store = createUpdateStore();
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot()));
    const apply = vi.fn(() => Promise.resolve());
    expect(store.getSnapshot()).toBe('idle');
    store.offer(apply);
    expect(store.getSnapshot()).toBe('available');
    await Promise.all([store.apply(), store.apply()]);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['available', 'applying']);
  });

  it('stays dismissed for the visit, even if the worker reports again', () => {
    const store = createUpdateStore();
    store.offer(() => Promise.resolve());
    store.dismiss();
    expect(store.getSnapshot()).toBe('dismissed');
    store.offer(() => Promise.resolve());
    expect(store.getSnapshot()).toBe('dismissed');
  });

  it('ignores dismiss and apply when nothing is waiting', async () => {
    const store = createUpdateStore();
    store.dismiss();
    await store.apply();
    expect(store.getSnapshot()).toBe('idle');
  });

  it('lets the user retry when activating the update fails', async () => {
    const store = createUpdateStore();
    store.offer(() => Promise.reject(new Error('no worker')));
    await store.apply();
    expect(store.getSnapshot()).toBe('available');
  });

  it('stops notifying after unsubscribe', () => {
    const store = createUpdateStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.offer(() => Promise.resolve());
    expect(listener).not.toHaveBeenCalled();
  });

  it('checks for updates at most hourly and only online', () => {
    const t = 1_000_000_000;
    expect(shouldCheckForUpdate(t + UPDATE_CHECK_INTERVAL_MS, t, true)).toBe(true);
    expect(shouldCheckForUpdate(t + UPDATE_CHECK_INTERVAL_MS - 1, t, true)).toBe(false);
    expect(shouldCheckForUpdate(t + 2 * UPDATE_CHECK_INTERVAL_MS, t, false)).toBe(false);
  });
});

describe('Add to Home Screen hint', () => {
  it('shows only in an iOS browser tab that has not dismissed it', () => {
    expect(
      shouldShowHomeScreenHint({ appleTouch: true, standalone: false, dismissed: false }),
    ).toBe(true);
    expect(shouldShowHomeScreenHint({ appleTouch: true, standalone: true, dismissed: false })).toBe(
      false,
    );
    expect(shouldShowHomeScreenHint({ appleTouch: true, standalone: false, dismissed: true })).toBe(
      false,
    );
    expect(
      shouldShowHomeScreenHint({ appleTouch: false, standalone: false, dismissed: false }),
    ).toBe(false);
  });

  it('remembers the dismissal', () => {
    const storage = memoryStorage();
    expect(isHintDismissed(storage)).toBe(false);
    expect(dismissHint(storage)).toBe(true);
    expect(isHintDismissed(storage)).toBe(true);
    expect(storage.getItem(HINT_DISMISSED_KEY)).toBe('1');
  });

  it('copes with blocked or missing storage', () => {
    expect(isHintDismissed(throwingStorage)).toBe(false);
    expect(dismissHint(throwingStorage)).toBe(false);
    expect(isHintDismissed(null)).toBe(false);
    expect(dismissHint(null)).toBe(false);
  });

  it('names the device', () => {
    expect(
      deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'),
    ).toBe('iPhone');
    expect(
      deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari'),
    ).toBe('iPad');
  });
});
