// The SIMD and baseline engine builds must make the same decisions (P0-12): the SIMD build only
// changes how the FFTs and loops are computed, so it may differ in rounding, never in outcome.
// Skipped unless `pnpm build:engine` has made both dist/engine.wasm and dist/engine-simd.wasm.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EngineDetector } from './engine';
import type { DetectorEvent, DetectorMode } from './protocol';
import { renderNotes } from './test-audio';
import type { ToneNote } from './test-audio';

const path = (name: string) => fileURLToPath(new URL(`../dist/${name}`, import.meta.url));
const baselinePath = path('engine.wasm');
const simdPath = path('engine-simd.wasm');
const built = existsSync(baselinePath) && existsSync(simdPath);

interface Step {
  at: number;
  expected: number[];
  played: number[];
}

/** Feeds `audio`, installing each step's expected pitches 80 ms before it is played. */
function run(
  module: WebAssembly.Module,
  sampleRate: number,
  mode: DetectorMode,
  steps: readonly Step[],
  audio: Float32Array,
): DetectorEvent[] {
  const d = new EngineDetector(module, sampleRate);
  d.setMode(mode);
  const events: DetectorEvent[] = [];
  let pos = 0;
  for (const step of steps) {
    const until = Math.max(pos, Math.round((step.at - 0.08) * sampleRate));
    events.push(...d.process(audio.subarray(pos, until)));
    pos = until;
    d.setExpected(step.expected);
  }
  events.push(...d.process(audio.subarray(pos)));
  d.dispose();
  return events;
}

/** A passage across the keyboard: single notes, chords, bass notes and some wrong notes. */
function passage(count: number, seed: number): { steps: Step[]; seconds: number } {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
  const steps: Step[] = [];
  let at = 0.4;
  for (let i = 0; i < count; i++) {
    const root = 36 + Math.floor(rand() * 54); // C2 to F#6
    const size = 1 + Math.floor(rand() * 3);
    const expected = [root, root + 4, root + 7].slice(0, size);
    // Every fourth step plays a neighbouring wrong note instead of the first expected one.
    const played = i % 4 === 3 ? [root + 2, ...expected.slice(1)] : expected;
    steps.push({ at, expected, played });
    at += 0.35 + rand() * 0.25;
  }
  return { steps, seconds: at + 0.5 };
}

describe.skipIf(!built)('engine.wasm and engine-simd.wasm', () => {
  const baseline = built ? new WebAssembly.Module(readFileSync(baselinePath)) : null;
  const simd = built ? new WebAssembly.Module(readFileSync(simdPath)) : null;

  const cases: { name: string; sampleRate: number; mode: DetectorMode; seed: number }[] = [
    { name: 'wait mode at 48 kHz', sampleRate: 48000, mode: 'wait', seed: 11 },
    { name: 'play-along mode at 44.1 kHz', sampleRate: 44100, mode: 'play-along', seed: 23 },
  ];

  it.each(cases)('decide alike in $name', ({ sampleRate, mode, seed }) => {
    const { steps, seconds } = passage(24, seed);
    const notes: ToneNote[] = steps.flatMap((s) => s.played.map((pitch) => ({ pitch, at: s.at })));
    const audio = renderNotes(notes, sampleRate, seconds);
    const a = run(baseline!, sampleRate, mode, steps, audio);
    const b = run(simd!, sampleRate, mode, steps, audio);

    // The passage must exercise the detector, or agreeing would prove nothing.
    expect(a.filter((e) => e.kind === 'onset').length).toBeGreaterThan(steps.length / 2);
    expect(a.filter((e) => e.kind === 'expected').length).toBeGreaterThan(steps.length / 2);
    expect(a.some((e) => e.kind === 'wrong')).toBe(true);

    // Same decisions at the same sample positions; scores may differ only by f32 rounding (about
    // 5e-7 when this test was written).
    const outcome = (e: DetectorEvent) => [e.kind, e.pitch, e.generation, e.time, e.decidedAt];
    expect(b.map(outcome)).toEqual(a.map(outcome));
    for (const [i, e] of a.entries()) {
      expect(b[i]!.confidence).toBeCloseTo(e.confidence, 4);
      expect(b[i]!.odd).toBeCloseTo(e.odd, 4);
    }
  });

  it('stay silent on silence with notes expected', () => {
    const audio = renderNotes([], 48000, 2);
    const steps: Step[] = [{ at: 0.5, expected: [60, 64, 67], played: [] }];
    expect(run(baseline!, 48000, 'wait', steps, audio)).toEqual([]);
    expect(run(simd!, 48000, 'wait', steps, audio)).toEqual([]);
  });
});
