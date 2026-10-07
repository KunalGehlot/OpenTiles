// AudioWorklet processor that feeds microphone audio to the Rust detector (engine.wasm).
//
// The module is instantiated synchronously from the bytes or WebAssembly.Module passed in
// processorOptions (ADR 0002): the worklet scope has no fetch, and the engine imports nothing.
import { EVENT_KINDS, THRESHOLD_IDS } from './protocol';
import type { DetectorEvent, FromWorklet, ToWorklet } from './protocol';

interface EngineExports {
  memory: WebAssembly.Memory;
  ot_version(): number;
  ot_input_capacity(): number;
  ot_expected_capacity(): number;
  ot_event_stride(): number;
  ot_detector_new(sampleRate: number): number;
  ot_detector_input_ptr(h: number): number;
  ot_detector_expected_ptr(h: number): number;
  ot_detector_events_ptr(h: number): number;
  ot_detector_process(h: number, n: number): number;
  ot_detector_set_expected(h: number, n: number): number;
  ot_detector_set_mode(h: number, mode: number): void;
  ot_detector_set_tuning(h: number, cents: number): void;
  ot_detector_tuning_estimate(h: number): number;
  ot_detector_set_threshold(h: number, id: number, value: number): void;
  ot_detector_begin_noise_calibration(h: number): void;
  ot_detector_end_noise_calibration(h: number): number;
  ot_detector_dropped_events(h: number): number;
}

export interface DetectorProcessorOptions {
  module?: WebAssembly.Module;
  bytes?: ArrayBuffer;
  mode?: 'wait' | 'play-along';
}

const RECORD_CHUNK = 8192;

class DetectorProcessor extends AudioWorkletProcessor {
  private engine: EngineExports | null = null;
  private handle = 0;
  private input = new Float32Array(0);
  private expected = new Uint8Array(0);
  private events = new Float64Array(0);
  private buffer: ArrayBuffer | null = null;
  private stride = 7;
  /** AudioContext time of the detector's first sample. */
  private base = -1;
  private recording: Float32Array | null = null;
  private recorded = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super(options);
    const opts = (options.processorOptions ?? {}) as DetectorProcessorOptions;
    try {
      const module = opts.module ?? new WebAssembly.Module(opts.bytes ?? new ArrayBuffer(0));
      const engine = new WebAssembly.Instance(module, {}).exports as unknown as EngineExports;
      this.engine = engine;
      this.handle = engine.ot_detector_new(sampleRate);
      this.stride = engine.ot_event_stride();
      if (opts.mode === 'play-along') engine.ot_detector_set_mode(this.handle, 1);
      this.refreshViews();
      this.post({ type: 'ready', sampleRate, version: engine.ot_version() });
    } catch (err) {
      this.post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => this.onMessage(e.data);
  }

  private post(msg: FromWorklet, transfer: Transferable[] = []): void {
    this.port.postMessage(msg, transfer);
  }

  /** Views on wasm memory must be rebuilt if the memory grew (its buffer changes identity). */
  private refreshViews(): void {
    const e = this.engine;
    if (!e || this.buffer === e.memory.buffer) return;
    this.buffer = e.memory.buffer;
    const h = this.handle;
    this.input = new Float32Array(this.buffer, e.ot_detector_input_ptr(h), e.ot_input_capacity());
    this.expected = new Uint8Array(
      this.buffer,
      e.ot_detector_expected_ptr(h),
      e.ot_expected_capacity(),
    );
    this.events = new Float64Array(this.buffer, e.ot_detector_events_ptr(h), 64 * this.stride);
  }

  private onMessage(msg: ToWorklet): void {
    const e = this.engine;
    if (!e) return;
    this.refreshViews();
    const h = this.handle;
    switch (msg.type) {
      case 'expected': {
        const n = Math.min(msg.pitches.length, this.expected.length);
        for (let i = 0; i < n; i++) this.expected[i] = msg.pitches[i] ?? 0;
        const generation = e.ot_detector_set_expected(h, n);
        this.post({ type: 'expected-set', generation });
        break;
      }
      case 'mode':
        e.ot_detector_set_mode(h, msg.mode === 'play-along' ? 1 : 0);
        break;
      case 'tuning':
        e.ot_detector_set_tuning(h, msg.cents);
        break;
      case 'threshold':
        e.ot_detector_set_threshold(h, THRESHOLD_IDS[msg.name], msg.value);
        break;
      case 'calibrate-noise-start':
        e.ot_detector_begin_noise_calibration(h);
        break;
      case 'calibrate-noise-end':
        this.post({ type: 'noise-calibrated', noiseDb: e.ot_detector_end_noise_calibration(h) });
        break;
      case 'record':
        if (msg.on) {
          this.recording = new Float32Array(RECORD_CHUNK);
          this.recorded = 0;
        } else {
          this.flushRecording();
          this.recording = null;
        }
        break;
      case 'stats':
        this.post({
          type: 'stats',
          droppedEvents: e.ot_detector_dropped_events(h),
          tuningEstimate: e.ot_detector_tuning_estimate(h),
          generation: -1,
        });
        break;
    }
  }

  private flushRecording(): void {
    if (!this.recording || this.recorded === 0) return;
    const chunk = this.recording.slice(0, this.recorded);
    this.post({ type: 'audio', samples: chunk }, [chunk.buffer]);
    this.recorded = 0;
  }

  process(inputs: Float32Array[][]): boolean {
    const e = this.engine;
    const channels = inputs[0];
    if (!e || !channels || channels.length === 0) return true;
    const first = channels[0];
    if (!first) return true;
    if (this.base < 0) this.base = currentTime;
    this.refreshViews();
    const n = Math.min(first.length, this.input.length);
    // Mix down to mono.
    if (channels.length === 1) {
      this.input.set(first.subarray(0, n));
    } else {
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (const ch of channels) sum += ch[i] ?? 0;
        this.input[i] = sum / channels.length;
      }
    }
    if (this.recording) {
      for (let i = 0; i < n; i++) {
        this.recording[this.recorded++] = this.input[i] ?? 0;
        if (this.recorded === this.recording.length) this.flushRecording();
      }
    }
    const count = e.ot_detector_process(this.handle, n);
    if (count > 0) {
      this.refreshViews();
      const out: DetectorEvent[] = [];
      for (let i = 0; i < count; i++) {
        const o = i * this.stride;
        const ev = this.events;
        out.push({
          kind: EVENT_KINDS[ev[o] ?? 0] ?? 'onset',
          pitch: ev[o + 1] ?? 0,
          time: this.base + (ev[o + 2] ?? 0),
          confidence: ev[o + 3] ?? 0,
          odd: ev[o + 4] ?? 0,
          decidedAt: this.base + (ev[o + 5] ?? 0),
          generation: ev[o + 6] ?? 0,
        });
      }
      this.post({ type: 'events', events: out });
    }
    return true;
  }
}

registerProcessor('opentiles-detector', DetectorProcessor);
