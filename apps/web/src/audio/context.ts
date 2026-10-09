// One shared AudioContext. Safari only allows audio to start from a user gesture (spec §5), so
// the context is created and resumed inside click/tap handlers via unlockAudio().
import { t } from '../i18n';

let context: AudioContext | null = null;

export function audioContext(): AudioContext | null {
  return context;
}

/** Call from a user-gesture handler. Returns the running context. */
export async function unlockAudio(): Promise<AudioContext> {
  if (!context) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error(t('This browser does not support Web Audio.'));
    context = new Ctor({ latencyHint: 'interactive' });
  }
  if (context.state !== 'running') await context.resume();
  return context;
}

/** Current time on the audio clock, or performance time when audio hasn't started. */
export function now(): number {
  return context ? context.currentTime : performance.now() / 1000;
}
