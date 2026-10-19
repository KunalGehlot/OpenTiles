// A room around the piano for the Player (P6-17, brief §5.3): the impulse response of a small hall,
// made in code when it is first wanted. Decaying noise, darker as it fades, with a short gap
// before the first reflections. No recording, so nothing to license and nothing to download.
// The maths is pure and runs in Node tests; `roomImpulse` turns it into an AudioBuffer.

/** How long the room rings, in seconds: the time to fall by 60 dB. */
export const ROOM_SECONDS = 1.8;
/** The gap before the first reflection reaches the listener. */
const PRE_DELAY = 0.012;
/** A short fade-in, so the reflections do not start with a click. */
const FADE_IN = 0.002;
/** How much of the high end each sample keeps: bright at first, dark in the tail. */
const BRIGHT = 0.9;
const DARK = 0.15;

/** A small fixed-seed generator (mulberry32), so the room is the same every time. */
function noise(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** The two channels of the room's impulse response at `sampleRate`. */
export function roomImpulseData(sampleRate: number, seconds = ROOM_SECONDS): Float32Array[] {
  const length = Math.round(seconds * sampleRate);
  const start = Math.round(PRE_DELAY * sampleRate);
  return [1, 2].map((seed) => {
    const out = new Float32Array(length);
    const random = noise(seed);
    let y = 0;
    for (let i = start; i < length; i++) {
      const t = (i - start) / sampleRate;
      const progress = t / (seconds - PRE_DELAY);
      // A one-pole low-pass that closes as the sound fades: air and walls take the highs first.
      y += (BRIGHT + (DARK - BRIGHT) * progress) * (random() * 2 - 1 - y);
      const decay = Math.exp((-6.91 * t) / (seconds - PRE_DELAY));
      out[i] = y * decay * Math.min(1, t / FADE_IN);
    }
    return out;
  });
}

/** The room as an AudioBuffer for a ConvolverNode. */
export function roomImpulse(ctx: BaseAudioContext): AudioBuffer {
  const data = roomImpulseData(ctx.sampleRate);
  const buffer = ctx.createBuffer(2, data[0]?.length ?? 1, ctx.sampleRate);
  data.forEach((channel, i) => buffer.getChannelData(i).set(channel));
  return buffer;
}
