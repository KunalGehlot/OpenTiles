// Scores engraved by a real engraver, Verovio (LGPL-3.0-or-later), in any of its music fonts, and
// written as vector PDFs the way MuseScore exports them: staff lines, stems, barlines and ledger
// lines stroked, every glyph an outlined path, no text. Only the drawing is converted, so tests
// see real spacing, chords, accidentals and clefs in several fonts, and need no glyph data of
// their own. Node only, for the tests.
import { pdfDocument } from './fixtures';

export type MusicFont = 'Leipzig' | 'Bravura' | 'Leland' | 'Petaluma' | 'Gootville';

interface Toolkit {
  setOptions(options: Record<string, unknown>): void;
  loadData(data: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
  destroy(): void;
}

let verovio: Promise<{ module: unknown; Toolkit: new (module: unknown) => Toolkit }> | null = null;

/** The pages of a MusicXML score engraved in a music font, as SVG. */
export async function engrave(musicxml: string, font: MusicFont): Promise<string[]> {
  verovio ??= Promise.all([import('verovio/wasm'), import('verovio/esm')]).then(
    async ([wasm, esm]) => {
      const module = await wasm.default();
      esm.enableLog(esm.LOG_OFF, module);
      return { module, Toolkit: esm.VerovioToolkit as new (module: unknown) => Toolkit };
    },
  );
  const { module, Toolkit } = await verovio;
  const tk = new Toolkit(module);
  try {
    tk.setOptions({ header: 'none', footer: 'none', font, breaks: 'auto' });
    if (!tk.loadData(musicxml)) throw new Error('Verovio could not read the score');
    return Array.from({ length: tk.getPageCount() }, (_, i) => tk.renderToSVG(i + 1));
  } finally {
    tk.destroy();
  }
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** An SVG `transform` attribute (translate, scale, rotate and matrix, as Verovio writes them). */
function transformOf(text: string | undefined): Matrix {
  let m = IDENTITY;
  for (const [, op, args] of (text ?? '').matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = (args ?? '')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const [a = 0, b, c = 0, d = 0, e = 0, f = 0] = v;
    if (op === 'translate') m = multiply(m, [1, 0, 0, 1, a, b ?? 0]);
    else if (op === 'scale') m = multiply(m, [a, 0, 0, b ?? a, 0, 0]);
    else if (op === 'matrix') m = multiply(m, [a, b ?? 0, c, d, e, f]);
    else if (op === 'rotate') {
      // rotate(angle [cx cy]), in degrees: the arpeggio's wavy line is a rotated glyph.
      const r = (a * Math.PI) / 180;
      const [x, y] = [b ?? 0, c];
      m = multiply(m, [1, 0, 0, 1, x, y]);
      m = multiply(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
      m = multiply(m, [1, 0, 0, 1, -x, -y]);
    }
  }
  return m;
}

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * SVG path data as PDF path operators, every point through `m`. Relative commands, horizontal and
 * vertical lines, smooth and quadratic curves are written out as lines and cubic curves.
 */
function pathOps(d: string, m: Matrix): { ops: string; curved: boolean; closed: boolean } {
  const tokens = [...d.matchAll(/([a-zA-Z])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/g)];
  const out: string[] = [];
  const pt = (x: number, y: number) =>
    `${fmt(m[0] * x + m[2] * y + m[4])} ${fmt(m[1] * x + m[3] * y + m[5])}`;
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // The last control point, for the smooth curves (S, T) that mirror it.
  let cx = 0;
  let cy = 0;
  let curved = false;
  let closed = false;
  const num = () => Number(tokens[i++]?.[2] ?? 0);
  const hasNumber = () => tokens[i]?.[2] !== undefined;
  while (i < tokens.length) {
    if (!hasNumber()) cmd = tokens[i++]?.[1] ?? '';
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M':
        x = ox + num();
        y = oy + num();
        startX = x;
        startY = y;
        out.push(`${pt(x, y)} m`);
        // Further pairs after a move are lines.
        cmd = rel ? 'l' : 'L';
        break;
      case 'L':
        x = ox + num();
        y = oy + num();
        out.push(`${pt(x, y)} l`);
        break;
      case 'H':
        x = ox + num();
        out.push(`${pt(x, y)} l`);
        break;
      case 'V':
        y = oy + num();
        out.push(`${pt(x, y)} l`);
        break;
      case 'C':
      case 'S': {
        const smooth = cmd.toUpperCase() === 'S';
        const x1 = smooth ? 2 * x - cx : ox + num();
        const y1 = smooth ? 2 * y - cy : oy + num();
        const x2 = ox + num();
        const y2 = oy + num();
        x = ox + num();
        y = oy + num();
        out.push(`${pt(x1, y1)} ${pt(x2, y2)} ${pt(x, y)} c`);
        cx = x2;
        cy = y2;
        curved = true;
        continue;
      }
      case 'Q':
      case 'T': {
        const smooth = cmd.toUpperCase() === 'T';
        const qx = smooth ? 2 * x - cx : ox + num();
        const qy = smooth ? 2 * y - cy : oy + num();
        const ex = ox + num();
        const ey = oy + num();
        out.push(
          `${pt(x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y))} ${pt(ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey))} ${pt(ex, ey)} c`,
        );
        x = ex;
        y = ey;
        cx = qx;
        cy = qy;
        curved = true;
        continue;
      }
      case 'Z':
        out.push('h');
        x = startX;
        y = startY;
        closed = true;
        break;
      default:
        // Arcs and anything else Verovio does not write for these scores.
        i += 1;
    }
    cx = x;
    cy = y;
  }
  return { ops: out.join(' '), curved, closed };
}

const attributes = (text: string): Record<string, string | undefined> =>
  Object.fromEntries([...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));

/** One page's SVG as a PDF content stream, in points from the top-left corner of an A4 page. */
function contentOf(svg: string, pageHeight: number): string {
  const glyphs = new Map<string, { d: string; m: Matrix }>();
  const defs = svg.slice(0, svg.indexOf('</defs>'));
  for (const g of defs.matchAll(/<g id="([^"]+)"[^>]*>\s*<path([^>]*)\/>/g)) {
    const a = attributes(g[2] ?? '');
    glyphs.set(g[1] ?? '', { d: a.d ?? '', m: transformOf(a.transform) });
  }
  // Verovio draws in tenths of its pixels; its page is 21000 units wide for A4 (595.28 pt).
  const outer = svg.match(/<svg[^>]*viewBox="0 0 ([\d.]+) [\d.]+"/);
  const width = Number(outer?.[1] ?? 21000);
  const k = 595.28 / width;
  const ops = [`1 0 0 -1 0 ${fmt(pageHeight)} cm`];
  const stack: Matrix[] = [[k, 0, 0, k, 0, 0]];
  const body = svg.slice(svg.indexOf('</defs>'));
  for (const tag of body.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, closing, name, attrText = '', selfClosing] = tag;
    const top = stack[stack.length - 1] ?? IDENTITY;
    if (name === 'g' || name === 'svg') {
      if (closing) stack.pop();
      else if (!selfClosing) stack.push(multiply(top, transformOf(attributes(attrText).transform)));
      continue;
    }
    if (closing) continue;
    const a = attributes(attrText);
    const m = multiply(top, transformOf(a.transform));
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    if (name === 'path' && a.d) {
      const p = pathOps(a.d, m);
      const width = Number(a['stroke-width'] ?? 0) * scale;
      // Lines are stroked; closed curved outlines (ties, slurs) are filled.
      if (p.closed && p.curved) ops.push(`q ${p.ops} f Q`);
      else ops.push(`q ${fmt(width)} w 0 J ${p.ops} S Q`);
    } else if (name === 'use') {
      const glyph = glyphs.get((a['xlink:href'] ?? a.href ?? '').replace(/^#/, ''));
      if (glyph) ops.push(`q ${pathOps(glyph.d, multiply(m, glyph.m)).ops} f Q`);
    } else if (name === 'polygon' && a.points) {
      const v = a.points
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      const d = v.map((n, j) => (j % 2 === 0 ? `${j === 0 ? 'M' : 'L'}${n}` : ` ${n} `)).join('');
      ops.push(`q ${pathOps(`${d}Z`, m).ops} f Q`);
    } else if (name === 'rect') {
      const [x = 0, y = 0, w = 0, h = 0] = ['x', 'y', 'width', 'height'].map((key) =>
        Number(a[key] ?? 0),
      );
      ops.push(`q ${pathOps(`M${x} ${y}h${w}v${h}h${-w}Z`, m).ops} f Q`);
    } else if (name === 'ellipse') {
      const [cxe = 0, cye = 0, rx = 0, ry = 0] = ['cx', 'cy', 'rx', 'ry'].map((key) =>
        Number(a[key] ?? 0),
      );
      const c = 0.5523;
      const d = `M${cxe + rx} ${cye}C${cxe + rx} ${cye + c * ry} ${cxe + c * rx} ${cye + ry} ${cxe} ${cye + ry}C${cxe - c * rx} ${cye + ry} ${cxe - rx} ${cye + c * ry} ${cxe - rx} ${cye}C${cxe - rx} ${cye - c * ry} ${cxe - c * rx} ${cye - ry} ${cxe} ${cye - ry}C${cxe + c * rx} ${cye - ry} ${cxe + rx} ${cye - c * ry} ${cxe + rx} ${cye}Z`;
      ops.push(`q ${pathOps(d, m).ops} f Q`);
    }
  }
  return ops.join('\n');
}

/** A vector PDF of engraved SVG pages, one A4 page each. */
export function svgPdf(svgs: readonly string[]): Uint8Array {
  return pdfDocument(svgs.map((svg) => contentOf(svg, 841.89)));
}
