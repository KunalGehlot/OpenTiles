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
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const dist = join(here, '..', 'dist');
const targetDir = resolve(root, process.env.CARGO_TARGET_DIR || 'target');

/**
 * The cargo of the toolchain rust-toolchain.toml asks for, which has the wasm32 target. A `cargo`
 * from another install (Homebrew's, say) can come first in PATH and has no wasm32 standard library
 * ("can't find crate for `core`"), so ask rustup where its own is. The toolchain's lib folder goes on
 * the library path too: macOS strips DYLD_* from shells, and rust-lld then cannot find libLLVM.
 */
const toolchain = () => {
  const which = spawnSync('rustup', ['which', 'cargo'], { cwd: root, encoding: 'utf8' });
  if (which.status !== 0 || !which.stdout.trim()) return { cargo: 'cargo', env: process.env };
  const cargo = which.stdout.trim();
  const bin = dirname(cargo);
  const lib = join(bin, '..', 'lib');
  const env = {
    ...process.env,
    PATH: [bin, process.env.PATH].filter(Boolean).join(delimiter),
    DYLD_FALLBACK_LIBRARY_PATH: [lib, process.env.DYLD_FALLBACK_LIBRARY_PATH]
      .filter(Boolean)
      .join(':'),
  };
  return { cargo, env };
};
const rust = toolchain();

/**
 * Without Rust, or with a toolchain that cannot build for the web, a local run keeps the engine
 * files already in dist/ (with a warning) so the app still builds; CI always fails.
 */
const prebuilt = ['engine.wasm', 'engine-simd.wasm'].every((f) => existsSync(join(dist, f)));
const giveUp = (status, why) => {
  if (prebuilt && !process.env.CI) {
    console.warn(`\n⚠ The engine was not rebuilt (${why}); using the files already in ${dist}.`);
    console.warn(
      '  Install Rust with rustup (https://rustup.rs) to rebuild it after changing the engine.\n',
    );
    process.exit(0);
  }
  console.error(`Could not build the engine: ${why}.`);
  console.error(
    'Install Rust with rustup (https://rustup.rs); rust-toolchain.toml adds the wasm32 target.',
  );
  process.exit(status || 1);
};

const run = (cmd, args, env = rust.env) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env });
  if (r.error) giveUp(1, `${cmd} could not be started: ${r.error.message}`);
  if (r.status !== 0) giveUp(r.status ?? 1, `${cmd} ${args[0] ?? ''} failed`);
};

/** Builds the cdylib into `dir` and copies it to dist/`name`. */
const build = (dir, name, extraArgs, env) => {
  run(
    rust.cargo,
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
  ...rust.env,
  RUSTFLAGS: rustflags,
});
run(process.execPath, [join(here, 'check-wasm.mjs'), baseline, '--simd', simd]);
