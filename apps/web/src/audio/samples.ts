// The piano sample set and the pure maths for playing it. No Web Audio here, so it runs in Node
// tests. The files are built by tools/samples/build_piano_samples.py from the Salamander Grand
// Piano V3 by Alexander Holm (CC BY 3.0); see public/samples/piano/README.md and ADR 0007.

/** One sample every minor third from A0 (21) to C8 (108), as the original release is sampled. */
export const SAMPLE_PITCHES: readonly number[] = Array.from({ length: 30 }, (_, i) => 21 + 3 * i);

/** The samples are the release's velocity layer 10, which it plays for velocities 73–80. */
export const SAMPLE_VELOCITY = 76;

/** A velocity layer of the release, and how the app plays it (ADR 0007, P6-17). */
export interface SampleLayer {
  /** Its folder under samples/piano/: '' for the original set. */
  readonly dir: string;
  /** The release's layer (of 16; it plays layer n for velocities 8n − 7 to 8n). */
  readonly layer: number;
  /** The velocity it was recorded at: the middle of its range. */
  readonly velocity: number;
  /**
   * Its files' level against the original set's, in dB, as the build measured it. It is taken off
   * again, so loudness follows `velocityGain` whichever layer plays, and the layer changes only the
   * tone: a soft hammer blow sounds soft, not just quieter.
   */
  readonly levelDb: number;
}

/** The original set, layer 10: loaded first, and all the app has until the others arrive. */
export const ORIGINAL_LAYER: SampleLayer = Object.freeze({
  dir: '',
  layer: 10,
  velocity: SAMPLE_VELOCITY,
  levelDb: 0,
});

/** Every layer, softest first (levels from tools/samples/build_piano_samples.py, 2026-10-19). */
export const SAMPLE_LAYERS: readonly SampleLayer[] = Object.freeze([
  Object.freeze({ dir: 'soft/', layer: 5, velocity: 36, levelDb: -0.54 }),
  ORIGINAL_LAYER,
  Object.freeze({ dir: 'loud/', layer: 14, velocity: 108, levelDb: -0.54 }),
]);

/** The layer to play `velocity` with, of those loaded: the one recorded nearest; ties go louder. */
export function layerFor(
  velocity: number,
  loaded: readonly SampleLayer[],
): SampleLayer | undefined {
  const v = clampVelocity(velocity);
  let best: SampleLayer | undefined;
  for (const l of loaded) {
    const d = Math.abs(l.velocity - v);
    const bestD = best ? Math.abs(best.velocity - v) : Infinity;
    if (!best || d < bestD || (d === bestD && l.velocity > best.velocity)) best = l;
  }
  return best;
}

const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];

/** File name of the sample for a MIDI pitch: 21 → "A0.mp3", 63 → "Ds4.mp3". */
export function sampleFileName(pitch: number): string {
  return `${NAMES[pitch % 12] ?? ''}${Math.floor(pitch / 12) - 1}.mp3`;
}

/** Every sample file of a layer (the original set by default), as paths under samples/piano/. */
export function sampleFileNames(layer: SampleLayer = ORIGINAL_LAYER): string[] {
  return SAMPLE_PITCHES.map((p) => layer.dir + sampleFileName(p));
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
 * Low-pass cutoff in Hz that darkens notes played softer than the layer they are played with
 * (`recorded`, the original set's velocity by default), as a softer hammer blow has weaker upper
 * partials. Never below the fourth harmonic, so the note keeps its pitch and body. `null` at or
 * above the recorded velocity: no filter needed.
 */
export function velocityCutoff(
  velocity: number,
  pitch: number,
  recorded = SAMPLE_VELOCITY,
): number | null {
  const v = clampVelocity(velocity);
  if (v >= recorded) return null;
  const f0 = 440 * 2 ** ((pitch - 69) / 12);
  const cutoff = 18000 * 2 ** (-(recorded - v) / 16);
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
