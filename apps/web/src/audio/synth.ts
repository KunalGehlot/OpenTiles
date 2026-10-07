// A small additive piano-like synthesiser: the fallback until an openly licensed sample set is
// chosen (PLAN.md P1-17). Plays through Web Audio, never Web MIDI output (spec §5).

const PARTIALS = [
  { n: 1, gain: 1 },
  { n: 2, gain: 0.45 },
  { n: 3, gain: 0.22 },
  { n: 4, gain: 0.12 },
  { n: 5, gain: 0.06 },
];

export interface Voice {
  stop(when?: number): void;
}

export class PianoSynth {
  private readonly out: GainNode;

  constructor(private readonly ctx: AudioContext) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    this.out = ctx.createGain();
    this.out.gain.value = 0.35;
    this.out.connect(compressor);
    compressor.connect(ctx.destination);
  }

  set volume(v: number) {
    this.out.gain.value = Math.max(0, Math.min(1, v)) * 0.6;
  }

  /** Starts a note; call `stop` on the result to release it. */
  noteOn(pitch: number, velocity = 90, when = this.ctx.currentTime): Voice {
    const ctx = this.ctx;
    const f0 = 440 * 2 ** ((pitch - 69) / 12);
    const level = (velocity / 127) ** 1.5 * 0.5;
    const decay = Math.max(0.6, 4 * 2 ** (-(pitch - 36) / 24));
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + 0.004);
    env.gain.setTargetAtTime(level * 0.35, when + 0.004, decay * 0.15);
    env.gain.setTargetAtTime(0.0001, when + 0.3, decay);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(12000, f0 * (4 + 6 * (velocity / 127)));
    filter.connect(env);
    env.connect(this.out);
    const oscs: OscillatorNode[] = [];
    for (const p of PARTIALS) {
      const f = f0 * p.n * Math.sqrt(1 + 0.0004 * p.n * p.n);
      if (f > ctx.sampleRate * 0.45) break;
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = p.gain;
      osc.connect(g);
      g.connect(filter);
      osc.start(when);
      oscs.push(osc);
    }
    let stopped = false;
    return {
      stop: (at = ctx.currentTime) => {
        if (stopped) return;
        stopped = true;
        const t = Math.max(at, when + 0.01);
        env.gain.cancelScheduledValues(t);
        env.gain.setTargetAtTime(0.0001, t, 0.08);
        for (const o of oscs) o.stop(t + 0.6);
      },
    };
  }

  /** Plays a note of a fixed length. */
  play(pitch: number, when: number, duration: number, velocity = 90): Voice {
    const v = this.noteOn(pitch, velocity, when);
    v.stop(when + Math.max(0.05, duration));
    return v;
  }

  /** A short click for count-ins, metronome and the latency test. */
  click(when: number, accent = false): void {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.6, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    osc.connect(g);
    g.connect(this.out);
    osc.start(when);
    osc.stop(when + 0.05);
  }
}

const synths = new WeakMap<AudioContext, PianoSynth>();

export function synthFor(ctx: AudioContext): PianoSynth {
  let s = synths.get(ctx);
  if (!s) {
    s = new PianoSynth(ctx);
    synths.set(ctx, s);
  }
  return s;
}
