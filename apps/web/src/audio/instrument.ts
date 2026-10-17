// What the app plays notes and clicks through. The sampled piano and the additive synth both
// implement it, so the practice session never knows which one is sounding (PLAN.md P1-17).

export interface Voice {
  /** Releases the note at `when` on the audio clock (default: now). Only the first call counts. */
  stop(when?: number): void;
}

export interface Instrument {
  /** Output level, 0–1. */
  volume: number;
  /** Starts a note; call `stop` on the result to release it. */
  noteOn(pitch: number, velocity?: number, when?: number): Voice;
  /** Plays a note of a fixed length. */
  play(pitch: number, when: number, duration: number, velocity?: number): Voice;
  /** A short click for count-ins, metronome and the latency test. */
  click(when: number, accent?: boolean): void;
  /** Stops every note at once, including ones scheduled ahead (a MIDI keyboard needs this). */
  silence?(): void;
  /**
   * The most, in seconds, that notes should be handed to it ahead of time. A MIDI output that
   * cannot drop stamped notes asks for little, so few notes still start after Stop (P6-02).
   */
  readonly lookAhead?: number;
}

/**
 * The click every instrument uses. It stays an oscillator, never a sample, so its onset is exact
 * for the Detector Lab's latency test.
 */
export function playClick(
  ctx: BaseAudioContext,
  out: AudioNode,
  when: number,
  accent = false,
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.frequency.value = accent ? 1760 : 1320;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.6, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
  osc.connect(g);
  g.connect(out);
  osc.start(when);
  osc.stop(when + 0.05);
}
