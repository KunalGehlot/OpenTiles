import { describe, expect, it } from 'vitest';
import {
  SAMPLE_PITCHES,
  SAMPLE_VELOCITY,
  findOnset,
  nearestSample,
  playbackRate,
  releaseTime,
  sampleFileName,
  sampleFileNames,
  velocityCutoff,
  velocityGain,
} from '../src/audio/samples';
import { loadPianoSamples, PianoSampler, type PianoSample } from '../src/audio/sampler';
import { Piano } from '../src/audio/synth';

describe('sample set', () => {
  it('has one sample every minor third from A0 to C8', () => {
    expect(SAMPLE_PITCHES).toHaveLength(30);
    expect(SAMPLE_PITCHES[0]).toBe(21);
    expect(SAMPLE_PITCHES.at(-1)).toBe(108);
    for (let i = 1; i < SAMPLE_PITCHES.length; i++) {
      expect((SAMPLE_PITCHES[i] ?? 0) - (SAMPLE_PITCHES[i - 1] ?? 0)).toBe(3);
    }
  });

  it('names files like the vendored samples', () => {
    expect(sampleFileName(21)).toBe('A0.mp3');
    expect(sampleFileName(24)).toBe('C1.mp3');
    expect(sampleFileName(27)).toBe('Ds1.mp3');
    expect(sampleFileName(30)).toBe('Fs1.mp3');
    expect(sampleFileName(60)).toBe('C4.mp3');
    expect(sampleFileName(108)).toBe('C8.mp3');
    expect(new Set(sampleFileNames()).size).toBe(30);
  });
});

describe('nearestSample', () => {
  it('maps every piano key to a sample at most one semitone away', () => {
    for (let p = 21; p <= 108; p++) {
      const s = nearestSample(p, SAMPLE_PITCHES);
      expect(s).toBeDefined();
      expect(Math.abs((s ?? 0) - p)).toBeLessThanOrEqual(1);
    }
    expect(nearestSample(60, SAMPLE_PITCHES)).toBe(60);
    expect(nearestSample(61, SAMPLE_PITCHES)).toBe(60);
    expect(nearestSample(62, SAMPLE_PITCHES)).toBe(63);
  });

  it('clamps to the ends of the range', () => {
    expect(nearestSample(0, SAMPLE_PITCHES)).toBe(21);
    expect(nearestSample(127, SAMPLE_PITCHES)).toBe(108);
  });

  it('works with a partial set, breaks ties upwards and handles an empty set', () => {
    expect(nearestSample(62, [66, 60])).toBe(60);
    expect(nearestSample(63, [66, 60])).toBe(66);
    expect(nearestSample(63, [60, 66])).toBe(66);
    expect(nearestSample(60, [])).toBeUndefined();
  });
});

describe('playbackRate', () => {
  it('shifts by equal-tempered semitones', () => {
    expect(playbackRate(60, 60)).toBe(1);
    expect(playbackRate(72, 60)).toBeCloseTo(2, 12);
    expect(playbackRate(48, 60)).toBeCloseTo(0.5, 12);
    expect(playbackRate(61, 60)).toBeCloseTo(1.059463, 6);
    expect(playbackRate(59, 60)).toBeCloseTo(1 / 1.059463, 6);
  });
});

describe('velocity', () => {
  it('is unity at the recorded layer and rises with velocity', () => {
    expect(velocityGain(SAMPLE_VELOCITY)).toBe(1);
    let last = 0;
    for (let v = 1; v <= 127; v++) {
      const g = velocityGain(v);
      expect(g).toBeGreaterThan(last);
      last = g;
    }
  });

  it('gives a piano-like dynamic range and clamps nonsense', () => {
    const db = 20 * Math.log10(velocityGain(127) / velocityGain(20));
    expect(db).toBeGreaterThan(28);
    expect(db).toBeLessThan(36);
    expect(velocityGain(500)).toBe(velocityGain(127));
    expect(velocityGain(-3)).toBe(velocityGain(1));
    expect(velocityGain(Number.NaN)).toBe(1);
  });

  it('darkens soft notes only, never below the fourth harmonic', () => {
    expect(velocityCutoff(SAMPLE_VELOCITY, 60)).toBeNull();
    expect(velocityCutoff(127, 60)).toBeNull();
    const soft = velocityCutoff(30, 60) ?? 0;
    const softer = velocityCutoff(10, 60) ?? 0;
    expect(soft).toBeGreaterThan(softer);
    expect(soft).toBeLessThan(18000);
    const c8 = 440 * 2 ** ((108 - 69) / 12);
    expect(velocityCutoff(1, 108)).toBeCloseTo(4 * c8, 6);
  });
});

describe('releaseTime', () => {
  it('damps bass more slowly than treble', () => {
    expect(releaseTime(21)).toBeGreaterThan(releaseTime(60));
    expect(releaseTime(60)).toBeGreaterThan(releaseTime(88));
    expect(releaseTime(0)).toBe(releaseTime(21));
    expect(releaseTime(88)).toBeGreaterThan(0.03);
  });

  it('lets the undamped top strings ring on', () => {
    expect(releaseTime(89)).toBeGreaterThan(releaseTime(21));
    expect(releaseTime(108)).toBe(releaseTime(89));
  });
});

describe('findOnset', () => {
  const rate = 1000;
  const withAttackAt = (index: number, length = 600) => {
    const data = new Float32Array(length);
    for (let i = index; i < length; i++) data[i] = Math.sin(i) * Math.exp(-(i - index) / 200);
    return data;
  };

  it('starts 1 ms before the attack', () => {
    expect(findOnset(withAttackAt(30), rate)).toBeCloseTo(0.029, 9);
  });

  it('skips decoder padding and quiet noise before the attack', () => {
    const data = withAttackAt(100);
    for (let i = 0; i < 100; i++) data[i] = 0.001 * Math.sin(i * 7);
    expect(findOnset(data, rate)).toBeCloseTo(0.099, 9);
  });

  it('never goes negative and copes with silence', () => {
    expect(findOnset(withAttackAt(0), rate)).toBe(0);
    expect(findOnset(new Float32Array(50), rate)).toBe(0);
    expect(findOnset([], rate)).toBe(0);
  });
});

// --- A minimal stand-in for Web Audio, enough to check what the sampler schedules. -------------

interface ParamCall {
  method: string;
  args: number[];
}

class FakeParam {
  value: number;
  calls: ParamCall[] = [];
  constructor(value = 1) {
    this.value = value;
  }
  private record(method: string, args: number[]): this {
    this.calls.push({ method, args });
    return this;
  }
  setValueAtTime(v: number, t: number) {
    return this.record('setValueAtTime', [v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.record('linearRampToValueAtTime', [v, t]);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    return this.record('exponentialRampToValueAtTime', [v, t]);
  }
  setTargetAtTime(v: number, t: number, c: number) {
    return this.record('setTargetAtTime', [v, t, c]);
  }
  cancelScheduledValues(t: number) {
    return this.record('cancelScheduledValues', [t]);
  }
}

class FakeNode {
  connections: FakeNode[] = [];
  connect(n: FakeNode) {
    this.connections.push(n);
    return n;
  }
  disconnect() {
    this.connections = [];
  }
}

class FakeSource extends FakeNode {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  started: number[] | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;
  start(when: number, offset: number) {
    this.started = [when, offset];
  }
  stop(when: number) {
    this.stoppedAt = when;
  }
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  gains: (FakeNode & { gain: FakeParam })[] = [];
  filters: (FakeNode & { frequency: FakeParam; Q: FakeParam; type: string })[] = [];
  oscillators = 0;
  createGain() {
    const g = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBiquadFilter() {
    const f = Object.assign(new FakeNode(), {
      frequency: new FakeParam(350),
      Q: new FakeParam(1),
      type: 'lowpass',
    });
    this.filters.push(f);
    return f;
  }
  createOscillator() {
    this.oscillators += 1;
    return Object.assign(new FakeNode(), {
      frequency: new FakeParam(440),
      start() {},
      stop() {},
    });
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(-24),
      ratio: new FakeParam(12),
    });
  }
  decodeAudioData(
    data: ArrayBuffer,
    ok: (b: AudioBuffer) => void,
    _fail: (e: Error) => void,
  ): Promise<AudioBuffer> {
    // The "file" holds the index of its attack; decode to a buffer with silence before it.
    const attack = new Uint8Array(data)[0] ?? 0;
    const channel = new Float32Array(2000);
    for (let i = attack; i < channel.length; i++) channel[i] = 0.5;
    const buffer = { sampleRate: 1000, getChannelData: () => channel } as unknown as AudioBuffer;
    ok(buffer);
    return Promise.resolve(buffer);
  }
}

const asContext = (c: FakeContext) => c as unknown as BaseAudioContext;
const fakeSamples = (): PianoSample[] =>
  SAMPLE_PITCHES.map((pitch) => ({
    pitch,
    buffer: { pitch } as unknown as AudioBuffer,
    offset: 0.002,
  }));

describe('PianoSampler', () => {
  it('plays the nearest sample at the shifted rate, from its onset', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), fakeSamples());
    s.noteOn(61, 90, 1);
    const src = ctx.sources[0];
    expect(src?.buffer).toEqual({ pitch: 60 });
    expect(src?.playbackRate.value).toBeCloseTo(playbackRate(61, 60), 12);
    expect(src?.started).toEqual([1, 0.002]);
  });

  it('scales gain with velocity and filters only soft notes', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), fakeSamples());
    const peak = () => {
      const env = ctx.gains.at(-1);
      const ramp = env?.gain.calls.find((c) => c.method === 'linearRampToValueAtTime');
      return ramp?.args[0] ?? 0;
    };
    s.noteOn(60, 100, 0);
    const loud = peak();
    expect(ctx.filters).toHaveLength(0);
    s.noteOn(60, 40, 0);
    const soft = peak();
    expect(ctx.filters).toHaveLength(1);
    expect(loud / soft).toBeCloseTo(velocityGain(100) / velocityGain(40), 9);
  });

  it('releases at the note end with the damper time and stops the source after it', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), fakeSamples());
    s.play(60, 2, 0.5, 80);
    const env = ctx.gains.at(-1);
    const target = env?.gain.calls.find((c) => c.method === 'setTargetAtTime');
    expect(target?.args).toEqual([0, 2.5, releaseTime(60)]);
    expect(ctx.sources[0]?.stoppedAt).toBeCloseTo(2.5 + releaseTime(60) * 8, 9);
  });

  it('honours only the first stop', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), fakeSamples());
    const v = s.noteOn(60, 80, 0);
    v.stop(1);
    v.stop(0.5);
    expect(ctx.sources[0]?.stoppedAt).toBeCloseTo(1 + releaseTime(60) * 8, 9);
  });

  it('steals the oldest voice beyond 64', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), fakeSamples());
    for (let i = 0; i < 64; i++) s.noteOn(60, 80, 0);
    expect(ctx.sources.every((src) => src.stoppedAt === null)).toBe(true);
    s.noteOn(60, 80, 0);
    expect(ctx.sources[0]?.stoppedAt).not.toBeNull();
    expect(ctx.sources[1]?.stoppedAt).toBeNull();
  });

  it('counts voices with a scheduled release until they end, and moves the release earlier', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), fakeSamples());
    for (let i = 0; i < 64; i++) s.play(60, 0, 4, 80);
    const scheduled = 4 + releaseTime(60) * 8;
    expect(ctx.sources.every((src) => src.stoppedAt === scheduled)).toBe(true);
    ctx.currentTime = 1;
    s.play(60, 1, 4, 80);
    expect(ctx.sources[0]?.stoppedAt).toBeLessThan(2);
    expect(ctx.sources[1]?.stoppedAt).toBe(scheduled);
  });

  it('forgets voices whose sample has ended', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), fakeSamples());
    for (let i = 0; i < 64; i++) s.noteOn(60, 80, 0);
    ctx.sources[0]?.onended?.();
    s.noteOn(60, 80, 0);
    expect(ctx.sources.every((src) => src.stoppedAt === null)).toBe(true);
  });

  it('is silent rather than failing without samples', () => {
    const ctx = new FakeContext();
    const s = new PianoSampler(asContext(ctx), []);
    expect(() => s.noteOn(60).stop()).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
  });
});

describe('loadPianoSamples', () => {
  const base = new URL('https://example.invalid/samples/piano/');

  it('fetches every file and measures each onset', async () => {
    const ctx = new FakeContext();
    const fetched: string[] = [];
    const samples = await loadPianoSamples(asContext(ctx), base, async (url) => {
      fetched.push(url.pathname);
      return new Response(new Uint8Array([25]));
    });
    expect(fetched).toHaveLength(30);
    expect(fetched).toContain('/samples/piano/Ds4.mp3');
    expect(samples.map((s) => s.pitch)).toEqual(SAMPLE_PITCHES);
    expect(samples[0]?.offset).toBeCloseTo(0.024, 9);
  });

  it('fails when any file is missing', async () => {
    const ctx = new FakeContext();
    await expect(
      loadPianoSamples(asContext(ctx), base, async (url) =>
        url.pathname.endsWith('C4.mp3')
          ? new Response('', { status: 404 })
          : new Response(new Uint8Array([0])),
      ),
    ).rejects.toThrow(/C4\.mp3/);
  });
});

describe('Piano', () => {
  it('plays the synth until the samples load, then the sampler', async () => {
    const ctx = new FakeContext();
    let resolve: (s: PianoSample[]) => void = () => {};
    const piano = new Piano(asContext(ctx), () => new Promise<PianoSample[]>((r) => (resolve = r)));
    const loaded = piano.load();
    piano.noteOn(60, 80, 0);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.oscillators).toBeGreaterThan(0);
    expect(piano.sampled).toBe(false);

    resolve(fakeSamples());
    expect(await loaded).toBe(true);
    expect(piano.sampled).toBe(true);
    piano.noteOn(60, 80, 0);
    expect(ctx.sources).toHaveLength(1);
  });

  it('keeps the synth when loading fails and waits before retrying', async () => {
    const ctx = new FakeContext();
    let attempts = 0;
    const piano = new Piano(asContext(ctx), () => {
      attempts += 1;
      return Promise.reject(new Error('offline'));
    });
    expect(await piano.load()).toBe(false);
    expect(await piano.load()).toBe(false);
    expect(attempts).toBe(1);
    piano.play(60, 0, 0.5);
    expect(ctx.sources).toHaveLength(0);
  });

  it('loads only once', async () => {
    const ctx = new FakeContext();
    let attempts = 0;
    const piano = new Piano(asContext(ctx), async () => {
      attempts += 1;
      return fakeSamples();
    });
    await Promise.all([piano.load(), piano.load()]);
    expect(await piano.load()).toBe(true);
    expect(attempts).toBe(1);
  });

  it('maps volume onto the master gain', () => {
    const ctx = new FakeContext();
    const piano = new Piano(asContext(ctx), async () => []);
    piano.volume = 0.5;
    expect(piano.volume).toBeCloseTo(0.5, 9);
    piano.volume = 3;
    expect(piano.volume).toBeCloseTo(1, 9);
  });
});
