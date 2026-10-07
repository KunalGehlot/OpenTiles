# 0005 — Ship a WebAssembly SIMD build next to the baseline, chosen at runtime

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P0-12

## Context

Spec §5 and §7 ask for a WebAssembly SIMD build of the detector with a non-SIMD fallback: the
detector must stay within 2 ms per hop on an older iPad, and SIMD is the usual way to buy headroom.
WebAssembly has no runtime feature switch inside a module: a module that contains a single SIMD
instruction fails to compile on a browser without SIMD (Safari before 16.4), so one module cannot
serve both.

The FFT library, RustFFT 6.4 (through realfft 3.5), has an opt-in `wasm_simd` feature with
hand-written SIMD kernels. Its kernels are marked `#[target_feature(enable = "simd128")]`, so
enabling the feature puts SIMD instructions in the module whatever the global target features are.

## Decision

- `pnpm build:engine` builds the crate twice: `dist/engine.wasm` as before, and
  `dist/engine-simd.wasm` with the crate feature `simd` (which enables `realfft/wasm_simd`) and
  `RUSTFLAGS="-C target-feature=+simd128"`, in a separate target directory so neither build
  invalidates the other's cache. A `compile_error!` stops a wasm build that enables the feature
  without the target feature.
- The app validates a 31-byte SIMD module with `WebAssembly.validate` (`wasmSimdSupported()`),
  downloads only the matching build, and falls back to the baseline if the SIMD build fails to load
  or compile (`compileBestEngine`).
- `scripts/check-wasm.mjs` decodes every function body of both modules: the baseline must contain
  no SIMD instruction, the SIMD build must contain some, and `ot_build_features()` must agree. A
  Vitest suite runs both builds over the same synthetic passages and requires identical decisions.

## Consequences

- About 15 % less time per hop where SIMD is available (see the table in
  [architecture.md](../architecture.md#the-note-detection-engine)).
- The SIMD build is larger: about 709 KiB raw / 139 KiB brotli against 312 KiB / 82 KiB, mostly
  RustFFT's SIMD butterflies. Each browser downloads one build, and only when the microphone is
  first used.
- Two artefacts to build, check, cache and (later) precache in the service worker; the web build
  needs both files to exist.
- About two thirds of a hop is still scalar per-sample and per-bin work outside the FFT (V8 CPU
  profile of the baseline), so restructuring those loops to vectorise would raise the SIMD gain.

## Alternatives considered

- **Baseline only:** smallest and simplest, and fast enough on desktops, but gives up headroom on
  the older iPads the G0 gate is about.
- **SIMD only:** drops every browser without WebAssembly SIMD, such as Safari before 16.4 on iPads
  that have not been, or cannot be, updated.
- **`+simd128` codegen without RustFFT's kernels:** a smaller module (400 KiB raw), but LLVM's
  auto-vectorisation alone saved only about 4 % per hop in the same benchmark, against about 17 %
  with the kernels.
- **Feature detection by user agent:** brittle; validating a tiny module asks the engine itself.
