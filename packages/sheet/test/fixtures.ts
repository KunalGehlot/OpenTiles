// Engraved-looking pages made up in code (CC0, no real music): staves, barlines, repeat signs,
// endings, note heads with stems, and the kind of clutter that trips a detector (dotted notes
// before a barline, tuplet brackets, pedal lines). They are written as a PDF the way an engraver's
// export draws them, so tests run pdf.js and the detector exactly as the app does, or painted into
// a bitmap for the scan reader, or a scanned PDF of that bitmap. Node only (zlib), for the unit
// tests and the e2e tests alike.
import { deflateSync } from 'node:zlib';

export interface FixtureBar {
  /** Width in points. */
  width: number;
  /** Note heads in the bar, shared over the staves. */
  heads?: number;
  start?: 'repeat-start';
  end?: 'single' | 'double' | 'final' | 'repeat-end';
  /** Volta number over this bar; neighbouring bars with the same number share one bracket. */
  ending?: number;
  /** Dotted notes just before the end barline: augmentation dots, not a repeat sign. */
  dotted?: boolean;
  /** A triplet bracket over the bar's notes (it starts at a note, not at the barline). */
  tuplet?: boolean;
}

export interface FixtureSystem {
  bars: FixtureBar[];
  /** Staves in the system (2 for a piano grand staff). */
  staves?: number;
  /** A courtesy time signature after the last barline: the staff lines run on past it. */
  courtesy?: boolean;
}

export interface FixturePage {
  systems: FixtureSystem[];
}

export interface FixtureOptions {
  /** Staff space in points. */
  space?: number;
  /** Staff lines and barlines as stroked segments (MuseScore) or as thin filled rectangles. */
  style?: 'stroke' | 'rect';
  /** Extra scale of the whole drawing, as an export's own transform. */
  scale?: number;
  /** Staff lines drawn in pieces, bar by bar. */
  brokenStaffLines?: boolean;
  /** Draw pedal lines under each system. */
  pedal?: boolean;
}

export const PAGE = { width: 595.28, height: 841.89 };
const LEFT = 40;
const TOP = 90;

type Primitive =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; width: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; hollow?: boolean }
  | { kind: 'polyline'; points: [number, number][]; width: number }
  | { kind: 'glyph'; x: number; y: number; w: number; h: number };

/** What the drawing should be found to contain, for the tests to compare against. */
export interface FixtureTruth {
  /** Bars per system, page by page. */
  barsPerSystem: number[][];
  bars: number;
}

function layoutPage(page: FixturePage, o: Required<FixtureOptions>): Primitive[] {
  const s = o.space;
  const out: Primitive[] = [];
  const staffLine = (x0: number, x1: number, y: number) => {
    if (o.style === 'rect')
      out.push({ kind: 'rect', x: x0, y: y - 0.04 * s, w: x1 - x0, h: 0.08 * s });
    else out.push({ kind: 'line', x0, y0: y, x1, y1: y, width: 0.08 * s });
  };
  const vertical = (x: number, y0: number, y1: number, width: number) => {
    if (o.style === 'rect')
      out.push({ kind: 'rect', x: x - width / 2, y: y0, w: width, h: y1 - y0 });
    else out.push({ kind: 'line', x0: x, y0, x1: x, y1, width });
  };
  let y = TOP;
  let openEnding: { number: number; from: number } | null = null;
  page.systems.forEach((system, systemIndex) => {
    const staves = system.staves ?? 2;
    const tops = Array.from({ length: staves }, (_, i) => y + i * 10 * s);
    const top = tops[0] ?? y;
    const bottom = (tops.at(-1) ?? y) + 4 * s;
    const total = system.bars.reduce((sum, b) => sum + b.width, 0);
    const right = LEFT + total + (system.courtesy ? 3 * s : 0);
    if (system.courtesy)
      for (const t of tops)
        out.push({ kind: 'glyph', x: right - 2.4 * s, y: t, w: 1.8 * s, h: 4 * s });
    // Staff lines.
    for (const t of tops) {
      for (let k = 0; k < 5; k++) {
        if (o.brokenStaffLines) {
          let x = LEFT;
          for (const bar of system.bars) {
            staffLine(x, x + bar.width, t + k * s);
            x += bar.width;
          }
          if (x < right) staffLine(x, right, t + k * s);
        } else staffLine(LEFT, right, t + k * s);
      }
    }
    // The system's line and brace at the left, for systems of more than one staff.
    if (staves > 1) {
      vertical(LEFT, top, bottom, 0.16 * s);
      out.push({ kind: 'glyph', x: LEFT - 1.6 * s, y: top, w: 1.2 * s, h: bottom - top });
    }
    // Clef and key at the start of the system.
    for (const t of tops)
      out.push({ kind: 'glyph', x: LEFT + 0.8 * s, y: t - 1.5 * s, w: 2.6 * s, h: 7 * s });
    const dotsAt = (x: number) => {
      for (const t of tops) {
        out.push({ kind: 'ellipse', cx: x, cy: t + 1.5 * s, rx: 0.25 * s, ry: 0.25 * s });
        out.push({ kind: 'ellipse', cx: x, cy: t + 2.5 * s, rx: 0.25 * s, ry: 0.25 * s });
      }
    };
    let x = LEFT;
    system.bars.forEach((bar, index) => {
      const end = x + bar.width;
      let content = x + (index === 0 ? 6 * s : 0.8 * s);
      if (bar.start === 'repeat-start') {
        // Thick, thin, dots; after the clef and key when the bar starts the system.
        const at = index === 0 ? x + 5 * s : x;
        vertical(at + 0.25 * s, top, bottom, 0.5 * s);
        vertical(at + 0.9 * s, top, bottom, 0.16 * s);
        dotsAt(at + 1.6 * s);
        content = Math.max(content, at + 2.4 * s);
      }
      // Note heads with stems, spread over the staves and the bar.
      const heads = bar.heads ?? 0;
      const room =
        end - content - (bar.end === 'repeat-end' ? 3 * s : 1.5 * s) - (bar.dotted ? 1.5 * s : 0);
      for (let h = 0; h < heads; h++) {
        const t = tops[h % staves] ?? top;
        const slot = Math.floor(h / staves);
        const slots = Math.ceil(heads / staves);
        const cx = content + 0.7 * s + (slots > 1 ? (slot * (room - 1.4 * s)) / (slots - 1) : 0);
        const step = (h * 3) % 9;
        const cy = t + (step * s) / 2;
        out.push({ kind: 'ellipse', cx, cy, rx: 0.65 * s, ry: 0.52 * s, hollow: h % 5 === 4 });
        out.push({
          kind: 'line',
          x0: cx + 0.6 * s,
          y0: cy,
          x1: cx + 0.6 * s,
          y1: cy - 3.5 * s,
          width: 0.12 * s,
        });
      }
      if (bar.tuplet && heads > 1) {
        const from = content + 0.2 * s;
        const to = content + room * 0.5;
        const by = top - 2.5 * s;
        out.push({
          kind: 'polyline',
          points: [
            [from, by + s],
            [from, by],
            [to, by],
            [to, by + s],
          ],
          width: 0.1 * s,
        });
      }
      if (bar.dotted)
        for (const t of tops) {
          out.push({
            kind: 'ellipse',
            cx: end - 1.2 * s,
            cy: t + 1.5 * s,
            rx: 0.25 * s,
            ry: 0.25 * s,
          });
          out.push({
            kind: 'ellipse',
            cx: end - 1.2 * s,
            cy: t + 2.5 * s,
            rx: 0.25 * s,
            ry: 0.25 * s,
          });
        }
      // The barline at the end.
      const kind = bar.end ?? 'single';
      if (kind === 'single') vertical(end, top, bottom, 0.16 * s);
      else if (kind === 'double') {
        vertical(end - 0.6 * s, top, bottom, 0.16 * s);
        vertical(end, top, bottom, 0.16 * s);
      } else {
        if (kind === 'repeat-end') dotsAt(end - 1.6 * s);
        vertical(end - 0.9 * s, top, bottom, 0.16 * s);
        vertical(end - 0.25 * s, top, bottom, 0.5 * s);
      }
      // Volta brackets: a line above the top staff with a hook down at its start; the first ending
      // is closed at its end, the last is left open.
      const by = top - 3 * s;
      const next = system.bars[index + 1];
      if (bar.ending !== undefined) {
        if (!openEnding || openEnding.number !== bar.ending) {
          const from = index === 0 ? content - 0.5 * s : x + 0.3 * s;
          openEnding = { number: bar.ending, from };
          out.push({ kind: 'line', x0: from, y0: by, x1: from, y1: by + 2 * s, width: 0.1 * s });
          out.push({ kind: 'glyph', x: from + 0.4 * s, y: by + 0.3 * s, w: 0.9 * s, h: 1.4 * s });
        }
        const following = next ?? page.systems[systemIndex + 1]?.bars[0];
        const closes = following?.ending !== bar.ending;
        if (closes || !next) {
          const to = end - 0.5 * s;
          out.push({ kind: 'line', x0: openEnding.from, y0: by, x1: to, y1: by, width: 0.1 * s });
          if (closes && bar.ending === 1)
            out.push({ kind: 'line', x0: to, y0: by, x1: to, y1: by + 2 * s, width: 0.1 * s });
          // Running on into the next system: that one continues it without a hook.
          openEnding = closes ? null : { number: bar.ending, from: LEFT + 6 * s - 0.5 * s };
        }
      } else openEnding = null;
      x = end;
    });
    if (o.pedal) {
      const py = bottom + 3 * s;
      out.push({
        kind: 'polyline',
        points: [
          [LEFT + 4 * s, py],
          [right - 2 * s, py],
          [right - 2 * s, py - 1.2 * s],
        ],
        width: 0.15 * s,
      });
    }
    y = bottom + 9 * s;
  });
  return out;
}

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Four Bézier curves round an ellipse (the usual 0.5523 handle length). */
function ellipsePath(cx: number, cy: number, rx: number, ry: number, reverse = false): string {
  const k = 0.5523;
  const p = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`;
  const dir = reverse ? -1 : 1;
  return [
    `${p(cx + rx, cy)} m`,
    `${p(cx + rx, cy + dir * k * ry)} ${p(cx + k * rx, cy + dir * ry)} ${p(cx, cy + dir * ry)} c`,
    `${p(cx - k * rx, cy + dir * ry)} ${p(cx - rx, cy + dir * k * ry)} ${p(cx - rx, cy)} c`,
    `${p(cx - rx, cy - dir * k * ry)} ${p(cx - k * rx, cy - dir * ry)} ${p(cx, cy - dir * ry)} c`,
    `${p(cx + k * rx, cy - dir * ry)} ${p(cx + rx, cy - dir * k * ry)} ${p(cx + rx, cy)} c h`,
  ].join(' ');
}

function contentStream(primitives: readonly Primitive[], scale: number): string {
  const ops: string[] = [`1 0 0 -1 0 ${fmt(PAGE.height)} cm`];
  // An export's own transform: scaled about the top-left corner, nudged in.
  ops.push(`${fmt(scale)} 0 0 ${fmt(scale)} 6 4 cm`);
  for (const p of primitives) {
    if (p.kind === 'line') {
      ops.push(
        `q ${fmt(p.width)} w 0 J ${fmt(p.x0)} ${fmt(p.y0)} m ${fmt(p.x1)} ${fmt(p.y1)} l S Q`,
      );
    } else if (p.kind === 'rect') {
      ops.push(`q ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.w)} ${fmt(p.h)} re f Q`);
    } else if (p.kind === 'polyline') {
      const [first, ...rest] = p.points;
      if (!first) continue;
      ops.push(
        `q ${fmt(p.width)} w ${fmt(first[0])} ${fmt(first[1])} m ${rest.map(([x, y]) => `${fmt(x)} ${fmt(y)} l`).join(' ')} S Q`,
      );
    } else if (p.kind === 'ellipse') {
      const inner = p.hollow ? ` ${ellipsePath(p.cx, p.cy, p.rx * 0.6, p.ry * 0.5, true)}` : '';
      ops.push(`q ${ellipsePath(p.cx, p.cy, p.rx, p.ry)}${inner} f Q`);
    } else {
      // A tall curved glyph (clef, brace, ending number): a lens of two curves.
      const { x, y, w, h } = p;
      ops.push(
        `q ${fmt(x)} ${fmt(y)} m ${fmt(x + w)} ${fmt(y + h / 3)} ${fmt(x + w)} ${fmt(y + (2 * h) / 3)} ${fmt(x)} ${fmt(y + h)} c ${fmt(x + w / 3)} ${fmt(y + (2 * h) / 3)} ${fmt(x + w / 3)} ${fmt(y + h / 3)} ${fmt(x)} ${fmt(y)} c h f Q`,
      );
    }
  }
  return ops.join('\n');
}

/** A minimal PDF: one content stream per page, no fonts, no compression. */
export function pdfDocument(
  pages: readonly string[],
  extra: (page: number) => { resources: string; objects: (string | Uint8Array)[] } = () => ({
    resources: '',
    objects: [],
  }),
): Uint8Array {
  const objects: (string | Uint8Array)[] = [];
  const pageIds: number[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  let next = 3;
  const bodies: [number, string | Uint8Array][] = [];
  pages.forEach((content, i) => {
    const pageId = next++;
    const contentId = next++;
    const more = extra(i);
    const extraIds = more.objects.map(() => next++);
    pageIds.push(pageId);
    const resources = more.resources.replace(/\{(\d+)\}/g, (_, k: string) =>
      String(extraIds[Number(k)]),
    );
    bodies.push([
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(PAGE.width)} ${fmt(PAGE.height)}] /Resources << ${resources} >> /Contents ${contentId} 0 R >>`,
    ]);
    bodies.push([contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    more.objects.forEach((o, k) => bodies.push([extraIds[k] as number, o]));
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  for (const [id, body] of bodies) objects[id] = body;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  write('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = length;
    const body = objects[id] ?? 'null';
    write(`${id} 0 obj\n`);
    write(body);
    write('\nendobj\n');
  }
  const xref = length;
  write(`xref\n0 ${objects.length}\n0000000000 65535 f \n`);
  for (let id = 1; id < objects.length; id++)
    write(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  write(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function withDefaults(options: FixtureOptions): Required<FixtureOptions> {
  return {
    space: options.space ?? 5,
    style: options.style ?? 'stroke',
    scale: options.scale ?? 0.96,
    brokenStaffLines: options.brokenStaffLines ?? false,
    pedal: options.pedal ?? false,
  };
}

export function truthOf(pages: readonly FixturePage[]): FixtureTruth {
  const barsPerSystem = pages.map((p) => p.systems.map((s) => s.bars.length));
  return { barsPerSystem, bars: barsPerSystem.flat().reduce((a, b) => a + b, 0) };
}

/** A vector PDF of the pages. */
export function scorePdf(pages: readonly FixturePage[], options: FixtureOptions = {}): Uint8Array {
  const o = withDefaults(options);
  return pdfDocument(pages.map((p) => contentStream(layoutPage(p, o), o.scale)));
}

/** Bars of a common width, `count` of them, `perSystem` to a system and `systems` to a page. */
export function plainPages(
  count: number,
  {
    perSystem = 4,
    systems = 6,
    heads = 4,
    width = 120,
  }: {
    perSystem?: number;
    systems?: number;
    heads?: number | ((bar: number) => number);
    width?: number;
  } = {},
): FixturePage[] {
  const pages: FixturePage[] = [];
  for (let bar = 0; bar < count;) {
    const page: FixturePage = { systems: [] };
    for (let s = 0; s < systems && bar < count; s++) {
      const bars: FixtureBar[] = [];
      for (let k = 0; k < perSystem && bar < count; k++, bar++) {
        bars.push({ width, heads: typeof heads === 'number' ? heads : heads(bar) });
      }
      page.systems.push({ bars });
    }
    pages.push(page);
  }
  const last = pages.at(-1)?.systems.at(-1)?.bars.at(-1);
  if (last) last.end = 'final';
  return pages;
}

/** A grey bitmap of a page as a scanner would see it, `dpi` dots per inch and an optional tilt. */
export function scanBitmap(
  page: FixturePage,
  {
    dpi = 150,
    tilt = 0,
    options = {},
  }: { dpi?: number; tilt?: number; options?: FixtureOptions } = {},
): { width: number; height: number; data: Uint8Array; channels: 1 } {
  const o = withDefaults({ ...options, scale: 1 });
  const k = dpi / 72;
  const width = Math.round(PAGE.width * k);
  const height = Math.round(PAGE.height * k);
  const data = new Uint8Array(width * height).fill(255);
  // A tilt of `tilt` pixels over the page width, as a slightly skewed scan.
  const shift = (x: number) => (tilt * x) / width;
  const dot = (px: number, py: number) => {
    const yy = Math.round(py + shift(px));
    const xx = Math.round(px);
    if (xx >= 0 && xx < width && yy >= 0 && yy < height) data[yy * width + xx] = 0;
  };
  const fillRect = (x: number, y: number, w: number, h: number) => {
    for (let px = Math.floor(x * k); px <= Math.ceil((x + w) * k) - 1; px++)
      for (let py = Math.floor(y * k); py <= Math.ceil((y + h) * k) - 1; py++) dot(px, py);
  };
  for (const p of layoutPage(page, o)) {
    if (p.kind === 'line') {
      const w = Math.max(p.width, 1 / k);
      if (p.y0 === p.y1) fillRect(Math.min(p.x0, p.x1), p.y0 - w / 2, Math.abs(p.x1 - p.x0), w);
      else if (p.x0 === p.x1)
        fillRect(p.x0 - w / 2, Math.min(p.y0, p.y1), w, Math.abs(p.y1 - p.y0));
    } else if (p.kind === 'rect') fillRect(p.x, p.y, p.w, Math.max(p.h, 1 / k));
    else if (p.kind === 'ellipse') {
      for (let px = Math.floor((p.cx - p.rx) * k); px <= Math.ceil((p.cx + p.rx) * k); px++)
        for (let py = Math.floor((p.cy - p.ry) * k); py <= Math.ceil((p.cy + p.ry) * k); py++) {
          const dx = (px / k - p.cx) / p.rx;
          const dy = (py / k - p.cy) / p.ry;
          if (dx * dx + dy * dy <= 1) dot(px, py);
        }
    }
  }
  return { width, height, data, channels: 1 };
}

/** A scanned PDF: each page one grey image of the drawing, slightly tilted, as a scanner makes. */
export function scanPdf(pages: readonly FixturePage[], dpi = 100): Uint8Array {
  const bitmaps = pages.map((p) => scanBitmap(p, { dpi, tilt: 2 }));
  const encoder = new TextEncoder();
  return pdfDocument(
    bitmaps.map(() => `q ${fmt(PAGE.width)} 0 0 ${fmt(PAGE.height)} 0 0 cm /Im0 Do Q`),
    (i) => {
      const b = bitmaps[i] as (typeof bitmaps)[number];
      const data = deflateSync(b.data);
      const head = encoder.encode(
        `<< /Type /XObject /Subtype /Image /Width ${b.width} /Height ${b.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`,
      );
      const tail = encoder.encode('\nendstream');
      const stream = new Uint8Array(head.length + data.length + tail.length);
      stream.set(head, 0);
      stream.set(data, head.length);
      stream.set(tail, head.length + data.length);
      return { resources: '/XObject << /Im0 {0} 0 R >>', objects: [stream] };
    },
  );
}
