// Reads generated PDFs with pdf.js in Node, as the app does in the browser.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { drawingFromOperatorList } from '../src';
import type { PageDrawing } from '../src';

export async function drawingsOf(bytes: Uint8Array): Promise<PageDrawing[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  try {
    const drawings: PageDrawing[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const list = await page.getOperatorList({
        intent: 'any',
        annotationMode: pdfjs.AnnotationMode.DISABLE,
      });
      drawings.push(
        drawingFromOperatorList(
          list,
          viewport.transform,
          { width: viewport.width, height: viewport.height },
          pdfjs.OPS,
        ),
      );
    }
    return drawings;
  } finally {
    await task.destroy();
  }
}
