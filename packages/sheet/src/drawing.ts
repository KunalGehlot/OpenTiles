// What the bar detection reads from a page: its straight horizontal and vertical strokes and the
// outlines of its filled glyphs, in PDF points from the page's top-left corner. The PDF reader
// (pdfjs.ts) and the scan reader (raster.ts) both produce it, so the detection itself is plain
// geometry that tests can feed with drawings made up in code.
import type { SheetPage } from './types';

/** A straight stroke: a stroked segment, or a filled rectangle much longer than it is thick. */
export interface SheetLine {
  /** `h`: horizontal at y = `at`, from x = `from` to `to`. `v`: vertical at x = `at`, `from`–`to` in y. */
  dir: 'h' | 'v';
  at: number;
  from: number;
  to: number;
  /** Thickness in points. */
  width: number;
  /** Drawn with a dash pattern (ottava and pedal lines, dashed barlines). */
  dashed?: boolean;
}

/** The bounding box of a filled outline: a note head, a dot, a clef, a letter, a beam. */
export interface SheetBlob {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Drawn with curves (note heads, dots, clefs, letters), not only straight edges (beams, rests). */
  curved: boolean;
}

export interface PageDrawing {
  page: SheetPage;
  lines: SheetLine[];
  blobs: SheetBlob[];
  /** The page paints a large image (a scan), which only the scan reader can see into. */
  scanned: boolean;
}
