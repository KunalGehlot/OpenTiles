import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileBestEngine } from './engine';
import { detectWasmSimd, selectEngineBuild, selectEngineUrl, wasmSimdSupported } from './simd';

/** The smallest valid module: no SIMD, so it stands in for the baseline build. */
const EMPTY_MODULE = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

describe('detectWasmSimd', () => {
  it('finds SIMD in this Node runtime', () => {
    // Node 22 (V8) has shipped WebAssembly SIMD since Node 16.4.
    expect(detectWasmSimd(WebAssembly)).toBe(true);
    expect(wasmSimdSupported()).toBe(true);
  });

  it('validates a module that really uses SIMD', () => {
    let probe: Uint8Array<ArrayBuffer> | null = null;
    detectWasmSimd({
      validate(bytes) {
        probe = new Uint8Array(bytes as Uint8Array); // a copy
        return true;
      },
    });
    expect(probe).not.toBeNull();
    const bytes = probe!;
    expect(WebAssembly.validate(bytes)).toBe(true);
    // Its function returns v128 and its body uses 0xfd-prefixed (SIMD) instructions.
    expect(bytes.includes(0x7b)).toBe(true);
    expect(bytes.filter((b) => b === 0xfd).length).toBeGreaterThanOrEqual(2);
    // Swapping the SIMD instructions for something else makes the module invalid, so the probe is
    // not trivially accepted.
    const broken = bytes.map((b) => (b === 0xfd ? 0xff : b));
    expect(WebAssembly.validate(broken)).toBe(false);
  });

  it('says no when the browser rejects the probe', () => {
    expect(detectWasmSimd({ validate: () => false })).toBe(false);
  });

  it('says no without WebAssembly or when validation throws', () => {
    expect(detectWasmSimd(undefined)).toBe(false);
    expect(detectWasmSimd({} as never)).toBe(false);
    expect(
      detectWasmSimd({
        validate: () => {
          throw new Error('blocked by policy');
        },
      }),
    ).toBe(false);
  });
});

describe('selectEngineBuild', () => {
  const urls = { baseline: '/engine.wasm', simd: '/engine-simd.wasm' };

  it('picks the SIMD build only where SIMD runs', () => {
    expect(selectEngineBuild(urls, true)).toBe('simd');
    expect(selectEngineUrl(urls, true)).toBe('/engine-simd.wasm');
    expect(selectEngineBuild(urls, false)).toBe('baseline');
    expect(selectEngineUrl(urls, false)).toBe('/engine.wasm');
  });

  it('uses the baseline when no SIMD build is offered', () => {
    expect(selectEngineBuild({ baseline: '/engine.wasm' }, true)).toBe('baseline');
    expect(selectEngineUrl({ baseline: '/engine.wasm' }, true)).toBe('/engine.wasm');
  });

  it('defaults to feature detection', () => {
    expect(selectEngineUrl(urls)).toBe(wasmSimdSupported() ? urls.simd : urls.baseline);
  });
});

describe('compileBestEngine', () => {
  const urls = { baseline: '/engine.wasm', simd: '/engine-simd.wasm' };
  let served: Record<string, Uint8Array | undefined> = {};
  const requested: string[] = [];

  const serve = (files: Record<string, Uint8Array | undefined>) => {
    served = files;
    requested.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(url);
        const body = served[url];
        return body
          ? new Response(body.slice(), { headers: { 'Content-Type': 'application/wasm' } })
          : new Response('missing', { status: 404 });
      }),
    );
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the SIMD build where SIMD runs', async () => {
    serve({ [urls.simd]: EMPTY_MODULE, [urls.baseline]: EMPTY_MODULE });
    const r = await compileBestEngine(urls, true);
    expect(r.build).toBe('simd');
    expect(r.module).toBeInstanceOf(WebAssembly.Module);
    expect(requested.every((u) => u === urls.simd)).toBe(true);
  });

  it('loads only the baseline build without SIMD', async () => {
    serve({ [urls.simd]: EMPTY_MODULE, [urls.baseline]: EMPTY_MODULE });
    const r = await compileBestEngine(urls, false);
    expect(r.build).toBe('baseline');
    expect(requested.every((u) => u === urls.baseline)).toBe(true);
  });

  it('falls back to the baseline when the SIMD build is missing or invalid', async () => {
    serve({ [urls.baseline]: EMPTY_MODULE });
    expect((await compileBestEngine(urls, true)).build).toBe('baseline');

    serve({ [urls.simd]: new Uint8Array([1, 2, 3]), [urls.baseline]: EMPTY_MODULE });
    expect((await compileBestEngine(urls, true)).build).toBe('baseline');
  });

  it('fails when the baseline build cannot be loaded either', async () => {
    serve({});
    await expect(compileBestEngine(urls, true)).rejects.toThrow(/note detector/);
  });
});
