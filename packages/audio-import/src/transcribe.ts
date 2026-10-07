// Runs Spotify's Basic Pitch model (Apache-2.0) over a mono 22 050 Hz recording, entirely on the
// device (hard rule 3). The windowing below follows `BasicPitch.evaluateModel` from
// @spotify/basic-pitch; it is reimplemented on the modular TensorFlow.js 4 packages because the
// published class imports the whole of TensorFlow.js 3 (layers, data and every backend), which
// is far heavier and would share TensorFlow's global engine with a second copy. The note
// extraction is Basic Pitch's own `outputToNotesPoly`.
import * as tf from '@tensorflow/tfjs-core';
import { loadGraphModel } from '@tensorflow/tfjs-converter';
import type { GraphModel } from '@tensorflow/tfjs-converter';
import '@tensorflow/tfjs-backend-cpu';
import { noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch/esm/toMidi.js';
import { cleanNotes } from './notes';
import type { AudioNote, CleanOptions } from './notes';

// From basic_pitch/constants.py.
export const SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const ANNOTATIONS_FPS = Math.floor(SAMPLE_RATE / FFT_HOP);
const AUDIO_N_SAMPLES = SAMPLE_RATE * 2 - FFT_HOP;
const N_OVERLAPPING_FRAMES = 30;
const N_OVERLAP_OVER_2 = N_OVERLAPPING_FRAMES / 2;
const OVERLAP_LENGTH = N_OVERLAPPING_FRAMES * FFT_HOP;
const HOP_SIZE = AUDIO_N_SAMPLES - OVERLAP_LENGTH;

const OUTPUT_FRAMES = 'Identity_1';
const OUTPUT_ONSETS = 'Identity_2';

export type Backend = 'webgl' | 'cpu';

export interface TranscribeOptions extends CleanOptions {
  /**
   * Where the model lives: a URL to `model.json` (same origin; the web app vendors it under
   * `models/basic-pitch/`) or a TensorFlow.js IO handler. Default `models/basic-pitch/model.json`.
   */
  model?: string | tf.io.IOHandler;
  /** Backends to try in order. Default WebGL, then CPU. */
  backends?: Backend[];
  /** Minimum onset activation to start a note (Basic Pitch default 0.5). */
  onsetThreshold?: number;
  /** Minimum frame activation to keep a note sounding (Basic Pitch default 0.3). */
  frameThreshold?: number;
  /** Lets the caller stop a long transcription. */
  signal?: AbortSignal;
}

export const DEFAULT_MODEL_URL = 'models/basic-pitch/model.json';

const models = new Map<string | tf.io.IOHandler, Promise<GraphModel>>();

async function chooseBackend(backends: readonly Backend[]): Promise<void> {
  for (const name of backends) {
    if (name === 'webgl') await import('@tensorflow/tfjs-backend-webgl');
    try {
      if (await tf.setBackend(name)) {
        await tf.ready();
        return;
      }
    } catch {
      // Try the next backend (WebGL is missing in some embedded views).
    }
  }
  throw new Error('No TensorFlow.js backend is available to run the transcription.');
}

function loadModel(source: string | tf.io.IOHandler): Promise<GraphModel> {
  let model = models.get(source);
  if (!model) {
    model = loadGraphModel(source);
    models.set(source, model);
    model.catch(() => models.delete(source));
  }
  return model;
}

/**
 * Transcribes a mono recording at 22 050 Hz into approximate notes. `onProgress` gets values
 * from 0 to 1. The result is already cleaned with `cleanNotes`.
 */
export async function transcribe(
  samples: Float32Array,
  onProgress: (fraction: number) => void = () => {},
  options: TranscribeOptions = {},
): Promise<AudioNote[]> {
  await chooseBackend(options.backends ?? ['webgl', 'cpu']);
  const model = await loadModel(options.model ?? DEFAULT_MODEL_URL);

  // Pad the front by half an overlap so the first frames are not cut off (as Basic Pitch does).
  const padded = new Float32Array(OVERLAP_LENGTH / 2 + samples.length);
  padded.set(samples, OVERLAP_LENGTH / 2);
  const windowCount = Math.max(1, Math.ceil(padded.length / HOP_SIZE));
  const totalFrames = Math.floor((samples.length * ANNOTATIONS_FPS) / SAMPLE_RATE);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const window = new Float32Array(AUDIO_N_SAMPLES);
  for (let w = 0; w < windowCount && frames.length < totalFrames; w++) {
    if (options.signal?.aborted) throw new DOMException('Transcription cancelled.', 'AbortError');
    onProgress(w / windowCount);
    window.fill(0);
    window.set(padded.subarray(w * HOP_SIZE, w * HOP_SIZE + AUDIO_N_SAMPLES));

    const [f, o] = tf.tidy(() => {
      const input = tf.tensor3d(window, [1, AUDIO_N_SAMPLES, 1]);
      const out = model.execute(input, [OUTPUT_FRAMES, OUTPUT_ONSETS]) as tf.Tensor3D[];
      return out.map((t) => {
        const [, n = 0, bins = 0] = t.shape;
        return tf.squeeze(
          tf.slice(t, [0, N_OVERLAP_OVER_2, 0], [1, n - 2 * N_OVERLAP_OVER_2, bins]),
          [0],
        );
      }) as [tf.Tensor2D, tf.Tensor2D];
    });
    const [fa, oa] = await Promise.all([f.array(), o.array()]);
    f.dispose();
    o.dispose();
    const keep = Math.min(fa.length, totalFrames - frames.length);
    frames.push(...fa.slice(0, keep));
    onsets.push(...oa.slice(0, keep));
    // Let the page repaint the progress bar between windows.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  onProgress(1);
  if (frames.length === 0) return [];

  const minNoteFrames = Math.max(
    1,
    Math.round((options.minDurationSeconds ?? 0.06) * ANNOTATIONS_FPS),
  );
  const events = noteFramesToTime(
    outputToNotesPoly(
      frames,
      onsets,
      options.onsetThreshold ?? 0.5,
      options.frameThreshold ?? 0.3,
      minNoteFrames,
    ),
  );
  return cleanNotes(
    events.map((e) => ({
      pitch: e.pitchMidi,
      startSeconds: e.startTimeSeconds,
      durationSeconds: e.durationSeconds,
      amplitude: e.amplitude,
    })),
    options,
  );
}
