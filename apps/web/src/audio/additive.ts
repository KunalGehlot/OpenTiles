// A small additive piano-like synthesiser. It sounds while the piano samples load and stands in
// for them when they cannot load (offline first run). Plays through Web Audio, never Web MIDI
// output (spec §5).

import { playClick, type Instrument, type Voice } from './instrument';

const PARTIALS = [
  { n: 1, gain: 1 },
  { n: 2, gain: 0.45 },
  { n: 3, gain: 0.22 },
  { n: 4, gain: 0.12 },
  { n: 5, gain: 0.06 },
];

export class AdditiveSynth implements Instrument {
  private readonly out: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode = ctx.destination,
  ) {
    this.out = ctx.createGain();
    this.out.connect(destination);
  }

  get volume(): number {
    return this.out.gain.value;
  }

  set volume(v: number) {
    this.out.gain.value = Math.max(0, Math.min(1, v));
  }

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

  play(pitch: number, when: number, duration: number, velocity = 90, held?: number): Voice {
    const v = this.noteOn(pitch, velocity, when);
    // The piece's pedal holds it on past the key (P6-10).
    v.stop(when + Math.max(0.05, held ?? duration, duration));
    return v;
  }

  click(when: number, accent = false): void {
    playClick(this.ctx, this.out, when, accent);
  }
}
