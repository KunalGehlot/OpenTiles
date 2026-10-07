// Runs the vendored Basic Pitch model on the TensorFlow.js CPU backend over a synthesised,
// piano-like tone sequence (generated here, so CC0) and checks the right pitches come out.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as tf from '@tensorflow/tfjs-core';
import { describe, expect, it } from 'vitest';
import { SAMPLE_RATE, transcribe } from '../src/transcribe';

const modelDir = resolve(import.meta.dirname, '../../../apps/web/public/models/basic-pitch');

interface ModelJson {
  format: string;
  generatedBy: string;
  convertedBy: string;
  modelTopology: object;
  signature: object;
  weightsManifest: { paths: string[]; weights: tf.io.WeightsManifestEntry[] }[];
}

function modelHandler(): tf.io.IOHandler {
  const json = JSON.parse(readFileSync(resolve(modelDir, 'model.json'), 'utf8')) as ModelJson;
  const group = json.weightsManifest[0];
  if (!group) throw new Error('model.json has no weights');
  const bin = readFileSync(resolve(modelDir, group.paths[0] ?? ''));
  return tf.io.fromMemory({
    format: json.format,
    generatedBy: json.generatedBy,
    convertedBy: json.convertedBy,
    modelTopology: json.modelTopology,
    signature: json.signature,
    weightSpecs: group.weights,
    weightData: bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
  });
}

/** A decaying tone with a few harmonics, roughly like a struck string. */
function synthesise(notes: { pitch: number; start: number; duration: number }[], length: number) {
  const out = new Float32Array(Math.round(length * SAMPLE_RATE));
  for (const n of notes) {
    const f = 440 * 2 ** ((n.pitch - 69) / 12);
    const s0 = Math.round(n.start * SAMPLE_RATE);
    const len = Math.round(n.duration * SAMPLE_RATE);
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.005);
      const release = Math.min(1, (len - i) / (0.01 * SAMPLE_RATE));
      const env = attack * release * Math.exp(-2.5 * t);
      let v = 0;
      for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / h ** 1.5;
      out[s0 + i] = (out[s0 + i] ?? 0) + 0.25 * env * v;
    }
  }
  return out;
}

describe('transcribe (Basic Pitch on the CPU backend)', () => {
  it('finds the pitches of a short melody', { timeout: 120_000 }, async () => {
    const melody = [
      { pitch: 60, start: 0.2, duration: 0.5 },
      { pitch: 64, start: 0.8, duration: 0.5 },
      { pitch: 67, start: 1.4, duration: 0.5 },
      { pitch: 72, start: 2.0, duration: 0.5 },
      { pitch: 55, start: 2.6, duration: 0.8 },
    ];
    const progress: number[] = [];
    const notes = await transcribe(synthesise(melody, 4), (p) => progress.push(p), {
      model: modelHandler(),
      backends: ['cpu'],
    });

    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);

    // Each played note is found, starting near the right time.
    for (const m of melody) {
      const hit = notes.find(
        (n) => n.pitch === m.pitch && Math.abs(n.startSeconds - m.start) < 0.1,
      );
      expect(hit, `pitch ${m.pitch} at ${m.start}s`).toBeDefined();
    }
    // Nothing loud at a pitch that was never played (harmonics may add a few weak extras).
    const played = new Set(melody.map((m) => m.pitch));
    const strongExtras = notes.filter((n) => !played.has(n.pitch) && n.amplitude > 0.5);
    expect(strongExtras).toEqual([]);
  });

  it('returns no notes for silence', { timeout: 60_000 }, async () => {
    const notes = await transcribe(new Float32Array(SAMPLE_RATE), () => {}, {
      model: modelHandler(),
      backends: ['cpu'],
    });
    expect(notes).toEqual([]);
  });
});
