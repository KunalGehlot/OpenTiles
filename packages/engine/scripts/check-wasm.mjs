// Verifies that the engine's WebAssembly module imports nothing (ADR 0002) and exports the C ABI
// the AudioWorklet expects. Usage: node check-wasm.mjs <path/to/engine.wasm>
import { readFileSync } from 'node:fs';

const REQUIRED_EXPORTS = [
  'memory',
  'ot_version',
  'ot_input_capacity',
  'ot_expected_capacity',
  'ot_event_stride',
  'ot_detector_new',
  'ot_detector_free',
  'ot_detector_input_ptr',
  'ot_detector_expected_ptr',
  'ot_detector_events_ptr',
  'ot_detector_process',
  'ot_detector_set_expected',
  'ot_detector_set_mode',
  'ot_detector_set_tuning',
  'ot_detector_tuning_estimate',
  'ot_detector_set_threshold',
  'ot_detector_begin_noise_calibration',
  'ot_detector_end_noise_calibration',
  'ot_detector_dropped_events',
];

const path = process.argv[2];
if (!path) {
  console.error('usage: node check-wasm.mjs <engine.wasm>');
  process.exit(2);
}
const bytes = readFileSync(path);
const module = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(module);
const exports = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
let ok = true;
if (imports.length > 0) {
  ok = false;
  console.error('The engine must not import anything, but imports:');
  for (const i of imports) console.error(`  ${i.module}.${i.name} (${i.kind})`);
}
for (const name of REQUIRED_EXPORTS) {
  if (!exports.has(name)) {
    ok = false;
    console.error(`Missing export: ${name}`);
  }
}
// Smoke test: run one second of silence through a detector.
if (ok) {
  const { exports: e } = new WebAssembly.Instance(module, {});
  const h = e.ot_detector_new(48000);
  const cap = e.ot_input_capacity();
  const input = new Float32Array(e.memory.buffer, e.ot_detector_input_ptr(h), cap);
  input.fill(0);
  let events = 0;
  for (let i = 0; i < 48000 / cap; i++) events += e.ot_detector_process(h, cap);
  e.ot_detector_free(h);
  if (events !== 0) {
    ok = false;
    console.error(`Silence produced ${events} events`);
  }
}
console.log(
  `${path}: ${(bytes.length / 1024).toFixed(0)} KiB, ${exports.size} exports, ${imports.length} imports`,
);
process.exit(ok ? 0 : 1);
