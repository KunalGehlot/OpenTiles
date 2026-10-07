// Builds the engine to WebAssembly twice (P0-12) and checks both modules:
//
//   dist/engine.wasm       baseline; loads on every browser with WebAssembly
//   dist/engine-simd.wasm  WebAssembly SIMD: RustFFT's wasm SIMD kernels plus +simd128 codegen
//
// The app picks one at runtime with wasmSimdSupported() (js/simd.ts).
//
// Cargo's target directory is CARGO_TARGET_DIR or ./target. The SIMD build uses a subdirectory of
// it, so the two RUSTFLAGS settings don't keep invalidating each other's build cache.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const dist = join(here, '..', 'dist');
const targetDir = resolve(root, process.env.CARGO_TARGET_DIR || 'target');

const run = (cmd, args, env = process.env) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env });
  if (r.error) {
    console.error(`Could not run ${cmd}: ${r.error.message}`);
    console.error('Install Rust (https://rustup.rs) — rust-toolchain.toml adds the wasm32 target.');
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
};

/** Builds the cdylib into `dir` and copies it to dist/`name`. */
const build = (dir, name, extraArgs, env) => {
  run(
    'cargo',
    [
      'build',
      '--profile',
      'wasm',
      '--target',
      'wasm32-unknown-unknown',
      '--target-dir',
      dir,
      '-p',
      'opentiles-engine',
      '--lib',
      ...extraArgs,
    ],
    env,
  );
  const out = join(dist, name);
  copyFileSync(join(dir, 'wasm32-unknown-unknown', 'wasm', 'opentiles_engine.wasm'), out);
  return out;
};

mkdirSync(dist, { recursive: true });
const baseline = build(targetDir, 'engine.wasm', []);
// RUSTFLAGS from the environment are kept; with --target they reach the wasm crates only, not
// build scripts.
const rustflags = [process.env.RUSTFLAGS, '-C target-feature=+simd128'].filter(Boolean).join(' ');
const simd = build(join(targetDir, 'wasm-simd'), 'engine-simd.wasm', ['--features', 'simd'], {
  ...process.env,
  RUSTFLAGS: rustflags,
});
run('node', [join(here, 'check-wasm.mjs'), baseline, '--simd', simd]);
