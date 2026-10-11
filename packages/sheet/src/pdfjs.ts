// Reads a page's drawing from pdf.js's operator list (`page.getOperatorList()`): its straight
// strokes and filled outlines with every transform applied, in points from the page's top-left
// corner. Only the shape of the list is used, so this package needs no pdf.js at run time; the app
// passes pdf.js's own `OPS` table in. Written against pdfjs-dist 6, where `constructPath` carries
// the painting operator and the path as a Float32Array of drawing commands.
import type { PageDrawing, SheetBlob, SheetLine } from './drawing';
import type { SheetPage } from './types';

export interface OperatorListLike {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

/** pdf.js's operator numbers by name (`OPS` in pdfjs-dist). */
export type PdfOps = Readonly<Record<string, number>>;

type Matrix = [number, number, number, number, number, number];

// pdf.js's path commands in a constructPath Float32Array (DrawOPS in pdfjs-dist).
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

const multiply = (m: Matrix, n: readonly number[]): Matrix => {
  const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = n;
  return [
    m[0] * a + m[2] * b,
    m[1] * a + m[3] * b,
    m[0] * c + m[2] * d,
    m[1] * c + m[3] * d,
    m[0] * e + m[2] * f + m[4],
    m[1] * e + m[3] * f + m[5],
  ];
};

const isMatrix = (v: unknown): v is readonly number[] =>
  (Array.isArray(v) || ArrayBuffer.isView(v)) && (v as ArrayLike<unknown>).length === 6;

interface Subpath {
  /** Points in page space; straight[i] says whether the segment ending at point i+1 is a line. */
  points: number[];
  straight: boolean[];
  curved: boolean;
  closed: boolean;
}

function subpaths(path: ArrayLike<number>, m: Matrix): Subpath[] {
  const out: Subpath[] = [];
  let current: Subpath | null = null;
  const push = (x: number, y: number) => {
    current?.points.push(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
  };
  let i = 0;
  while (i < path.length) {
    const op = path[i++];
    if (op === MOVE) {
      current = { points: [], straight: [], curved: false, closed: false };
      out.push(current);
      push(path[i] ?? 0, path[i + 1] ?? 0);
      i += 2;
    } else if (op === LINE) {
      if (!current) break;
      push(path[i] ?? 0, path[i + 1] ?? 0);
      current.straight.push(true);
      i += 2;
    } else if (op === CURVE || op === QUAD) {
      if (!current) break;
      const n = op === CURVE ? 3 : 2;
      // The control points stay in the outline's box; only the end point starts the next segment.
      for (let k = 0; k < n; k++) push(path[i + 2 * k] ?? 0, path[i + 2 * k + 1] ?? 0);
      for (let k = 0; k < n; k++) current.straight.push(false);
      current.curved = true;
      i += 2 * n;
    } else if (op === CLOSE) {
      if (current) current.closed = true;
    } else {
      break;
    }
  }
  return out.filter((p) => p.points.length >= 4);
}

function box(p: Subpath): SheetBlob {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i + 1 < p.points.length; i += 2) {
    const x = p.points[i] as number;
    const y = p.points[i + 1] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, curved: p.curved };
}

/** Axis-aligned straight segments of a stroked subpath, as lines of the given width. */
function strokedLines(p: Subpath, width: number, dashed: boolean, out: SheetLine[]): void {
  const n = p.points.length / 2;
  const segment = (i: number, j: number) => {
    const x0 = p.points[2 * i] as number;
    const y0 = p.points[2 * i + 1] as number;
    const x1 = p.points[2 * j] as number;
    const y1 = p.points[2 * j + 1] as number;
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    if (dy <= 0.02 * dx + 0.01 && dx > 0) {
      out.push({
        dir: 'h',
        at: (y0 + y1) / 2,
        from: Math.min(x0, x1),
        to: Math.max(x0, x1),
        width,
        dashed,
      });
    } else if (dx <= 0.02 * dy + 0.01 && dy > 0) {
      out.push({
        dir: 'v',
        at: (x0 + x1) / 2,
        from: Math.min(y0, y1),
        to: Math.max(y0, y1),
        width,
        dashed,
      });
    }
  };
  for (let i = 0; i + 1 < n; i++) if (p.straight[i]) segment(i, i + 1);
  if (p.closed && !p.curved && n > 2) segment(n - 1, 0);
}

/** A filled axis-aligned rectangle much longer than thick, read as a line of that thickness. */
function thinRectangle(p: Subpath): SheetLine | null {
  if (p.curved) return null;
  const n = p.points.length / 2;
  if (n < 4 || n > 5) return null;
  const b = box(p);
  for (let i = 0; i < n; i++) {
    const x = p.points[2 * i] as number;
    const y = p.points[2 * i + 1] as number;
    const onX = Math.abs(x - b.x) <= 0.01 || Math.abs(x - b.x - b.width) <= 0.01;
    const onY = Math.abs(y - b.y) <= 0.01 || Math.abs(y - b.y - b.height) <= 0.01;
    if (!onX || !onY) return null;
  }
  if (b.height > 0 && b.width >= 4 * b.height) {
    return { dir: 'h', at: b.y + b.height / 2, from: b.x, to: b.x + b.width, width: b.height };
  }
  if (b.width > 0 && b.height >= 4 * b.width) {
    return { dir: 'v', at: b.x + b.width / 2, from: b.y, to: b.y + b.height, width: b.width };
  }
  return null;
}

/** Outlines of one fill: the inner contour of a glyph with a hole (a half note) is not a glyph. */
function outlines(paths: readonly Subpath[]): SheetBlob[] {
  const blobs = paths.map(box).sort((a, b) => b.width * b.height - a.width * a.height);
  const kept: SheetBlob[] = [];
  for (const blob of blobs) {
    const inside = kept.some(
      (k) =>
        k.width <= 40 &&
        k.height <= 40 &&
        blob.x >= k.x - 0.05 &&
        blob.y >= k.y - 0.05 &&
        blob.x + blob.width <= k.x + k.width + 0.05 &&
        blob.y + blob.height <= k.y + k.height + 0.05,
    );
    if (!inside) kept.push(blob);
  }
  return kept;
}

/**
 * The drawing of one page. `viewport` is pdf.js's viewport transform at scale 1
 * (`page.getViewport({ scale: 1 }).transform`), which turns PDF space into top-left page space.
 */
export function drawingFromOperatorList(
  list: OperatorListLike,
  viewport: readonly number[],
  page: SheetPage,
  OPS: PdfOps,
): PageDrawing {
  const lines: SheetLine[] = [];
  const blobs: SheetBlob[] = [];
  let scanned = false;
  let ctm: Matrix = [
    viewport[0] ?? 1,
    viewport[1] ?? 0,
    viewport[2] ?? 0,
    viewport[3] ?? 1,
    viewport[4] ?? 0,
    viewport[5] ?? 0,
  ];
  let lineWidth = 1;
  let dashed = false;
  const stack: { ctm: Matrix; lineWidth: number; dashed: boolean }[] = [];
  const strokes = new Set(
    ['stroke', 'closeStroke', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
      .map((k) => OPS[k])
      .filter((v): v is number => v !== undefined),
  );
  const fills = new Set(
    ['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke']
      .map((k) => OPS[k])
      .filter((v): v is number => v !== undefined),
  );
  const images = new Set(
    [
      'paintImageXObject',
      'paintInlineImageXObject',
      'paintImageMaskXObject',
      'paintImageXObjectRepeat',
      'paintImageMaskXObjectRepeat',
      'paintSolidColorImageMask',
    ]
      .map((k) => OPS[k])
      .filter((v): v is number => v !== undefined),
  );
  const setDash = (value: unknown) => {
    const pattern = Array.isArray(value) ? value[0] : undefined;
    dashed = Array.isArray(pattern) && pattern.some((v) => typeof v === 'number' && v > 0);
  };
  const pageArea = page.width * page.height;
  for (let n = 0; n < list.fnArray.length; n++) {
    const fn = list.fnArray[n];
    const args = list.argsArray[n];
    if (fn === OPS.save) {
      stack.push({ ctm, lineWidth, dashed });
    } else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) ({ ctm, lineWidth, dashed } = s);
    } else if (fn === OPS.transform) {
      if (isMatrix(args)) ctm = multiply(ctm, args);
    } else if (fn === OPS.paintFormXObjectBegin) {
      stack.push({ ctm, lineWidth, dashed });
      const matrix = Array.isArray(args) ? args[0] : undefined;
      if (isMatrix(matrix)) ctm = multiply(ctm, matrix);
    } else if (fn === OPS.paintFormXObjectEnd) {
      const s = stack.pop();
      if (s) ({ ctm, lineWidth, dashed } = s);
    } else if (fn === OPS.setLineWidth) {
      const w = Array.isArray(args) ? args[0] : undefined;
      if (typeof w === 'number') lineWidth = w;
    } else if (fn === OPS.setDash) {
      setDash(args);
    } else if (fn === OPS.setGState) {
      const entries = Array.isArray(args) ? args[0] : undefined;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (!Array.isArray(entry)) continue;
          if (entry[0] === 'LW' && typeof entry[1] === 'number') lineWidth = entry[1];
          if (entry[0] === 'D') setDash(entry[1]);
        }
      }
    } else if (fn !== undefined && images.has(fn)) {
      // An image is drawn into the unit square; a page-sized one is a scan.
      const w = Math.hypot(ctm[0], ctm[1]);
      const h = Math.hypot(ctm[2], ctm[3]);
      if (w * h >= 0.25 * pageArea) scanned = true;
    } else if (fn === OPS.constructPath && Array.isArray(args)) {
      const paint = args[0];
      const data: unknown = Array.isArray(args[1]) ? args[1][0] : undefined;
      // Rendering may have replaced the numbers with a Path2D; such a list cannot be read here.
      if (typeof paint !== 'number' || !(data instanceof Float32Array || Array.isArray(data)))
        continue;
      const stroked = strokes.has(paint);
      const filled = fills.has(paint);
      if (!stroked && !filled) continue;
      const paths = subpaths(data as ArrayLike<number>, ctm);
      if (stroked) {
        // A zero line width is the thinnest line the device can draw.
        const width = Math.max(
          0.1,
          lineWidth * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2])),
        );
        for (const p of paths) if (!p.curved) strokedLines(p, width, dashed, lines);
      }
      if (filled) {
        const shapes: Subpath[] = [];
        for (const p of paths) {
          const thin = !stroked ? thinRectangle(p) : null;
          if (thin) lines.push(thin);
          else if (p.curved || !stroked) shapes.push(p);
        }
        for (const b of outlines(shapes)) if (b.width > 0.01 || b.height > 0.01) blobs.push(b);
      }
    }
  }
  return { page, lines, blobs, scanned };
}
