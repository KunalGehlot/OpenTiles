// Reads a scanned page from its rendered image: long horizontal runs of dark pixels are staff
// lines, tall vertical ones barlines and stems, and the bar detection sorts them out as it does for
// a drawn PDF. Kept simple on purpose (ADR 0018): no note heads, no repeat dots, and a scan should
// be fairly straight. A slight tilt is fine; runs that step down a pixel are joined.
import type { PageDrawing, SheetLine } from './drawing';
import type { SheetPage } from './types';

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA (canvas ImageData) or one grey byte per pixel. */
  data: Uint8ClampedArray | Uint8Array;
  channels: 1 | 4;
}

/** One dark pixel run in a row or a column. */
interface Run {
  /** Row (for horizontal runs) or column (vertical). */
  at: number;
  from: number;
  to: number;
}

function darkness(bitmap: Bitmap, threshold: number): Uint8Array {
  const { width, height, data, channels } = bitmap;
  const dark = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < dark.length; i++, p += channels) {
    let lum: number;
    if (channels === 4) {
      const a = (data[p + 3] ?? 255) / 255;
      // Transparent is paper.
      lum =
        255 * (1 - a) +
        a *
          (0.299 * (data[p] ?? 255) + 0.587 * (data[p + 1] ?? 255) + 0.114 * (data[p + 2] ?? 255));
    } else lum = data[p] ?? 255;
    dark[i] = lum < threshold ? 1 : 0;
  }
  return dark;
}

/**
 * Joins runs of neighbouring rows (or columns) into strokes: a run continues one in the row before
 * when they overlap or touch and are of a similar length (a beam that touches a staff line is
 * much shorter than it, and stays apart).
 */
function strokes(runs: Run[][], scale: number, dir: 'h' | 'v'): SheetLine[] {
  interface Open {
    first: number;
    last: number;
    from: number;
    to: number;
    weight: number;
    sum: number;
    tail: Run[];
  }
  const done: Open[] = [];
  let open: Open[] = [];
  runs.forEach((row, at) => {
    const next: Open[] = [];
    const taken = new Set<Open>();
    for (const run of row) {
      const length = run.to - run.from;
      const match = open.find(
        (o) =>
          !taken.has(o) &&
          o.tail.some((t) => {
            const overlap = Math.min(run.to, t.to) - Math.max(run.from, t.from);
            // A tilted line steps a pixel and goes on end to end, or (thicker than a pixel) shares
            // an end with its neighbouring row; a run lying along it (a beam on a staff line)
            // overlaps it in the middle and is much shorter.
            if (overlap < -3) return false;
            if (overlap <= 3) return true;
            if (Math.abs(run.from - t.from) <= 3 || Math.abs(run.to - t.to) <= 3) return true;
            return Math.min(length, t.to - t.from) >= 0.4 * Math.max(length, t.to - t.from);
          }),
      );
      if (match) {
        taken.add(match);
        match.last = at;
        match.from = Math.min(match.from, run.from);
        match.to = Math.max(match.to, run.to);
        match.weight += length;
        match.sum += length * at;
        match.tail = [run];
        next.push(match);
      } else {
        const o: Open = {
          first: at,
          last: at,
          from: run.from,
          to: run.to,
          weight: length,
          sum: length * at,
          tail: [run],
        };
        next.push(o);
      }
    }
    for (const o of open) if (!taken.has(o)) done.push(o);
    open = next;
  });
  done.push(...open);
  return done.map((o) => ({
    dir,
    at: (o.sum / Math.max(1, o.weight) + 0.5) * scale,
    from: o.from * scale,
    to: (o.to + 1) * scale,
    width: (o.last - o.first + 1) * scale,
  }));
}

/** The straight strokes of a scanned page. `page` is its size in points, the bitmap any size. */
export function drawingFromBitmap(bitmap: Bitmap, page: SheetPage, threshold = 160): PageDrawing {
  const { width, height } = bitmap;
  const dark = darkness(bitmap, threshold);
  const scale = page.width / width;
  const minRow = Math.max(20, Math.round(0.08 * width));
  // Shorter pieces are kept while joining: the end of a tilted line after its last step.
  const minPiece = Math.max(6, Math.round(0.01 * width));
  const minColumn = Math.max(12, Math.round(0.015 * height));
  const rows: Run[][] = [];
  for (let y = 0; y < height; y++) {
    const row: Run[] = [];
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const on = x < width && dark[y * width + x] === 1;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        if (x - start >= minPiece) row.push({ at: y, from: start, to: x - 1 });
        start = -1;
      }
    }
    rows.push(row);
  }
  const columns: Run[][] = [];
  for (let x = 0; x < width; x++) {
    const column: Run[] = [];
    let start = -1;
    for (let y = 0; y <= height; y++) {
      const on = y < height && dark[y * width + x] === 1;
      if (on && start < 0) start = y;
      else if (!on && start >= 0) {
        if (y - start >= minColumn) column.push({ at: x, from: start, to: y - 1 });
        start = -1;
      }
    }
    columns.push(column);
  }
  return {
    page,
    lines: [
      ...strokes(rows, scale, 'h').filter((l) => l.to - l.from >= minRow * scale),
      ...strokes(columns, scale, 'v'),
    ],
    blobs: [],
    scanned: true,
  };
}
