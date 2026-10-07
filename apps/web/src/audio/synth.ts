// The piano the app plays through (PLAN.md P1-17, ADR 0007): the Salamander Grand Piano samples
// once they have loaded, the additive synth until then and whenever they cannot load (an offline
// first run). Callers hold one stable object, so the switch needs nothing from them.

import { AdditiveSynth } from './additive';
import { playClick, type Instrument, type Voice } from './instrument';
import { loadPianoSamples, PianoSampler, type PianoSample } from './sampler';

export type { Instrument, Voice };

/** The name the practice session uses for its instrument. */
export type PianoSynth = Instrument;

/** After a failed load, wait this long before trying again (every tap asks for the piano). */
const RETRY_MS = 30_000;

export type SampleLoader = (ctx: BaseAudioContext) => Promise<PianoSample[]>;

export class Piano implements Instrument {
  private readonly out: GainNode;
  private readonly synth: AdditiveSynth;
  private sampler: PianoSampler | null = null;
  private loading: Promise<boolean> | null = null;
  private failedAt = -Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly loadSamples: SampleLoader,
  ) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    this.out = ctx.createGain();
    this.out.gain.value = 0.35;
    this.out.connect(compressor);
    compressor.connect(ctx.destination);
    this.synth = new AdditiveSynth(ctx, this.out);
  }

  /** True once the sampled piano is playing; false while the synth stands in. */
  get sampled(): boolean {
    return this.sampler !== null;
  }

  get volume(): number {
    return this.out.gain.value / 0.6;
  }

  set volume(v: number) {
    this.out.gain.value = Math.max(0, Math.min(1, v)) * 0.6;
  }

  /**
   * Loads the samples once; resolves true when they are in use. A failure leaves the synth
   * playing and is retried on a later call, at most every RETRY_MS.
   */
  load(): Promise<boolean> {
    if (this.sampler) return Promise.resolve(true);
    if (this.loading) return this.loading;
    if (performance.now() - this.failedAt < RETRY_MS) return Promise.resolve(false);
    this.loading = this.loadSamples(this.ctx).then(
      (samples) => {
        this.sampler = new PianoSampler(this.ctx, samples, this.out);
        return true;
      },
      () => {
        this.failedAt = performance.now();
        this.loading = null;
        return false;
      },
    );
    return this.loading;
  }

  private get active(): Instrument {
    return this.sampler ?? this.synth;
  }

  noteOn(pitch: number, velocity?: number, when?: number): Voice {
    return this.active.noteOn(pitch, velocity, when);
  }

  play(pitch: number, when: number, duration: number, velocity?: number): Voice {
    return this.active.play(pitch, when, duration, velocity);
  }

  click(when: number, accent = false): void {
    playClick(this.ctx, this.out, when, accent);
  }
}

const pianos = new WeakMap<BaseAudioContext, Piano>();

/**
 * The piano for an unlocked audio context. The first call starts loading the samples, so they are
 * fetched only after a user gesture has started audio (Safari, spec §5).
 */
export function synthFor(ctx: AudioContext): Piano {
  let piano = pianos.get(ctx);
  if (!piano) {
    const base = new URL('samples/piano/', document.baseURI);
    piano = new Piano(ctx, (c) => loadPianoSamples(c, base));
    pianos.set(ctx, piano);
  }
  void piano.load();
  return piano;
}
