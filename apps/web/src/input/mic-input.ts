// Microphone input through the Rust detector in an AudioWorklet. Loaded lazily (dynamic import)
// so the app works even before the engine has been built.
import engineUrl from '@opentiles/engine/engine.wasm?url';
import engineSimdUrl from '@opentiles/engine/engine-simd.wasm?url';
import workletUrl from '@opentiles/engine/worklet?worker&url';
import { compileBestEngine, MicDetector, openMicrophone } from '@opentiles/engine';
import type { DetectorEvent, DetectorMode, DetectorStats, EngineBuild } from '@opentiles/engine';
import { rmsDb } from '@opentiles/practice';
import type { InputAdapter, NoteEvent } from '@opentiles/practice';
import { unlockAudio } from '../audio/context';
import { t } from '../i18n';

let modulePromise: Promise<WebAssembly.Module> | null = null;
let loadedBuild: EngineBuild | null = null;

/**
 * Compiles the note detector once: the WebAssembly SIMD build where the browser supports it, the
 * baseline build otherwise (P0-12). Only the chosen build is downloaded, plus the baseline if the
 * SIMD build fails to load.
 */
export function loadEngine(): Promise<WebAssembly.Module> {
  modulePromise ??= compileBestEngine({ baseline: engineUrl, simd: engineSimdUrl }).then(
    ({ module, build }) => {
      loadedBuild = build;
      return module;
    },
    (e: unknown) => {
      modulePromise = null;
      throw e;
    },
  );
  return modulePromise;
}

/** Which engine build {@link loadEngine} loaded, or null before it has finished. */
export function engineBuild(): EngineBuild | null {
  return loadedBuild;
}

export async function createMicDetector(
  mode: DetectorMode = 'wait',
  deviceId?: string,
): Promise<{ detector: MicDetector; stream: MediaStream; context: AudioContext }> {
  const context = await unlockAudio();
  // The detector runs in an AudioWorklet, which only runs while the context does.
  if (context.state !== 'running') {
    throw new Error(
      t(
        'Sound could not be started in this browser, so the microphone cannot listen. Check that a sound output is connected and try again.',
      ),
    );
  }
  const [stream, engine] = await Promise.all([openMicrophone(deviceId), loadEngine()]);
  try {
    const detector = await MicDetector.create(context, stream, { workletUrl, engine, mode });
    return { detector, stream, context };
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    throw e;
  }
}

export class MicInput implements InputAdapter {
  readonly source = 'microphone' as const;
  onNote: (event: NoteEvent) => void = () => {};
  /** Every raw decision, for diagnostics. */
  onDetector: (events: DetectorEvent[]) => void = () => {};
  private detector: MicDetector | null = null;
  private stream: MediaStream | null = null;
  private generation = -1;
  private pendingExpected: number[] | null = null;
  private context: AudioContext | null = null;
  private meter: { source: MediaStreamAudioSourceNode; analyser: AnalyserNode } | null = null;
  private meterBuffer: Float32Array<ArrayBuffer> | null = null;

  constructor(private mode: DetectorMode = 'wait') {}

  async start(): Promise<void> {
    const { detector, stream, context } = await createMicDetector(this.mode);
    this.detector = detector;
    this.stream = stream;
    this.context = context;
    detector.onEvents = (events) => {
      this.onDetector(events);
      for (const e of events) {
        // Ignore late decisions about a step the learner has already left.
        if (e.generation !== this.generation) continue;
        if (e.kind === 'expected' || e.kind === 'wrong') {
          this.onNote({
            pitch: e.pitch,
            time: e.time,
            confidence: e.confidence,
            source: 'microphone',
          });
        }
      }
    };
    if (this.pendingExpected) this.setExpected(this.pendingExpected);
  }

  /** Tells the detector which pitches to listen for next (score-informed detection). */
  setExpected(pitches: readonly number[]): void {
    if (!this.detector) {
      this.pendingExpected = [...pitches];
      return;
    }
    this.generation = this.detector.setExpected(pitches);
  }

  setMode(mode: DetectorMode): void {
    this.mode = mode;
    this.detector?.setMode(mode);
  }

  calibrateNoise(ms = 2000): Promise<number> {
    return this.detector ? this.detector.calibrateNoise(ms) : Promise.resolve(Number.NaN);
  }

  /** Corrects the detector for a piano tuned away from A = 440 Hz (cents). */
  setTuning(cents: number): void {
    this.detector?.setTuning(cents);
  }

  stats(): Promise<DetectorStats | null> {
    return this.detector ? this.detector.stats() : Promise.resolve(null);
  }

  /**
   * Names this microphone for per-device calibration: the browser's label, else its device id.
   * Labels are only read locally and only stored on this device.
   */
  get deviceKey(): string {
    const track = this.stream?.getAudioTracks()[0];
    return track?.label || track?.getSettings().deviceId || 'default';
  }

  /** Output latency of the audio context (seconds), for the speaker-click test. */
  get outputLatency(): number {
    const ctx = this.context;
    if (!ctx) return 0;
    return (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
  }

  /** Current input level (RMS dBFS) over the last ~20 ms, for the calibration level check. */
  level(): number {
    if (!this.meter) {
      if (!this.context || !this.stream) return -Infinity;
      const source = this.context.createMediaStreamSource(this.stream);
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      this.meter = { source, analyser };
      this.meterBuffer = new Float32Array(analyser.fftSize);
    }
    const buf = this.meterBuffer as Float32Array<ArrayBuffer>;
    this.meter.analyser.getFloatTimeDomainData(buf);
    return rmsDb(buf);
  }

  stop(): void {
    this.meter?.source.disconnect();
    this.meter = null;
    this.detector?.dispose();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.detector = null;
    this.stream = null;
  }
}
