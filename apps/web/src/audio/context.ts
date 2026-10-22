// One shared AudioContext. Safari only allows audio to start from a user gesture (spec §5), so
// the context is created and resumed inside click/tap handlers via unlockAudio().
import { t } from '../i18n';

let context: AudioContext | null = null;
/** True once the context has run. Until then its clock stands still, so `now()` uses the page's. */
let started = false;
/** How long `unlockAudio` waits for sound to start before going on without it. */
const RESUME_WAIT_MS = 2000;

export function audioContext(): AudioContext | null {
  return context;
}

/**
 * Call from a user-gesture handler. Returns the context, running unless the browser could not
 * start it within a moment: Firefox keeps `resume()` pending while it cannot open a sound device
 * or still blocks audio, and the button that asked for sound must not freeze because of that.
 */
export async function unlockAudio(): Promise<AudioContext> {
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error(t('This browser does not support Web Audio.'));
    context = new Ctor({ latencyHint: 'interactive' });
  }
  if (context.state !== 'running') {
    let timer = 0;
    await Promise.race([
      context.resume(),
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, RESUME_WAIT_MS);
      }),
    ]).finally(() => window.clearTimeout(timer));
  }
  return context;
}

/** True once sound on this device has started: notes scheduled now are heard when they are due. */
export function audioStarted(): boolean {
  if (context && context.state === 'running') started = true;
  return started;
}

/**
 * Current time on the audio clock once it has run, or on the page's clock before: a context that
 * never starts would otherwise stop the falling notes and every run. Once it has run, the audio
 * clock stays the clock, even while iOS interrupts it for a call.
 */
export function now(): number {
  if (context && (started || context.state === 'running')) {
    started = true;
    return context.currentTime;
  }
  return performance.now() / 1000;
}
