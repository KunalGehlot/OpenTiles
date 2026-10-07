// Synthetic piano-like audio for the engine's tests, generated in code (no recordings needed).

export interface ToneNote {
  pitch: number;
  /** Onset in seconds. */
  at: number;
  /** Peak amplitude of the fundamental. Defaults to 0.05. */
  amp?: number;
}

/**
 * Decaying harmonics with a short attack, plus light noise so the spectrum has a floor. Each note
 * stops after 3.5 s, when it has decayed below the noise.
 */
export function renderNotes(notes: readonly ToneNote[], sampleRate: number, seconds: number) {
  const mix = new Float64Array(Math.round(seconds * sampleRate));
  const attack = 0.002 * sampleRate;
  const decay = Math.exp(-2 / sampleRate);
  for (const { pitch, at, amp = 0.05 } of notes) {
    const start = Math.round(at * sampleRate);
    const end = Math.min(mix.length, start + Math.round(3.5 * sampleRate));
    const f0 = 440 * 2 ** ((pitch - 69) / 12);
    for (let n = 1; n <= 8; n++) {
      const f = n * f0;
      if (f > sampleRate * 0.45) break;
      // Rotate a phasor and shrink an envelope per sample: much faster than sin() and exp().
      const step = (2 * Math.PI * f) / sampleRate;
      const cs = Math.cos(step);
      const sn = Math.sin(step);
      let re = 1;
      let im = 0;
      let env = amp / n;
      for (let i = start; i < end; i++) {
        mix[i] = (mix[i] ?? 0) + env * Math.min(1, (i - start) / attack) * im;
        const next = re * cs - im * sn;
        im = re * sn + im * cs;
        re = next;
        env *= decay;
      }
    }
  }
  const out = new Float32Array(mix.length);
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = (mix[i] ?? 0) + 1e-4 * (seed / 2147483648 - 0.5);
  }
  return out;
}

/** One chord struck at `at` seconds. */
export function tone(pitches: number[], sampleRate: number, seconds: number, at: number) {
  return renderNotes(
    pitches.map((pitch) => ({ pitch, at })),
    sampleRate,
    seconds,
  );
}
