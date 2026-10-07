# 0002 — The engine exposes a plain C ABI, not wasm-bindgen glue

- **Status:** accepted
- **Date:** 2026-10-07
- **Plan task:** P0-06

## Context

The detector must run inside an `AudioWorkletProcessor` (spec §7) to stay off the main thread and
keep latency low. `AudioWorkletGlobalScope` is a restricted environment:

- No `fetch`, so the worklet cannot load the `.wasm` file itself.
- `TextDecoder`/`TextEncoder` are missing in some engines' worklet scopes, and the glue code that
  wasm-bindgen generates uses them.
- Asynchronous instantiation inside `process()` is awkward; synchronous
  `new WebAssembly.Instance(module)` is the reliable path, and it works best with few imports.

## Decision

- The Rust crate compiles to `wasm32-unknown-unknown` with **no imports at all**: no wasm-bindgen,
  no `js-sys`, `panic = "abort"`.
- It exports a small C ABI (`ot_detector_new`, `ot_detector_input_ptr`, `ot_detector_process`,
  `ot_detector_set_expected`, `ot_detector_event_*`, …) defined in `src/ffi.rs`, the only module
  allowed to use `unsafe`.
- The main thread compiles the module once (`WebAssembly.compileStreaming`) and posts the
  `WebAssembly.Module` to the worklet through `processorOptions`; the worklet instantiates it
  synchronously.
- All buffers (input, expected pitches, events) are allocated in `Detector::new` and exposed as
  pointers; JS views them through `Float32Array` / `Uint8Array` on the wasm memory and rebuilds the
  views if `memory.buffer` changes.

## Consequences

- No generated glue to keep in sync, no `wasm-pack` / `wasm-bindgen-cli` version pinning.
- The FFI surface is hand-written and must be kept small and tested (`tests/ffi.rs` uses the same
  functions natively).
- The same `.wasm` file can be loaded by the Capacitor shell unchanged.

## Alternatives considered

- **wasm-bindgen + wasm-pack:** pleasant API, but the glue's reliance on `TextDecoder` and
  `fetch`-based init needs polyfills inside the worklet.
- **Running the detector in a Worker fed by a `SharedArrayBuffer` ring:** needs cross-origin
  isolation headers (COOP/COEP), which complicate static hosting. Kept as a fallback if the worklet
  path turns out too slow on old iPads.
