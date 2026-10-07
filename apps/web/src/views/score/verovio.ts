// Verovio (LGPL-3.0-or-later) engraves the score to SVG in the browser (PLAN.md P1-15, ADR 0009).
// It is ~7 MB of WebAssembly embedded in one ES module, so it is imported only when a score view
// opens and never weighs down the main bundle. The chunk is served from our own origin and
// precached by the service worker for offline use; Verovio makes no network requests.
import type { NotationSource } from './notation';

/** The subset of Verovio's toolkit the score views use. */
export interface Toolkit {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean | number;
  getPageCount(): number;
  renderToSVG(page?: number, xmlDeclaration?: boolean): string;
  renderToTimemap(options?: Record<string, unknown>): unknown;
  getMIDIValuesForElement(id: string): { pitch?: number } | null;
  getPageWithElement(id: string): number;
  redoLayout(options?: Record<string, unknown>): void;
  destroy(): void;
}

type ToolkitCtor = new (module: unknown) => Toolkit;

let modulePromise: Promise<{ module: unknown; Toolkit: ToolkitCtor }> | null = null;

function loadModule(): Promise<{ module: unknown; Toolkit: ToolkitCtor }> {
  modulePromise ??= Promise.all([import('verovio/wasm'), import('verovio/esm')])
    .then(async ([wasm, esm]) => {
      const module = await wasm.default();
      esm.enableLog(esm.LOG_OFF, module);
      return { module, Toolkit: esm.VerovioToolkit as ToolkitCtor };
    })
    .catch((e: unknown) => {
      modulePromise = null;
      throw e;
    });
  return modulePromise;
}

/** Options shared by both views. Fonts are built in (Leipzig/Bravura), so nothing is fetched. */
const BASE_OPTIONS = { header: 'none', footer: 'none' };

/** A toolkit with `source` loaded, or an error message for the user. */
export async function createToolkit(
  source: Extract<NotationSource, { kind: 'musicxml' | 'abc' }>,
  options: Record<string, unknown>,
): Promise<Toolkit> {
  const { module, Toolkit } = await loadModule();
  const tk = new Toolkit(module);
  tk.setOptions({
    ...BASE_OPTIONS,
    ...options,
    inputFrom: source.kind === 'abc' ? 'abc' : 'musicxml',
    ...(source.transpose ? { transpose: String(source.transpose) } : {}),
  });
  if (!tk.loadData(source.text)) {
    tk.destroy();
    throw new Error('The score could not be drawn.');
  }
  return tk;
}
