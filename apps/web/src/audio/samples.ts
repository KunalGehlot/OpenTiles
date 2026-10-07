// The piano sample set and the pure maths for playing it. No Web Audio here, so it runs in Node
// tests. The files are built by tools/samples/build_piano_samples.py from the Salamander Grand
// Piano V3 by Alexander Holm (CC BY 3.0); see public/samples/piano/README.md and ADR 0007.

/** One sample every minor third from A0 (21) to C8 (108), as the original release is sampled. */
export const SAMPLE_PITCHES: readonly number[] = Array.from({ length: 30 }, (_, i) => 21 + 3 * i);

/** The samples are the release's velocity layer 10, which it plays for velocities 73–80. */
export const SAMPLE_VELOCITY = 76;

const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

/** File name of the sample for a MIDI pitch: 21 → "A0.mp3", 63 → "Ds4.mp3". */
export function sampleFileName(pitch: number): string {
  return `${NAMES[pitch % 12] ?? ''}${Math.floor(pitch / 12) - 1}.mp3`;
}

/** Every sample file, for callers that cache them (the service worker). */
export function sampleFileNames(): string[] {
  return SAMPLE_PITCHES.map(sampleFileName);
}

/**
 * The available sample closest to `pitch`; ties go to the higher one so the choice never depends
 * on the order of `available`. `undefined` when nothing is available.
 */
export function nearestSample(pitch: number, available: readonly number[]): number | undefined {
  let best: number | undefined;
  for (const p of available) {
    if (
      best === undefined ||
      Math.abs(p - pitch) < Math.abs(best - pitch) ||
      (Math.abs(p - pitch) === Math.abs(best - pitch) && p > best)
    ) {
      best = p;
    }
  }
  return best;
}

/** Playback rate that turns a sample recorded at `samplePitch` into `pitch` (equal temperament). */
export function playbackRate(pitch: number, samplePitch: number): number {
  return 2 ** ((pitch - samplePitch) / 12);
}

function clampVelocity(velocity: number): number {
  return Number.isFinite(velocity) ? Math.max(1, Math.min(127, velocity)) : SAMPLE_VELOCITY;
}

/**
 * Gain for a MIDI velocity, relative to the recorded layer (1 at SAMPLE_VELOCITY). Square law:
 * about 32 dB from velocity 20 to 127, close to a real piano's dynamic range.
 */
export function velocityGain(velocity: number): number {
  return (clampVelocity(velocity) / SAMPLE_VELOCITY) ** 2;
}

/**
 * Low-pass cutoff in Hz that darkens notes played softer than the recorded layer, as a softer
 * hammer blow has weaker upper partials. Never below the fourth harmonic, so the note keeps its
 * pitch and body. `null` at or above the recorded velocity: no filter needed.
 */
export function velocityCutoff(velocity: number, pitch: number): number | null {
  const v = clampVelocity(velocity);
  if (v >= SAMPLE_VELOCITY) return null;
  const f0 = 440 * 2 ** ((pitch - 69) / 12);
  const cutoff = 18000 * 2 ** (-(SAMPLE_VELOCITY - v) / 16);
  return Math.min(20000, Math.max(4 * f0, cutoff));
}

/** Highest key with a damper; the strings above ring on after release, as on a real grand. */
const LAST_DAMPED = 88;

/**
 * Time constant in seconds of the release when a key is let go: the damper stops bass strings
 * more slowly than treble ones, and undamped treble strings ring on.
 */
export function releaseTime(pitch: number): number {
  if (pitch > LAST_DAMPED) return 0.8;
  const t = (Math.max(21, Math.min(LAST_DAMPED, pitch)) - 21) / (LAST_DAMPED - 21);
  return 0.16 - t * 0.1;
}

/**
 * Where to start playing a decoded sample, in seconds: just before the hammer attack. MP3
 * decoders differ in whether they strip the encoder's leading padding (Safari, Chrome and Firefox
 * do not all agree), so the onset is measured on the decoded audio rather than assumed. The onset
 * is the first sample at 1% of the attack peak; 1 ms before it is kept.
 */
export function findOnset(data: ArrayLike<number>, sampleRate: number): number {
  const n = Math.min(data.length, Math.round(sampleRate * 0.5));
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i] ?? 0));
  if (peak === 0) return 0;
  const limit = peak * 0.01;
  for (let i = 0; i < n; i++) {
    if (Math.abs(data[i] ?? 0) >= limit) return Math.max(0, i - sampleRate * 0.001) / sampleRate;
  }
  return 0;
}
