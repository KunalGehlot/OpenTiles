// Times the detector per analysis hop in each WebAssembly build (P0-12), on the same synthetic
// passage: chords and bass notes every 0.4 s, with the expected pitches set before each one, so the
// run includes onset hops and the costlier decision hops. Spec target: ≤ 2 ms per hop on an older
// iPad (spec §7); a desktop should be far below that.
//
// Every run processes identical audio, so each hop does the same work every time. The script keeps
// each hop's fastest time over the runs, which filters out interruptions from other processes, and
// reports statistics over those per-hop times.
//
// Usage: node scripts/bench-wasm.mjs [--rate 48000] [--seconds 20] [--runs 5] [file.wasm ...]
// Without files it compares dist/engine.wasm and dist/engine-simd.wasm.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const [, value] = args.splice(i, 2);
  return Number(value);
};
const sampleRate = option('--rate', 48000);
const seconds = option('--seconds', 20);
const runs = option('--runs', 5);
const files = args.length
  ? args
  : ['engine.wasm', 'engine-simd.wasm'].map((f) => join(here, '..', 'dist', f));
for (const f of files) {
  if (!existsSync(f)) {
    console.error(`${f} not found; run pnpm build:engine first.`);
    process.exit(1);
  }
}

// Same frame and hop sizes as DetectorConfig::new (src/config.rs).
const frame = 2 ** Math.ceil(Math.log2(Math.floor(sampleRate * 0.04)));
const hop = frame / 8;

/** Steps of the passage: when, what is expected, what is played (every fifth step is wrong). */
const steps = [];
for (let i = 0, at = 0.3; at < seconds - 0.5; i++, at += 0.4) {
  const root = 36 + ((i * 7) % 48);
  const expected = i % 3 === 0 ? [root] : [root, root + 4, root + 7];
  const played = i % 5 === 4 ? expected.map((p) => p + 1) : expected;
  steps.push({ at, expected, played });
}

/** Decaying harmonics, rendered with a rotating phasor (fast and deterministic). */
function render() {
  const mix = new Float64Array(Math.round(seconds * sampleRate));
  const decay = Math.exp(-2.5 / sampleRate);
  for (const { at, played } of steps) {
    const start = Math.round(at * sampleRate);
    const end = Math.min(mix.length, start + 3 * sampleRate);
    for (const pitch of played) {
      const f0 = 440 * 2 ** ((pitch - 69) / 12);
      for (let n = 1; n <= 8 && n * f0 < sampleRate * 0.45; n++) {
        const w = (2 * Math.PI * n * f0) / sampleRate;
        const c = Math.cos(w);
        const s = Math.sin(w);
        let re = 1;
        let im = 0;
        let env = 0.05 / n;
        for (let i = start; i < end; i++) {
          mix[i] += env * Math.min(1, (i - start) / (0.002 * sampleRate)) * im;
          const next = re * c - im * s;
          im = re * s + im * c;
          re = next;
          env *= decay;
        }
      }
    }
  }
  let seed = 1;
  const out = new Float32Array(mix.length);
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out[i] = mix[i] + 1e-4 * (seed / 2147483648 - 0.5);
  }
  return out;
}

/** Runs the passage once, one hop per call; returns per-hop times (ms) and the event count. */
function pass(module, audio) {
  const { exports: e } = new WebAssembly.Instance(module, {});
  const h = e.ot_detector_new(sampleRate);
  const input = new Float32Array(e.memory.buffer, e.ot_detector_input_ptr(h), hop);
  const expected = new Uint8Array(e.memory.buffer, e.ot_detector_expected_ptr(h), 16);
  const times = new Float64Array(Math.floor(audio.length / hop));
  let events = 0;
  let next = 0;
  for (let k = 0; k < times.length; k++) {
    const pos = k * hop;
    const step = steps[next];
    if (step && pos >= (step.at - 0.08) * sampleRate) {
      expected.set(step.expected);
      e.ot_detector_set_expected(h, step.expected.length);
      next++;
    }
    input.set(audio.subarray(pos, pos + hop));
    const t0 = performance.now();
    events += e.ot_detector_process(h, hop);
    times[k] = performance.now() - t0;
  }
  e.ot_detector_free(h);
  return { times, events };
}

const audio = render();
const builds = files.map((path) => {
  const module = new WebAssembly.Module(readFileSync(path));
  const { exports } = new WebAssembly.Instance(module, {});
  const simd = typeof exports.ot_build_features === 'function' && exports.ot_build_features() & 1;
  return { path, module, simd: Boolean(simd), times: null, events: 0 };
});
for (const b of builds) pass(b.module, audio); // warm-up: let the JIT tier up
for (let r = 0; r < runs; r++) {
  // Interleave the builds so drift in machine load affects them alike.
  for (const b of builds) {
    const { times, events } = pass(b.module, audio);
    b.times = b.times ? b.times.map((t, k) => Math.min(t, times[k])) : times;
    b.events = events;
  }
}

const us = (ms) => `${(ms * 1000).toFixed(1)} µs`;
const hopMs = (hop / sampleRate) * 1000;
console.log(
  `${seconds} s at ${sampleRate} Hz, hop ${hop} samples (${hopMs.toFixed(2)} ms), ${steps.length} ` +
    `steps, fastest of ${runs} runs per hop; Node ${process.version} on ${process.arch}`,
);
const label = (b) => `${basename(b.path)}${b.simd ? ' (SIMD)' : ''}`;
const width = Math.max(...builds.map((b) => label(b).length)) + 2;
const columns = ['mean', 'median', 'p95', 'p99', 'max'];
console.log(['build'.padEnd(width), ...columns.map((c) => c.padEnd(10)), 'events'].join(' '));
for (const b of builds) {
  const t = [...b.times].sort((x, y) => x - y);
  const at = (q) => t[Math.min(t.length - 1, Math.floor(q * t.length))];
  b.mean = t.reduce((s, x) => s + x, 0) / t.length;
  const values = [b.mean, at(0.5), at(0.95), at(0.99), t[t.length - 1]];
  console.log([label(b).padEnd(width), ...values.map((x) => us(x).padEnd(10)), b.events].join(' '));
}
const [first, ...rest] = builds;
for (const b of rest) {
  const share = ((b.mean / first.mean) * 100).toFixed(0);
  console.log(`${label(b)}: ${share} % of the mean time per hop of ${label(first)}`);
}
