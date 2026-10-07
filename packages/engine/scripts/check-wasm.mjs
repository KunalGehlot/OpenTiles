// Verifies the engine's WebAssembly modules: they import nothing (ADR 0002), export the C ABI the
// AudioWorklet expects, stay silent on silence, and are the build they claim to be (P0-12): the
// baseline must contain no SIMD instruction, so it loads where WebAssembly SIMD is missing, and
// the SIMD build must actually use SIMD.
//
// Usage: node check-wasm.mjs [--baseline] <engine.wasm> [--simd <engine-simd.wasm>] ...
// A path without a flag is checked as a baseline build.
import { readFileSync } from 'node:fs';

const REQUIRED_EXPORTS = [
  'memory',
  'ot_version',
  'ot_build_features',
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

/** Bit in ot_build_features() for a WebAssembly SIMD build (src/ffi.rs). */
const FEATURE_SIMD128 = 1;

/**
 * Counts SIMD instructions (0xFD prefix) in the code section by decoding every instruction, so
 * immediates that happen to contain 0xFD are not mistaken for opcodes. Covers the instruction set
 * rustc emits for wasm32-unknown-unknown (MVP, sign-ext, non-trapping conversions, bulk memory,
 * reference types, multi-value, SIMD); anything else is reported as an error rather than guessed.
 */
function countSimdInstructions(bytes) {
  let pos = 8;
  const u8 = () => {
    if (pos >= bytes.length) throw new Error('unexpected end of module');
    return bytes[pos++];
  };
  const leb = () => {
    // Skips an (un)signed LEB128 number; returns the low 32 bits of its unsigned value.
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = u8();
      if (shift < 32) result |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    return result >>> 0;
  };
  const skip = (n) => {
    pos += n;
  };
  const memarg = () => {
    const align = leb();
    if (align & 0x40) leb(); // multi-memory index
    leb(); // offset
  };
  const blockType = () => {
    const b = bytes[pos];
    if (b === 0x40 || (b >= 0x6f && b <= 0x7f)) pos++;
    else leb(); // type index (s33)
  };

  let simd = 0;
  while (pos < bytes.length) {
    const id = u8();
    const size = leb();
    const end = pos + size;
    if (id !== 10) {
      pos = end;
      continue;
    }
    const bodies = leb();
    for (let f = 0; f < bodies; f++) {
      const bodySize = leb();
      const bodyEnd = pos + bodySize;
      const groups = leb();
      for (let g = 0; g < groups; g++) {
        leb();
        const t = u8();
        if (t === 0x7b) simd++; // v128 local
      }
      while (pos < bodyEnd) {
        const op = u8();
        if (op === 0x02 || op === 0x03 || op === 0x04) blockType();
        else if (op === 0x0c || op === 0x0d) leb();
        else if (op === 0x0e) {
          const n = leb();
          for (let i = 0; i <= n; i++) leb();
        } else if (op === 0x10 || op === 0x12) leb();
        else if (op === 0x11 || op === 0x13) {
          leb();
          leb();
        } else if (op === 0x1c) {
          const n = leb();
          skip(n);
        } else if (op >= 0x20 && op <= 0x26) leb();
        else if (op >= 0x28 && op <= 0x3e) memarg();
        else if (op === 0x3f || op === 0x40) leb();
        else if (op === 0x41 || op === 0x42) leb();
        else if (op === 0x43) skip(4);
        else if (op === 0x44) skip(8);
        else if (op === 0xd0) skip(1);
        else if (op === 0xd2) leb();
        else if (op === 0xfc) {
          const sub = leb();
          if (sub <= 7) {
            // saturating truncations: no immediates
          } else if (sub === 8 || sub === 10 || sub === 12 || sub === 14) {
            leb();
            leb();
          } else if (sub <= 17) leb();
          else throw new Error(`unknown instruction 0xfc ${sub} at byte ${pos}`);
        } else if (op === 0xfd) {
          simd++;
          const sub = leb();
          if (sub <= 11 || sub === 92 || sub === 93)
            memarg(); // loads and stores
          else if (sub >= 84 && sub <= 91) {
            memarg();
            skip(1); // lane
          } else if (sub === 12 || sub === 13)
            skip(16); // v128.const, i8x16.shuffle
          else if (sub >= 21 && sub <= 34) skip(1); // extract / replace lane
        } else if (
          op === 0x00 ||
          op === 0x01 ||
          op === 0x05 ||
          op === 0x0b ||
          op === 0x0f ||
          op === 0x1a ||
          op === 0x1b ||
          (op >= 0x45 && op <= 0xc4) ||
          op === 0xd1
        ) {
          // no immediates
        } else {
          throw new Error(`unknown opcode 0x${op.toString(16)} at byte ${pos - 1}`);
        }
      }
      if (pos !== bodyEnd) throw new Error(`function ${f} did not decode to its end`);
    }
    pos = end;
  }
  return simd;
}

/** Checks one module; returns a list of problems (empty when it passes). */
function check(path, expectSimd) {
  const problems = [];
  const bytes = readFileSync(path);
  const module = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(module);
  const exports = new Set(WebAssembly.Module.exports(module).map((e) => e.name));
  if (imports.length > 0) {
    problems.push(
      'The engine must not import anything, but imports:',
      ...imports.map((i) => `  ${i.module}.${i.name} (${i.kind})`),
    );
  }
  for (const name of REQUIRED_EXPORTS) {
    if (!exports.has(name)) problems.push(`Missing export: ${name}`);
  }

  let simdOps = 0;
  try {
    simdOps = countSimdInstructions(bytes);
  } catch (err) {
    problems.push(`Could not scan the code section: ${err.message}`);
  }
  if (expectSimd && simdOps === 0) problems.push('The SIMD build contains no SIMD instructions');
  if (!expectSimd && simdOps > 0) {
    problems.push(`The baseline build contains ${simdOps} SIMD instructions or v128 locals`);
  }

  if (problems.length === 0) {
    const { exports: e } = new WebAssembly.Instance(module, {});
    const claimsSimd = (e.ot_build_features() & FEATURE_SIMD128) !== 0;
    if (claimsSimd !== expectSimd) {
      problems.push(`ot_build_features() says simd128 is ${claimsSimd ? 'on' : 'off'}`);
    }
    // Smoke test: one second of silence must produce no events.
    const h = e.ot_detector_new(48000);
    const cap = e.ot_input_capacity();
    new Float32Array(e.memory.buffer, e.ot_detector_input_ptr(h), cap).fill(0);
    let events = 0;
    for (let i = 0; i < 48000 / cap; i++) events += e.ot_detector_process(h, cap);
    e.ot_detector_free(h);
    if (events !== 0) problems.push(`Silence produced ${events} events`);
  }

  console.log(
    `${path}: ${expectSimd ? 'SIMD' : 'baseline'}, ${(bytes.length / 1024).toFixed(0)} KiB, ` +
      `${exports.size} exports, ${imports.length} imports, ${simdOps} SIMD instructions`,
  );
  return problems;
}

const targets = [];
let usage = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--simd' || arg === '--baseline') {
    const path = args[++i];
    if (path && !path.startsWith('--')) targets.push({ path, simd: arg === '--simd' });
    else usage = true;
  } else if (arg.startsWith('--')) {
    usage = true;
  } else {
    targets.push({ path: arg, simd: false });
  }
}
if (usage || targets.length === 0) {
  console.error(
    'usage: node check-wasm.mjs [--baseline] <engine.wasm> [--simd <engine-simd.wasm>]',
  );
  process.exit(2);
}

let ok = true;
for (const { path, simd } of targets) {
  const problems = check(path, simd);
  for (const p of problems) console.error(`  ${p}`);
  if (problems.length > 0) ok = false;
}
process.exit(ok ? 0 : 1);
