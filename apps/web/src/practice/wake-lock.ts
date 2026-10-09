// Keeps the screen on while practising (P5-02). A learner reading the falling notes with both hands on
// the keys cannot tap the screen to stop it dimming. Uses the Screen Wake Lock API; where a browser
// has none (older Safari and Firefox, the iPad app's web view) the screen sleeps as usual, without
// an error.
import { useEffect, useRef } from 'react';

/** Seconds without a note, tap or key press before the screen may sleep again. */
export const WAKE_IDLE_SECONDS = 300;
/** How often the idle time is checked (milliseconds). */
const CHECK_EVERY_MS = 10_000;

/** The part of `navigator.wakeLock` used here. */
export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockHandle>;
}

/** The part of a `WakeLockSentinel` used here. */
export interface WakeLockHandle {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeContext {
  /** A listen or play-along run is playing. */
  playing: boolean;
  /** Clock time of the learner's last note, tap or key press, in seconds. */
  lastActivity: number;
  now: number;
}

/** The screen stays on while a run plays, and for a while after the learner last did something. */
export function wantsWakeLock({ playing, lastActivity, now }: WakeContext): boolean {
  return playing || now - lastActivity < WAKE_IDLE_SECONDS;
}

/**
 * Holds the lock while it is wanted. The browser drops it when the tab is hidden, and may refuse it
 * (battery saver, no recent gesture), so `set(true)` asks again whenever the lock is missing.
 */
export class ScreenWakeLock {
  private wanted = false;
  private handle: WakeLockHandle | null = null;
  private requesting = false;
  private disposed = false;

  constructor(
    private readonly api: WakeLockApi | undefined,
    private readonly visible: () => boolean,
  ) {}

  get held(): boolean {
    return this.handle !== null && !this.handle.released;
  }

  /** Asks for the lock or lets it go. Cheap to call often. */
  set(wanted: boolean): void {
    this.wanted = wanted && !this.disposed;
    if (this.wanted) this.acquire();
    else this.drop();
  }

  dispose(): void {
    this.disposed = true;
    this.set(false);
  }

  private acquire(): void {
    if (!this.api || this.held || this.requesting || !this.visible()) return;
    this.requesting = true;
    let request: Promise<WakeLockHandle>;
    try {
      request = this.api.request('screen');
    } catch {
      this.requesting = false;
      return;
    }
    request.then(
      (handle) => {
        this.requesting = false;
        // Let go at once if the learner stopped or left while the browser was deciding.
        if (!this.wanted) {
          handle.release().catch(() => {});
          return;
        }
        this.handle = handle;
        handle.addEventListener('release', () => {
          if (this.handle === handle) this.handle = null;
        });
      },
      () => {
        // Refused: hidden, battery saver or a permissions policy. The next check asks again.
        this.requesting = false;
      },
    );
  }

  private drop(): void {
    const handle = this.handle;
    this.handle = null;
    if (handle && !handle.released) handle.release().catch(() => {});
  }
}

function browserWakeLock(): WakeLockApi | undefined {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
    ? navigator.wakeLock
    : undefined;
}

/**
 * Keeps the screen on while the practice screen is open and in use. `lastInputAt` is the session
 * clock time of the last note from any input (MIDI notes are not DOM events, so taps and key
 * presses alone would miss them). Leaving the screen lets the screen sleep again.
 */
export function useScreenWakeLock(
  session: { readonly playing: boolean; readonly lastInputAt: number },
  clock: () => number,
  playing: boolean,
): void {
  const update = useRef<() => void>(() => {});

  useEffect(() => {
    const api = browserWakeLock();
    if (!api) return;
    const lock = new ScreenWakeLock(api, () => document.visibilityState === 'visible');
    let lastActivity = clock();
    const check = () => {
      const now = clock();
      if (session.playing) lastActivity = now;
      lock.set(
        wantsWakeLock({
          playing: session.playing,
          lastActivity: Math.max(lastActivity, session.lastInputAt),
          now,
        }),
      );
    };
    const onActivity = () => {
      lastActivity = clock();
      check();
    };
    update.current = check;
    window.addEventListener('pointerdown', onActivity, true);
    window.addEventListener('keydown', onActivity, true);
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, CHECK_EVERY_MS);
    check();
    return () => {
      update.current = () => {};
      window.removeEventListener('pointerdown', onActivity, true);
      window.removeEventListener('keydown', onActivity, true);
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
      lock.dispose();
    };
  }, [session, clock]);

  // Starting or stopping a run takes effect at once, not at the next check.
  useEffect(() => update.current(), [playing]);
}
