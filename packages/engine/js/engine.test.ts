// Runs the real engine.wasm (built by `pnpm build:engine`) under Node. Skipped if not built.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EngineDetector } from './engine';

const wasmPath = fileURLToPath(new URL('../dist/engine.wasm', import.meta.url));
const built = existsSync(wasmPath);

/** A rough piano-like tone: decaying harmonics with a short attack. */
function tone(pitches: number[], sampleRate: number, seconds: number, at: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  const start = Math.round(at * sampleRate);
  for (const p of pitches) {
    const f0 = 440 * 2 ** ((p - 69) / 12);
    for (let n = 1; n <= 8; n++) {
      const f = n * f0;
      if (f > sampleRate * 0.45) break;
      const amp = 0.05 / n;
      for (let i = start; i < out.length; i++) {
        const t = (i - start) / sampleRate;
        out[i] =
          (out[i] ?? 0) +
          amp * Math.exp(-t * 2) * Math.min(1, t / 0.002) * Math.sin(2 * Math.PI * f * t);
      }
    }
  }
  // Light noise so the spectrum has a floor.
  let seed = 1;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = (out[i] ?? 0) + 1e-4 * (seed / 2147483648 - 0.5);
  }
  return out;
}

describe.skipIf(!built)('engine.wasm', () => {
  const module = built ? new WebAssembly.Module(readFileSync(wasmPath)) : null;

  it('accepts the expected chord', () => {
    const d = new EngineDetector(module!, 48000);
    const generation = d.setExpected([60, 64]);
    const events = d.process(tone([60, 64], 48000, 0.8, 0.3));
    const accepted = events.filter((e) => e.kind === 'expected').map((e) => e.pitch);
    expect(accepted.sort()).toEqual([60, 64]);
    expect(events.every((e) => e.kind === 'onset' || e.generation === generation)).toBe(true);
    d.dispose();
  });

  it('reports a wrong neighbour instead of accepting', () => {
    const d = new EngineDetector(module!, 48000);
    d.setExpected([60]);
    const events = d.process(tone([62], 48000, 0.8, 0.3));
    expect(events.some((e) => e.kind === 'expected')).toBe(false);
    expect(events.some((e) => e.kind === 'wrong' && e.pitch === 62)).toBe(true);
    d.dispose();
  });
});
