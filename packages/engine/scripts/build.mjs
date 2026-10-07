// Builds the engine to WebAssembly and copies it to dist/engine.wasm.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.error) {
    console.error(`Could not run ${cmd}: ${r.error.message}`);
    console.error('Install Rust (https://rustup.rs) — rust-toolchain.toml adds the wasm32 target.');
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('cargo', [
  'build',
  '--profile',
  'wasm',
  '--target',
  'wasm32-unknown-unknown',
  '-p',
  'opentiles-engine',
  '--lib',
]);
const built = join(root, 'target', 'wasm32-unknown-unknown', 'wasm', 'opentiles_engine.wasm');
const out = join(here, '..', 'dist', 'engine.wasm');
mkdirSync(dirname(out), { recursive: true });
copyFileSync(built, out);
run('node', [join(here, 'check-wasm.mjs'), out]);
