// Main-thread side of live microphone detection.
import type {
  DetectorEvent,
  DetectorMode,
  FromWorklet,
  ThresholdName,
  ToWorklet,
} from './protocol';

/**
 * Opens the microphone the way piano detection needs it: echo cancellation, noise suppression
 * and automatic gain control all off, because they distort piano tones (spec §5).
 */
export async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not allow microphone access.');
  }
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  });
}

export interface MicDetectorOptions {
  /** URL of the bundled detector worklet script. */
  workletUrl: string;
  /** Compiled engine.wasm (preferred) or its bytes. */
  engine: WebAssembly.Module | ArrayBuffer;
  mode?: DetectorMode;
}

const loadedContexts = new WeakSet<BaseAudioContext>();

/** Live detector on a microphone stream. Create the AudioContext from a user gesture first. */
export class MicDetector {
  /** Called with every batch of decisions; times are on the AudioContext clock. */
  onEvents: (events: DetectorEvent[]) => void = () => {};
  /** Called with raw audio while recording. */
  onAudio: (samples: Float32Array) => void = () => {};

  private generation = 0;
  private noiseWaiters: ((db: number) => void)[] = [];

  private constructor(
    readonly context: AudioContext,
    private readonly node: AudioWorkletNode,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly sink: GainNode,
  ) {
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => this.onMessage(e.data);
  }

  static async create(
    context: AudioContext,
    stream: MediaStream,
    options: MicDetectorOptions,
  ): Promise<MicDetector> {
    if (!loadedContexts.has(context)) {
      await context.audioWorklet.addModule(options.workletUrl);
      loadedContexts.add(context);
    }
    const processorOptions =
      options.engine instanceof WebAssembly.Module
        ? { module: options.engine, mode: options.mode }
        : { bytes: options.engine, mode: options.mode };
    const node = new AudioWorkletNode(context, 'opentiles-detector', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions,
    });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The note detector did not start.')), 5000);
      node.port.onmessage = (e: MessageEvent<FromWorklet>) => {
        if (e.data.type === 'ready') {
          clearTimeout(timer);
          resolve();
        } else if (e.data.type === 'error') {
          clearTimeout(timer);
          reject(new Error(e.data.message));
        }
      };
    });
    const source = context.createMediaStreamSource(stream);
    // Some browsers only pull audio through nodes connected to the destination; keep it silent.
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink);
    sink.connect(context.destination);
    await ready;
    return new MicDetector(context, node, source, sink);
  }

  private send(msg: ToWorklet): void {
    this.node.port.postMessage(msg);
  }

  private onMessage(msg: FromWorklet): void {
    switch (msg.type) {
      case 'events':
        this.onEvents(msg.events);
        break;
      case 'audio':
        this.onAudio(msg.samples);
        break;
      case 'noise-calibrated':
        for (const w of this.noiseWaiters.splice(0)) w(msg.noiseDb);
        break;
      default:
        break;
    }
  }

  /**
   * Sets the pitches expected next. Returns the generation number that decisions about these
   * pitches will carry, so callers can ignore late decisions about earlier steps.
   */
  setExpected(pitches: readonly number[]): number {
    this.send({ type: 'expected', pitches: [...pitches] });
    this.generation += 1;
    return this.generation;
  }

  setMode(mode: DetectorMode): void {
    this.send({ type: 'mode', mode });
  }

  setTuning(cents: number): void {
    this.send({ type: 'tuning', cents });
  }

  setThreshold(name: ThresholdName, value: number): void {
    this.send({ type: 'threshold', name, value });
  }

  /** Measures the room's noise floor for `ms` milliseconds. Resolves with the level in dB. */
  calibrateNoise(ms = 2000): Promise<number> {
    this.send({ type: 'calibrate-noise-start' });
    return new Promise((resolve) => {
      this.noiseWaiters.push(resolve);
      setTimeout(() => this.send({ type: 'calibrate-noise-end' }), ms);
    });
  }

  setRecording(on: boolean): void {
    this.send({ type: 'record', on });
  }

  dispose(): void {
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    this.node.port.onmessage = null;
  }
}
