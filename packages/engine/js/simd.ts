// Runtime choice between the engine's two WebAssembly builds (P0-12): dist/engine-simd.wasm where
// the browser runs WebAssembly SIMD (Safari 16.4+, Chrome 91+, Firefox 89+), dist/engine.wasm
// everywhere else.

/**
 * The smallest module that needs final-spec WebAssembly SIMD:
 * `(module (func (result v128) (i8x16.popcnt (i32x4.splat (i32.const 0)))))`.
 * `i8x16.popcnt` got its opcode late in the proposal, so browsers that only shipped an early SIMD
 * prototype reject the probe, as they would reject the SIMD build.
 */
// prettier-ignore
const SIMD_PROBE = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // "\0asm", version 1
  0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b, // type section: () -> v128
  0x03, 0x02, 0x01, 0x00, // function section: one function of type 0
  0x0a, 0x0a, 0x01, 0x08, 0x00, // code section: one 8-byte body without locals
  0x41, 0x00, // i32.const 0
  0xfd, 0x11, // i32x4.splat
  0xfd, 0x62, // i8x16.popcnt
  0x0b, // end
]);

/** The part of the `WebAssembly` namespace feature detection needs. */
export interface WasmValidator {
  validate(bytes: BufferSource): boolean;
}

/** Whether `wasm` accepts WebAssembly SIMD. Never throws; missing WebAssembly counts as no. */
export function detectWasmSimd(wasm: WasmValidator | undefined): boolean {
  try {
    return typeof wasm?.validate === 'function' && wasm.validate(SIMD_PROBE);
  } catch {
    return false;
  }
}

let simdSupported: boolean | undefined;

/** Whether this browser runs WebAssembly SIMD. Checked once, then cached. */
export function wasmSimdSupported(): boolean {
  simdSupported ??= detectWasmSimd(globalThis.WebAssembly);
  return simdSupported;
}

/** Where the two engine builds are served from (for example Vite `?url` imports). */
export interface EngineUrls {
  /** dist/engine.wasm: runs on every browser with WebAssembly. */
  baseline: string;
  /** dist/engine-simd.wasm: needs WebAssembly SIMD. */
  simd?: string;
}

export type EngineBuild = 'simd' | 'baseline';

/** The build to load: the SIMD one when the browser supports it and it is available. */
export function selectEngineBuild(urls: EngineUrls, simd = wasmSimdSupported()): EngineBuild {
  return simd && urls.simd ? 'simd' : 'baseline';
}

/** The URL of the build {@link selectEngineBuild} picks. */
export function selectEngineUrl(urls: EngineUrls, simd = wasmSimdSupported()): string {
  return simd && urls.simd ? urls.simd : urls.baseline;
}
