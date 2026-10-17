// This device's piano driven on the page's clock (P6-05). The Player keeps time with
// performance.now(), which runs whether or not sound has started; the piano schedules on the audio
// clock. Pure apart from the clocks it is handed, so it is unit-tested in Node.
import type { Instrument, Voice } from '../audio/instrument';

/** The page's clock in seconds: the one the Player and MIDI time stamps use. */
export const pageNow = () => performance.now() / 1000;

/**
 * An instrument on the audio clock, driven with times on the page's clock. The output timestamp
 * pairs the two clocks where it is available (it includes the output latency, so a note sounds at
 * the page time it was meant for); otherwise the current time stands in.
 */
export function onPageClock(inner: Instrument, ctx: BaseAudioContext): Instrument {
  const toAudio = (when: number): number => {
    const ts = (ctx as AudioContext).getOutputTimestamp?.();
    if (ts?.contextTime !== undefined && ts.performanceTime) {
      return ts.contextTime + (when * 1000 - ts.performanceTime) / 1000;
    }
    return ctx.currentTime + (when - pageNow());
  };
  return {
    get volume() {
      return inner.volume;
    },
    set volume(v: number) {
      inner.volume = v;
    },
    noteOn(pitch, velocity, when) {
      const voice: Voice = inner.noteOn(
        pitch,
        velocity,
        when === undefined ? undefined : toAudio(when),
      );
      return { stop: (at) => voice.stop(at === undefined ? undefined : toAudio(at)) };
    },
    play: (pitch, when, duration, velocity) => inner.play(pitch, toAudio(when), duration, velocity),
    click: (when, accent) => inner.click(toAudio(when), accent),
    silence: () => inner.silence?.(),
  };
}
