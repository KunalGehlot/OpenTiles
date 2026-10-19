// The piano the app plays through (PLAN.md P1-17, ADR 0007): the Salamander Grand Piano samples
// once they have loaded, the additive synth until then and whenever they cannot load (an offline
// first run). Callers hold one stable object, so the switch needs nothing from them.

import { AdditiveSynth } from './additive';
import { playClick, type Instrument, type Voice } from './instrument';
import { roomImpulse } from './room';
import { loadPianoSamples, PianoSampler, type PianoSample } from './sampler';
import { ORIGINAL_LAYER, SAMPLE_LAYERS, type SampleLayer } from './samples';

export type { Instrument, Voice };

/** The name the practice session uses for its instrument. */
export type PianoSynth = Instrument;

/** After a failed load, wait this long before trying again (every tap asks for the piano). */
const RETRY_MS = 30_000;

/** Loads a velocity layer's samples (the original set when `layer` is not given). */
export type SampleLoader = (ctx: BaseAudioContext, layer?: SampleLayer) => Promise<PianoSample[]>;

/** How much of the piano goes into the room when it is on (P6-17): a soft room, not a church. */
const ROOM_LEVEL = 0.22;

export class Piano implements Instrument {
  private readonly out: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly synth: AdditiveSynth;
  /** The send into the room, made the first time the room is wanted. */
  private room: GainNode | null = null;
  private roomWanted = false;
  private sampler: PianoSampler | null = null;
  private loading: Promise<boolean> | null = null;
  private failedAt = -Infinity;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly loadSamples: SampleLoader,
    /** Passed to the sampler; see PianoSampler. */
    private readonly maxVoices?: number,
    /** Velocity layers loaded after the original set, in this order (P6-17). */
    private readonly moreLayers: readonly SampleLayer[] = [],
  ) {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    this.compressor = compressor;
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
        this.sampler = new PianoSampler(this.ctx, samples, this.out, this.maxVoices);
        void this.loadMoreLayers(this.sampler);
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

  /** The softer and louder layers, after the original set; a layer that fails is left out. */
  private async loadMoreLayers(sampler: PianoSampler): Promise<void> {
    for (const layer of this.moreLayers) {
      try {
        sampler.addLayer(layer, await this.loadSamples(this.ctx, layer));
      } catch {
        // The layers loaded so far play on; the next visit tries again.
      }
    }
  }

  /** True while the room is on. */
  get roomOn(): boolean {
    return this.roomWanted;
  }

  /**
   * A soft room around the piano (P6-17): the Player turns it on while it plays here, and it is
   * off everywhere else. Practice and the Detector Lab want the dry sound and exact onsets.
   */
  setRoom(on: boolean): void {
    if (on === this.roomWanted) return;
    this.roomWanted = on;
    if (!this.room) {
      if (!on) return;
      const convolver = this.ctx.createConvolver();
      convolver.buffer = roomImpulse(this.ctx);
      this.room = this.ctx.createGain();
      this.room.gain.value = 0;
      this.out.connect(this.room);
      this.room.connect(convolver);
      convolver.connect(this.compressor);
    }
    this.room.gain.setTargetAtTime(on ? ROOM_LEVEL : 0, this.ctx.currentTime, 0.05);
  }

  private get active(): Instrument {
    return this.sampler ?? this.synth;
  }

  noteOn(pitch: number, velocity?: number, when?: number): Voice {
    return this.active.noteOn(pitch, velocity, when);
  }

  play(pitch: number, when: number, duration: number, velocity?: number, held?: number): Voice {
    return this.active.play(pitch, when, duration, velocity, held);
  }

  click(when: number, accent = false): void {
    playClick(this.ctx, this.out, when, accent);
  }

  /** Stops the sampled piano's notes at once; the stand-in synth's are short anyway. */
  silence(): void {
    this.sampler?.silence();
  }
}

const pianos = new WeakMap<BaseAudioContext, Piano>();

/** Where the vendored piano samples are served from. */
export function pianoSampleBase(): URL {
  return new URL('samples/piano/', document.baseURI);
}

/**
 * The piano for an unlocked audio context. The first call starts loading the samples, so they are
 * fetched only after a user gesture has started audio (Safari, spec §5).
 */
export function synthFor(ctx: AudioContext): Piano {
  let piano = pianos.get(ctx);
  if (!piano) {
    const base = pianoSampleBase();
    piano = new Piano(
      ctx,
      (c, layer) => loadPianoSamples(c, base, undefined, layer),
      undefined,
      // The softer layer first: accompaniment and quiet passages use it most.
      SAMPLE_LAYERS.filter((l) => l !== ORIGINAL_LAYER),
    );
    pianos.set(ctx, piano);
  }
  void piano.load();
  return piano;
}
