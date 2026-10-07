// Direct (main-thread or worker) use of engine.wasm: offline analysis of recordings and
// benchmarks. Live microphone input goes through MicDetector and the AudioWorklet instead.
import { EVENT_KINDS, THRESHOLD_IDS } from './protocol';
import type { DetectorEvent, DetectorMode, ThresholdName } from './protocol';
import { selectEngineBuild, wasmSimdSupported } from './simd';
import type { EngineBuild, EngineUrls } from './simd';

interface Exports {
  memory: WebAssembly.Memory;
  ot_input_capacity(): number;
  ot_expected_capacity(): number;
  ot_event_stride(): number;
  ot_detector_new(sampleRate: number): number;
  ot_detector_free(h: number): void;
  ot_detector_input_ptr(h: number): number;
  ot_detector_expected_ptr(h: number): number;
  ot_detector_events_ptr(h: number): number;
  ot_detector_process(h: number, n: number): number;
  ot_detector_set_expected(h: number, n: number): number;
  ot_detector_set_mode(h: number, mode: number): void;
  ot_detector_set_threshold(h: number, id: number, value: number): void;
}

/** Compiles engine.wasm from a URL, falling back when the server sends the wrong MIME type. */
export async function compileEngine(url: string): Promise<WebAssembly.Module> {
  if (typeof WebAssembly.compileStreaming === 'function') {
    try {
      return await WebAssembly.compileStreaming(fetch(url));
    } catch {
      // Fall through: some static hosts don't serve application/wasm.
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load the note detector (${res.status})`);
  return WebAssembly.compile(await res.arrayBuffer());
}

/**
 * Compiles the engine build that suits this browser (P0-12): the SIMD build where WebAssembly SIMD
 * is supported, the baseline otherwise. If the SIMD build cannot be loaded or compiled, falls back
 * to the baseline, so a wrong feature guess costs one extra download rather than the detector.
 */
export async function compileBestEngine(
  urls: EngineUrls,
  simd = wasmSimdSupported(),
): Promise<{ module: WebAssembly.Module; build: EngineBuild }> {
  if (selectEngineBuild(urls, simd) === 'simd' && urls.simd) {
    try {
      return { module: await compileEngine(urls.simd), build: 'simd' };
    } catch {
      // Fall through to the baseline build.
    }
  }
  return { module: await compileEngine(urls.baseline), build: 'baseline' };
}

/** A detector instance driven synchronously from JavaScript. Times are seconds of input. */
export class EngineDetector {
  private readonly e: Exports;
  private readonly h: number;

  constructor(module: WebAssembly.Module, sampleRate: number) {
    this.e = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
    this.h = this.e.ot_detector_new(sampleRate);
  }

  setExpected(pitches: readonly number[]): number {
    const cap = this.e.ot_expected_capacity();
    const view = new Uint8Array(this.e.memory.buffer, this.e.ot_detector_expected_ptr(this.h), cap);
    const n = Math.min(cap, pitches.length);
    for (let i = 0; i < n; i++) view[i] = pitches[i] ?? 0;
    return this.e.ot_detector_set_expected(this.h, n);
  }

  setMode(mode: DetectorMode): void {
    this.e.ot_detector_set_mode(this.h, mode === 'play-along' ? 1 : 0);
  }

  setThreshold(name: ThresholdName, value: number): void {
    this.e.ot_detector_set_threshold(this.h, THRESHOLD_IDS[name], value);
  }

  /** Feeds samples of any length and returns the events they produced. */
  process(samples: Float32Array): DetectorEvent[] {
    const cap = this.e.ot_input_capacity();
    const stride = this.e.ot_event_stride();
    const out: DetectorEvent[] = [];
    for (let pos = 0; pos < samples.length; pos += cap) {
      const chunk = samples.subarray(pos, Math.min(samples.length, pos + cap));
      new Float32Array(this.e.memory.buffer, this.e.ot_detector_input_ptr(this.h), cap).set(chunk);
      const count = this.e.ot_detector_process(this.h, chunk.length);
      const ev = new Float64Array(
        this.e.memory.buffer,
        this.e.ot_detector_events_ptr(this.h),
        count * stride,
      );
      for (let i = 0; i < count; i++) {
        const o = i * stride;
        out.push({
          kind: EVENT_KINDS[ev[o] ?? 0] ?? 'onset',
          pitch: ev[o + 1] ?? 0,
          time: ev[o + 2] ?? 0,
          confidence: ev[o + 3] ?? 0,
          odd: ev[o + 4] ?? 0,
          decidedAt: ev[o + 5] ?? 0,
          generation: ev[o + 6] ?? 0,
        });
      }
    }
    return out;
  }

  dispose(): void {
    this.e.ot_detector_free(this.h);
  }
}
