// The first look at a sheet (ADR 0018): where its bars are, and which bar each measure of the song
// is played from. pdf.js parses the pages in its worker; finding the bars in what it returns takes
// a few milliseconds a page on the main thread (measured on a 7-page engraved PDF), so it runs
// here, one page at a time, yielding between pages so drawing never stalls.
import {
  buildSheetMap,
  detectPage,
  drawingFromBitmap,
  drawingFromOperatorList,
  layoutFromPages,
  printedHeads,
  readNotation,
  scoreHints,
} from '@opentiles/sheet';
import type { PageDrawing, PageResult, SheetLayout, SheetMap } from '@opentiles/sheet';
import type { Song } from '@opentiles/song-model';
import type { PdfDocument } from './pdf';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** Scans are read from an image at this resolution: enough for staff lines, light on an iPad. */
const SCAN_DPI = 150;

export interface AnalysisTiming {
  /** Milliseconds per page, from asking pdf.js for the page to its bars. */
  pages: number[];
  total: number;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The page drawn into an image, for a scan. */
async function pageImage(doc: PdfDocument, index: number): Promise<PageDrawing | null> {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: SCAN_DPI / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  try {
    await page.render({ canvas, canvasContext: context, viewport, background: '#ffffff' }).promise;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const size = page.getViewport({ scale: 1 });
    return drawingFromBitmap(
      { width: image.width, height: image.height, data: image.data, channels: 4 },
      { width: size.width, height: size.height },
    );
  } finally {
    // Safari keeps a canvas's memory until it is shrunk.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Finds the bars of every page. */
export async function findLayout(
  pdfjs: PdfJs,
  doc: PdfDocument,
  signal?: AbortSignal,
): Promise<{
  layout: SheetLayout;
  timing: AnalysisTiming;
  /** Each page's bars, when every page was read from its vector drawing (not a scan). */
  vectorPages: PageResult[] | null;
}> {
  const started = performance.now();
  const pages: { drawing: PageDrawing; result: PageResult; source: 'vector' | 'raster' }[] = [];
  const timing: number[] = [];
  let open = false;
  for (let index = 0; index < doc.numPages; index++) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const pageStarted = performance.now();
    const page = await doc.getPage(index + 1);
    const viewport = page.getViewport({ scale: 1 });
    // Its own intent: the operator list used for drawing has its paths turned into Path2D.
    const list = await page.getOperatorList({
      intent: 'any',
      annotationMode: pdfjs.AnnotationMode.DISABLE,
    });
    let drawing = drawingFromOperatorList(
      list,
      viewport.transform,
      { width: viewport.width, height: viewport.height },
      pdfjs.OPS,
    );
    let result = detectPage(drawing, index, open);
    let source: 'vector' | 'raster' = 'vector';
    if (result.bars.length === 0 && drawing.scanned) {
      const scan = await pageImage(doc, index);
      if (scan) {
        drawing = scan;
        result = detectPage(scan, index, open);
        source = 'raster';
      }
    }
    open = result.openEnding;
    pages.push({ drawing, result, source });
    // The analysis's operator list is not needed again; drawing keeps its own.
    page.cleanup();
    timing.push(performance.now() - pageStarted);
    await nextTask();
  }
  return {
    layout: layoutFromPages(pages),
    timing: { pages: timing, total: performance.now() - started },
    vectorPages: pages.every((p) => p.source === 'vector') ? pages.map((p) => p.result) : null,
  };
}

/** A new map for a sheet and a song. */
export async function analyseSheet(
  pdfjs: PdfJs,
  doc: PdfDocument,
  song: Pick<Song, 'measures' | 'notes'>,
  signal?: AbortSignal,
): Promise<{ map: SheetMap; timing: AnalysisTiming }> {
  const { layout, timing, vectorPages } = await findLayout(pdfjs, doc, signal);
  const map = buildSheetMap(layout, song);
  // How the sheet writes the song (P5-18), for the Score tab; only from a vector PDF's heads.
  const score = vectorPages
    ? scoreHints(
        readNotation(printedHeads(vectorPages), song, map.barOfMeasure),
        song,
        map.barOfMeasure,
      )
    : null;
  return { map: score ? { ...map, score } : map, timing };
}
