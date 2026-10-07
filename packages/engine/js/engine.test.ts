// Runs the real engine builds (made by `pnpm build:engine`) under Node: dist/engine.wasm and, when
// present, dist/engine-simd.wasm. Skipped for a build that has not been made.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EngineDetector } from './engine';
import { tone } from './test-audio';

const builds = [
  { name: 'engine.wasm', simd: false },
  { name: 'engine-simd.wasm', simd: true },
].map((b) => {
  const path = fileURLToPath(new URL(`../dist/${b.name}`, import.meta.url));
  return { ...b, path, built: existsSync(path) };
});

describe.each(builds)('$name', ({ path, built, simd }) => {
  const module = built ? new WebAssembly.Module(readFileSync(path)) : null;

  it.skipIf(!built)('reports how it was built', () => {
    const e = new WebAssembly.Instance(module!, {}).exports as { ot_build_features(): number };
    expect((e.ot_build_features() & 1) === 1).toBe(simd);
  });

  it.skipIf(!built)('accepts the expected chord', () => {
    const d = new EngineDetector(module!, 48000);
    const generation = d.setExpected([60, 64]);
    const events = d.process(tone([60, 64], 48000, 0.8, 0.3));
    const accepted = events.filter((e) => e.kind === 'expected').map((e) => e.pitch);
    expect(accepted.sort()).toEqual([60, 64]);
    expect(events.every((e) => e.kind === 'onset' || e.generation === generation)).toBe(true);
    d.dispose();
  });

  it.skipIf(!built)('reports a wrong neighbour instead of accepting', () => {
    const d = new EngineDetector(module!, 48000);
    d.setExpected([60]);
    const events = d.process(tone([62], 48000, 0.8, 0.3));
    expect(events.some((e) => e.kind === 'expected')).toBe(false);
    expect(events.some((e) => e.kind === 'wrong' && e.pitch === 62)).toBe(true);
    d.dispose();
  });
});
