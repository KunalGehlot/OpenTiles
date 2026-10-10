// Keeping the screen on while practising (P5-02), with a fake Screen Wake Lock API.
import { describe, expect, it } from 'vitest';
import {
  ActivityClock,
  ScreenWakeLock,
  WAKE_IDLE_SECONDS,
  wantsWakeLock,
} from '../src/practice/wake-lock';
import type { WakeLockApi, WakeLockHandle } from '../src/practice/wake-lock';

class FakeHandle implements WakeLockHandle {
  released = false;
  private listeners: (() => void)[] = [];
  release(): Promise<void> {
    if (!this.released) {
      this.released = true;
      for (const l of this.listeners) l();
    }
    return Promise.resolve();
  }
  addEventListener(_type: 'release', listener: () => void): void {
    this.listeners.push(listener);
  }
}

/** A fake API whose requests the test answers by hand. */
function fakeApi() {
  const pending: { resolve: (h: FakeHandle) => void; reject: (e: Error) => void }[] = [];
  const handles: FakeHandle[] = [];
  const api: WakeLockApi = {
    request: () =>
      new Promise<WakeLockHandle>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  };
  const grant = async () => {
    const h = new FakeHandle();
    handles.push(h);
    pending.shift()?.resolve(h);
    await Promise.resolve();
    return h;
  };
  const refuse = async () => {
    pending.shift()?.reject(new DOMException('Not allowed', 'NotAllowedError'));
    await Promise.resolve();
  };
  return { api, pending, handles, grant, refuse };
}

describe('when the screen stays on', () => {
  it('stays on while a run plays, however long ago the last note was', () => {
    expect(wantsWakeLock({ playing: true, lastActivity: 0, now: 3600 })).toBe(true);
  });

  it('stays on for five minutes after the last note, tap or key press', () => {
    expect(wantsWakeLock({ playing: false, lastActivity: 100, now: 100 })).toBe(true);
    expect(wantsWakeLock({ playing: false, lastActivity: 100, now: 99 + WAKE_IDLE_SECONDS })).toBe(
      true,
    );
    expect(wantsWakeLock({ playing: false, lastActivity: 100, now: 100 + WAKE_IDLE_SECONDS })).toBe(
      false,
    );
  });
});

describe('activity', () => {
  it('counts a note when the session clock changes origin', () => {
    // The session's clock is the page's (half an hour in) until sound starts, then the audio
    // clock, which starts near 0. The activity clock is its own.
    const a = new ActivityClock(100, 0);
    expect(a.wanted(100, false, 1800)).toBe(true); // a note on the page clock
    expect(a.wanted(100 + WAKE_IDLE_SECONDS - 1, false, 0.5)).toBe(true); // a note on the audio clock
    expect(a.wanted(100 + 2 * WAKE_IDLE_SECONDS - 2, false, 0.5)).toBe(true);
    // No note since: the screen may sleep five minutes after the last one, not half an hour later.
    expect(a.wanted(100 + 2 * WAKE_IDLE_SECONDS, false, 0.5)).toBe(false);
    expect(a.wanted(100 + 2 * WAKE_IDLE_SECONDS + 1, false, 0.6)).toBe(true);
  });

  it('counts taps and playing runs', () => {
    const a = new ActivityClock(0, 0);
    expect(a.wanted(WAKE_IDLE_SECONDS, false, 0)).toBe(false);
    a.touch(WAKE_IDLE_SECONDS + 10);
    expect(a.wanted(WAKE_IDLE_SECONDS + 20, false, 0)).toBe(true);
    expect(a.wanted(3 * WAKE_IDLE_SECONDS, true, 0)).toBe(true);
    expect(a.wanted(4 * WAKE_IDLE_SECONDS - 1, false, 0)).toBe(true);
    expect(a.wanted(4 * WAKE_IDLE_SECONDS, false, 0)).toBe(false);
  });
});

describe('ScreenWakeLock', () => {
  it('asks once, holds the lock and lets it go', async () => {
    const f = fakeApi();
    const lock = new ScreenWakeLock(f.api, () => true);
    lock.set(true);
    lock.set(true);
    expect(f.pending).toHaveLength(1);
    const handle = await f.grant();
    expect(lock.held).toBe(true);
    lock.set(true);
    expect(f.pending).toHaveLength(0);
    lock.set(false);
    expect(handle.released).toBe(true);
    expect(lock.held).toBe(false);
  });

  it('asks again after the browser drops the lock for a hidden tab', async () => {
    const f = fakeApi();
    let visible = true;
    const lock = new ScreenWakeLock(f.api, () => visible);
    lock.set(true);
    const first = await f.grant();
    visible = false;
    await first.release();
    expect(lock.held).toBe(false);
    lock.set(true);
    expect(f.pending).toHaveLength(0);
    visible = true;
    lock.set(true);
    expect(f.pending).toHaveLength(1);
    await f.grant();
    expect(lock.held).toBe(true);
  });

  it('asks again on the next check after a refusal', async () => {
    const f = fakeApi();
    const lock = new ScreenWakeLock(f.api, () => true);
    lock.set(true);
    await f.refuse();
    expect(lock.held).toBe(false);
    lock.set(true);
    expect(f.pending).toHaveLength(1);
  });

  it('lets a late grant go when the learner stopped or left meanwhile', async () => {
    const f = fakeApi();
    const lock = new ScreenWakeLock(f.api, () => true);
    lock.set(true);
    lock.dispose();
    const handle = await f.grant();
    expect(handle.released).toBe(true);
    expect(lock.held).toBe(false);
    lock.set(true);
    expect(f.pending).toHaveLength(0);
  });

  it('does nothing where the browser has no wake lock or throws', () => {
    expect(() => new ScreenWakeLock(undefined, () => true).set(true)).not.toThrow();
    const throwing: WakeLockApi = {
      request: () => {
        throw new TypeError('not supported');
      },
    };
    const lock = new ScreenWakeLock(throwing, () => true);
    expect(() => lock.set(true)).not.toThrow();
    expect(lock.held).toBe(false);
  });
});
