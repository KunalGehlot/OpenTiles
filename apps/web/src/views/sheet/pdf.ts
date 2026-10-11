// pdf.js (pdfjs-dist, Apache-2.0) draws the learner's own sheet music (ADR 0018). It is imported
// only when a piece with a sheet opens, so the main bundle does not grow. The legacy build is used
// because the modern one needs JavaScript newer than Safari 16.4 has (Map.getOrInsertComputed,
// Math.sumPrecise, Promise.try); the legacy build brings those itself. Its worker is bundled by Vite
// and served from the app's own origin, and the image decoders for scanned pages (JBIG2,
// JPEG 2000) are served from pdfjs/wasm/ (vite.config.ts). pdf.js fetches nothing else: no fonts,
// no character maps, and pdf.js 6 has no eval-based code path left to switch off.
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
export type PdfDocument = import('pdfjs-dist').PDFDocumentProxy;
export type PdfPage = import('pdfjs-dist').PDFPageProxy;

let loading: Promise<PdfJs> | null = null;

export function loadPdfJs(): Promise<PdfJs> {
  loading ??= Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker'),
  ])
    .then(([lib, worker]) => {
      // One worker for the whole visit; pdf.js shares it between documents.
      lib.GlobalWorkerOptions.workerPort ??= new worker.default();
      return lib;
    })
    .catch((e: unknown) => {
      loading = null;
      throw e;
    });
  return loading;
}

/**
 * Opens a sheet. pdf.js takes the bytes over (they move to its worker), so it gets a copy and the
 * library item keeps its own.
 */
export async function openPdf(bytes: Uint8Array): Promise<{ pdfjs: PdfJs; doc: PdfDocument }> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({
    data: bytes.slice(),
    wasmUrl: new URL('pdfjs/wasm/', document.baseURI).href,
    // A broken page is drawn as far as it goes rather than not at all.
    stopAtErrors: false,
    verbosity: 0,
  }).promise;
  return { pdfjs, doc };
}
