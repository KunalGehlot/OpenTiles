// Input calibration maths (PLAN.md P1-19, P1-20). The app plays clicks and records when the
// learner (or the microphone) answered; these helpers turn that into one latency figure and a
// verdict on the microphone level. Pure, so they are tested without audio.

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export interface LatencyOptions {
  /** How long before a click an answer may come (anticipation), seconds. */
  before?: number;
  /** How long after a click an answer may come, seconds. */
  after?: number;
  /** Answers needed, as a share of the clicks, for a usable result. */
  minShare?: number;
  /** The result is clamped to [0, maxLatency]. */
  maxLatency?: number;
}

export interface LatencyResult {
  /** Median answer delay in seconds, or null when too few clicks were answered. */
  latency: number | null;
  matched: number;
  offsets: number[];
}

/**
 * Matches each click with the nearest unused answer inside its window and returns the median
 * delay. The median ignores the odd early or late answer, as the spec asks (P1-19: 8 clicks,
 * median offset).
 */
export function latencyFromAnswers(
  clicks: readonly number[],
  answers: readonly number[],
  options: LatencyOptions = {},
): LatencyResult {
  const before = options.before ?? 0.2;
  const after = options.after ?? 0.45;
  const minShare = options.minShare ?? 0.5;
  const maxLatency = options.maxLatency ?? 0.5;
  const used = new Set<number>();
  const offsets: number[] = [];
  for (const c of clicks) {
    let best = -1;
    let bestDist = Infinity;
    answers.forEach((a, i) => {
      if (used.has(i)) return;
      const d = a - c;
      if (d < -before || d > after) return;
      if (Math.abs(d) < bestDist) {
        best = i;
        bestDist = Math.abs(d);
      }
    });
    if (best >= 0) {
      used.add(best);
      offsets.push((answers[best] as number) - c);
    }
  }
  const enough = clicks.length > 0 && offsets.length >= Math.ceil(clicks.length * minShare);
  return {
    latency: enough ? Math.min(maxLatency, Math.max(0, median(offsets))) : null,
    matched: offsets.length,
    offsets,
  };
}

/** Evenly spaced click times for a calibration run. */
export function clickTrain(start: number, count: number, interval: number): number[] {
  return Array.from({ length: count }, (_, i) => start + i * interval);
}

export type MicLevelVerdict = 'ok' | 'quiet' | 'loud' | 'noisy' | 'unknown';

/**
 * Judges the microphone level from the quiet room (RMS dBFS) and the loudest key played. Below
 * 15 dB above the room the detector struggles; near 0 dBFS the input clips.
 */
export function micLevelVerdict(roomDb: number, peakDb: number): MicLevelVerdict {
  if (!Number.isFinite(peakDb))
    return Number.isFinite(roomDb) && roomDb > -35 ? 'noisy' : 'unknown';
  if (peakDb > -3) return 'loud';
  if (Number.isFinite(roomDb) && roomDb > -35) return 'noisy';
  if (Number.isFinite(roomDb) && peakDb - roomDb < 15) return 'quiet';
  if (peakDb < -45) return 'quiet';
  return 'ok';
}

/** Root-mean-square level of a block of samples in dBFS (-Infinity for silence). */
export function rmsDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] as number;
    sum += v * v;
  }
  if (samples.length === 0 || sum === 0) return -Infinity;
  return 10 * Math.log10(sum / samples.length);
}

/**
 * Notes for the "play a few keys" step, spread across the keyboard so the tuning estimate and
 * the level are not taken from one register only: C3, C4 (middle C) and C5 by default.
 */
export const CALIBRATION_PITCHES: readonly number[] = [48, 60, 72];
