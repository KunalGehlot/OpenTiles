// Finds the written bars on engraved pages (ADR 0018): staves (five equally spaced horizontal
// lines), systems (staves joined by a line or brace at their left), barlines (vertical strokes that
// run exactly from a staff's top line to a staff's bottom line), repeat signs, double and final
// barlines, and endings (volta brackets). Every threshold is in staff spaces, so the size of the
// print does not matter. Pure geometry: no PDF, no DOM.
import type { PageDrawing, SheetBlob, SheetLine } from './drawing';
import type { SheetBar, SheetBarline, SheetLayout } from './types';

export interface Staff {
  /** The y of each of the five lines, top to bottom. */
  lines: number[];
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Distance between two lines (one staff space). */
  space: number;
}

export interface System {
  staves: Staff[];
  top: number;
  bottom: number;
  left: number;
  right: number;
  space: number;
}

/** A bar as found on one page, with its system counted on that page. */
export interface PageBar extends SheetBar {
  /** Notes heads of this bar, as boxes; used for counting and for where the notes start. */
  headBoxes: SheetBlob[];
}

export interface PageResult {
  staves: Staff[];
  systems: System[];
  bars: PageBar[];
  /** Volta brackets on this page: the bars (indices into `bars`) each one covers, in order. */
  endings: Ending[];
  /** The page ends inside a volta bracket that goes on over the next page. */
  openEnding: boolean;
}

export interface Ending {
  bars: number[];
  /** No hook at the left: it continues a bracket from the end of the previous system. */
  continued: boolean;
  /** No hook at the right and it runs to the end of its system: it goes on in the next one. */
  open: boolean;
}

// Staff spaces outside this range are not music (or not a size anyone prints).
const MIN_SPACE = 1.5;
const MAX_SPACE = 30;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

/** Pieces of one horizontal line (some engravers draw staff lines bar by bar) joined into one. */
export function joinHorizontal(lines: readonly SheetLine[], tolerance = 0.15): SheetLine[] {
  const sorted = lines
    .filter((l) => l.dir === 'h' && !l.dashed)
    .sort((a, b) => a.at - b.at || a.from - b.from);
  const out: SheetLine[] = [];
  for (const line of sorted) {
    // Only the lines at (nearly) the same height are candidates; scan back over those.
    let joined = false;
    for (let k = out.length - 1; k >= 0; k--) {
      const prev = out[k];
      if (!prev || line.at - prev.at > tolerance) break;
      if (line.from <= prev.to + 1 && line.to >= prev.from - 1) {
        prev.from = Math.min(prev.from, line.from);
        prev.to = Math.max(prev.to, line.to);
        prev.width = Math.max(prev.width, line.width);
        joined = true;
        break;
      }
    }
    if (!joined) out.push({ ...line });
  }
  return out;
}

/** Two lines of one staff: they start and end in about the same place and are staff-long. */
function sameStaff(a: SheetLine, b: SheetLine, space: number): boolean {
  return (
    Math.abs(a.from - b.from) <= 1.5 * space &&
    Math.abs(a.to - b.to) <= 1.5 * space &&
    // Ledger lines come in equally spaced stacks too, but they are never this long.
    Math.min(a.to - a.from, b.to - b.from) >= 6 * space
  );
}

/** Staves: five horizontal lines, equally spaced, of the same length. */
export function findStaves(lines: readonly SheetLine[]): Staff[] {
  const hs = joinHorizontal(lines);
  const used = new Uint8Array(hs.length);
  const staves: Staff[] = [];
  for (let i = 0; i < hs.length; i++) {
    const first = hs[i];
    if (!first || used[i]) continue;
    for (let j = i + 1; j < hs.length; j++) {
      const second = hs[j];
      if (!second) break;
      const gap = second.at - first.at;
      if (gap < MIN_SPACE) continue;
      if (gap > MAX_SPACE) break;
      if (used[j] || !sameStaff(first, second, gap)) continue;
      const picked = [i, j];
      let k = j + 1;
      for (let n = 2; n < 5; n++) {
        // The spacing so far, not the first gap alone: a scan's lines sit on whole pixels.
        const lastAt = hs[picked[picked.length - 1] ?? i]?.at ?? first.at;
        const step = (lastAt - first.at) / (n - 1);
        const want = lastAt + step;
        let found = -1;
        for (; k < hs.length; k++) {
          const line = hs[k];
          if (!line) break;
          if (line.at > want + step * 0.2) break;
          if (!used[k] && line.at >= want - step * 0.2 && sameStaff(first, line, gap)) {
            found = k;
            k += 1;
            break;
          }
        }
        if (found < 0) break;
        picked.push(found);
      }
      if (picked.length < 5) continue;
      const staffLines = picked.map((p) => hs[p] as SheetLine);
      for (const p of picked) used[p] = 1;
      const ys = staffLines.map((l) => l.at);
      const top = ys[0] ?? 0;
      const bottom = ys[4] ?? 0;
      staves.push({
        lines: ys,
        top,
        bottom,
        left: Math.min(...staffLines.map((l) => l.from)),
        right: Math.max(...staffLines.map((l) => l.to)),
        space: (bottom - top) / 4,
      });
      break;
    }
  }
  return staves.sort((a, b) => a.top - b.top || a.left - b.left);
}

function verticals(lines: readonly SheetLine[]): SheetLine[] {
  return lines.filter((l) => l.dir === 'v' && !l.dashed);
}

/** Staves that belong to one system: a line or a brace joins them at the left (or a barline). */
function joined(
  a: Staff,
  b: Staff,
  vs: readonly SheetLine[],
  blobs: readonly SheetBlob[],
): boolean {
  const s = Math.max(a.space, b.space);
  if (b.top - a.bottom > 24 * s) return false;
  const left = Math.max(a.left, b.left) - s;
  const right = Math.min(a.right, b.right) + s;
  if (right <= left) return false;
  const tol = 0.6 * s;
  if (
    vs.some((v) => v.at >= left && v.at <= right && v.from <= a.bottom + tol && v.to >= b.top - tol)
  )
    return true;
  const edge = Math.min(a.left, b.left);
  return blobs.some(
    (bl) =>
      bl.x + bl.width <= edge + s &&
      bl.x >= edge - 8 * s &&
      bl.y <= a.top + s &&
      bl.y + bl.height >= b.bottom - s,
  );
}

export function findSystems(
  staves: readonly Staff[],
  lines: readonly SheetLine[],
  blobs: readonly SheetBlob[] = [],
): System[] {
  const vs = verticals(lines);
  const groups: Staff[][] = [];
  for (const staff of staves) {
    const current = groups.at(-1);
    const prev = current?.at(-1);
    if (current && prev && staff.top > prev.bottom && joined(prev, staff, vs, blobs))
      current.push(staff);
    else groups.push([staff]);
  }
  return groups.map((g) => ({
    staves: g,
    top: Math.min(...g.map((s) => s.top)),
    bottom: Math.max(...g.map((s) => s.bottom)),
    left: Math.min(...g.map((s) => s.left)),
    right: Math.max(...g.map((s) => s.right)),
    space: median(g.map((s) => s.space)),
  }));
}

/** One vertical line of a barline (a double barline has two), at x, with its thickness. */
interface Stroke {
  x: number;
  width: number;
}

/** Barline strokes close together, read as one barline. */
interface Cluster {
  strokes: Stroke[];
  left: number;
  right: number;
  /** How the bar before it ends and how the bar after it starts. */
  end: SheetBarline;
  start: SheetBarline;
}

/**
 * The vertical strokes of a system that are barlines: each runs exactly from a staff's top or
 * bottom line to another's (stems end anywhere), and together the strokes at one x cross every
 * staff of the system (a stem stays in one staff).
 */
function barlineStrokes(system: System, vs: readonly SheetLine[]): Stroke[] {
  const s = system.space;
  const tol = 0.6 * s;
  const onEdge = (y: number) =>
    system.staves.some((st) => Math.abs(y - st.top) <= tol || Math.abs(y - st.bottom) <= tol);
  const candidates = vs
    .filter(
      (v) =>
        v.at >= system.left - s &&
        v.at <= system.right + s &&
        v.to - v.from >= 2 * s &&
        onEdge(v.from) &&
        onEdge(v.to),
    )
    .sort((a, b) => a.at - b.at);
  const strokes: Stroke[] = [];
  let i = 0;
  while (i < candidates.length) {
    const first = candidates[i] as SheetLine;
    const group: SheetLine[] = [];
    while (i < candidates.length && (candidates[i] as SheetLine).at - first.at <= 0.2 * s) {
      group.push(candidates[i] as SheetLine);
      i += 1;
    }
    const covers = system.staves.every((st) =>
      group.some((v) => v.from <= st.top + tol && v.to >= st.bottom - tol),
    );
    if (covers) {
      strokes.push({
        x: group.reduce((sum, v) => sum + v.at, 0) / group.length,
        width: Math.max(...group.map((v) => v.width)),
      });
    }
  }
  return strokes;
}

/** Round dots in the second and third spaces of the staves, beside a barline: a repeat sign. */
function repeatDots(system: System, dots: readonly SheetBlob[], from: number, to: number): boolean {
  const s = system.space;
  let withDots = 0;
  for (const st of system.staves) {
    const at = (y: number) =>
      dots.some((d) => {
        const cx = d.x + d.width / 2;
        const cy = d.y + d.height / 2;
        return cx >= from && cx <= to && Math.abs(cy - y) <= 0.35 * s;
      });
    if (at(st.top + 1.5 * st.space) && at(st.top + 2.5 * st.space)) withDots += 1;
  }
  return withDots === system.staves.length;
}

function clusterBarlines(system: System, strokes: readonly Stroke[], dots: readonly SheetBlob[]) {
  const s = system.space;
  const groups: Stroke[][] = [];
  for (const stroke of strokes) {
    const current = groups.at(-1);
    const last = current?.at(-1);
    if (current && last && stroke.x - last.x <= 1.3 * s) current.push(stroke);
    else groups.push([stroke]);
  }
  const thin = Math.min(...strokes.map((st) => st.width));
  const thick = (st: Stroke) => st.width >= Math.max(1.8 * thin, 0.3 * s);
  return groups.map((g): Cluster => {
    const left = Math.min(...g.map((st) => st.x - st.width / 2));
    const right = Math.max(...g.map((st) => st.x + st.width / 2));
    // Dotted notes before a barline put dots in the same spaces; a repeat sign is a thin and a
    // thick line with dots in every staff.
    const pair = g.length > 1 && g.some(thick);
    const dotsLeft = pair && repeatDots(system, dots, left - 2 * s, left);
    const dotsRight = pair && repeatDots(system, dots, right, right + 2 * s);
    let end: SheetBarline = g.length > 1 ? 'double' : 'single';
    let start: SheetBarline = end;
    if (dotsLeft) end = 'repeat-end';
    if (dotsRight) start = 'repeat-start';
    if (!dotsLeft && !dotsRight && g.length > 1 && thick(g[g.length - 1] as Stroke)) {
      end = 'final';
      start = 'single';
    }
    if (dotsLeft && !dotsRight) start = 'single';
    return { strokes: g, left, right, end, start };
  });
}

/** Note heads: a curved outline the size of a head, sitting on a line or in a space of a staff. */
export function isNoteHead(blob: SheetBlob, staff: Staff): boolean {
  const s = staff.space;
  if (!blob.curved) return false;
  const w = blob.width / s;
  const h = blob.height / s;
  if (w < 0.95 || w > 2.3 || h < 0.6 || h > 1.35 || w / h < 1 || w / h > 2.6) return false;
  const step = (blob.y + blob.height / 2 - staff.top) / (s / 2);
  const k = Math.round(step);
  return Math.abs(step - k) <= 0.45 && k >= -14 && k <= 22;
}

/** The staff of a system nearest to a y (for heads above, below and between the staves). */
function nearestStaff(system: System, y: number): Staff {
  let best = system.staves[0] as Staff;
  let bestDistance = Infinity;
  for (const st of system.staves) {
    const d = y < st.top ? st.top - y : y > st.bottom ? y - st.bottom : 0;
    if (d < bestDistance) {
      best = st;
      bestDistance = d;
    }
  }
  return best;
}

/** The system each head belongs to: the nearest one, within a few ledger lines. */
function headsBySystem(systems: readonly System[], blobs: readonly SheetBlob[]): SheetBlob[][] {
  const out = systems.map((): SheetBlob[] => []);
  for (const blob of blobs) {
    if (!blob.curved) continue;
    const cy = blob.y + blob.height / 2;
    const cx = blob.x + blob.width / 2;
    let best = -1;
    let bestDistance = Infinity;
    systems.forEach((sys, i) => {
      if (cx < sys.left - sys.space || cx > sys.right + sys.space) return;
      const d = cy < sys.top ? sys.top - cy : cy > sys.bottom ? cy - sys.bottom : 0;
      if (d <= 8 * sys.space && d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    const sys = systems[best];
    if (sys && isNoteHead(blob, nearestStaff(sys, cy))) out[best]?.push(blob);
  }
  return out;
}

function horizontalOf(lines: readonly SheetLine[]): SheetLine[] {
  return lines.filter((l) => l.dir === 'h' && !l.dashed);
}

/** Bars of one system, left to right. */
function systemBars(
  page: number,
  system: System,
  index: number,
  vs: readonly SheetLine[],
  dots: readonly SheetBlob[],
  heads: readonly SheetBlob[],
): PageBar[] {
  const s = system.space;
  const strokes = barlineStrokes(system, vs);
  const clusters = strokes.length > 0 ? clusterBarlines(system, strokes, dots) : [];
  interface Boundary {
    left: number;
    right: number;
    end: SheetBarline;
    start: SheetBarline;
  }
  // The left edge: the system's own line, or the start of the staves when it has none.
  const boundaries: Boundary[] = [];
  const first = clusters[0];
  if (first && first.left - system.left <= 1.5 * s) {
    const start = first.start === 'repeat-start' ? 'repeat-start' : 'none';
    boundaries.push({ left: first.left, right: first.right, end: 'none', start });
    clusters.shift();
  } else {
    boundaries.push({ left: system.left, right: system.left, end: 'none', start: 'none' });
  }
  for (const c of clusters)
    boundaries.push({ left: c.left, right: c.right, end: c.end, start: c.start });
  const headsIn = (from: number, to: number) =>
    heads.filter((h) => {
      const cx = h.x + h.width / 2;
      return cx >= from && cx < to;
    });
  // After the last barline: a bar only if notes are written there (not a courtesy signature).
  const last = boundaries.at(-1);
  if (last && system.right - last.right > 1.5 * s && headsIn(last.right, system.right).length > 0)
    boundaries.push({ left: system.right, right: system.right, end: 'none', start: 'none' });
  // A repeat sign after the clef and key at the start of a system: the space before it is no bar.
  const [edge, second] = boundaries;
  if (
    edge &&
    second &&
    boundaries.length > 2 &&
    second.start === 'repeat-start' &&
    headsIn(edge.right, second.left).length === 0
  ) {
    edge.start = 'repeat-start';
    boundaries.splice(1, 1);
  }
  const bars: PageBar[] = [];
  for (let i = 0; i + 1 < boundaries.length; i++) {
    const a = boundaries[i] as Boundary;
    const b = boundaries[i + 1] as Boundary;
    const inBar = headsIn(a.right, b.left);
    const bar: PageBar = {
      page,
      system: index,
      box: {
        x: a.right,
        y: system.top,
        width: Math.max(0, b.left - a.right),
        height: system.bottom - system.top,
      },
      start: a.start,
      end: b.end,
      heads: inBar.length,
      headBoxes: inBar,
    };
    if (inBar.length > 0) bar.firstNoteX = Math.min(...inBar.map((h) => h.x));
    bars.push(bar);
  }
  return bars;
}

/**
 * Volta brackets over a system: a horizontal line above the top staff with a hook down at its left
 * end, starting at a bar. Tuplet brackets look alike but start at a note, not at a barline.
 */
function systemEndings(
  system: System,
  above: System | undefined,
  bars: readonly PageBar[],
  firstBar: number,
  hs: readonly SheetLine[],
  vs: readonly SheetLine[],
  previousOpen: boolean,
): Ending[] {
  const s = system.space;
  // Nearer this system than the one above (whose staff and pedal lines are up there too).
  const ceiling = above ? (above.bottom + system.top) / 2 : -Infinity;
  const out: Ending[] = [];
  const hook = (x: number, y: number) =>
    vs.find(
      (v) =>
        Math.abs(v.at - x) <= 0.6 * s &&
        Math.abs(v.from - y) <= 0.5 * s &&
        v.to - v.from >= 0.8 * s &&
        v.to - v.from <= 5 * s,
    );
  for (const line of hs) {
    if (line.at > system.top - 1 * s || line.at < Math.max(ceiling, system.top - 14 * s)) continue;
    if (line.from < system.left - s || line.to > system.right + s || line.to - line.from < 2 * s)
      continue;
    const leftHook = hook(line.from, line.at);
    const rightHook = hook(line.to, line.at);
    // A box (around a rehearsal letter, say) has a bottom edge where the hooks end.
    if (
      leftHook &&
      hs.some(
        (o) =>
          o !== line &&
          Math.abs(o.at - leftHook.to) <= 0.3 * s &&
          Math.abs(o.from - line.from) <= 0.6 * s &&
          Math.abs(o.to - line.to) <= 0.6 * s,
      )
    )
      continue;
    const covered: number[] = [];
    bars.forEach((bar, i) => {
      if (bar.system !== bars[firstBar]?.system) return;
      const centre = bar.box.x + bar.box.width / 2;
      if (centre >= line.from && centre <= line.to + 0.5 * s) covered.push(i);
    });
    const start = bars[covered[0] ?? -1];
    if (!start) continue;
    const isFirstOfSystem = covered[0] === firstBar;
    const atBarStart =
      Math.abs(line.from - start.box.x) <= 1.5 * s ||
      (isFirstOfSystem && line.from <= (start.firstNoteX ?? start.box.x + start.box.width / 3) + s);
    const coverage =
      (Math.min(line.to, start.box.x + start.box.width) - Math.max(line.from, start.box.x)) /
      Math.max(1e-6, start.box.width);
    if (!atBarStart || coverage < 0.6) continue;
    const continued = !leftHook && isFirstOfSystem && previousOpen;
    if (!leftHook && !continued) continue;
    const open = !rightHook && system.right - line.to <= 2 * s;
    out.push({ bars: covered, continued, open });
  }
  return out.sort((a, b) => (a.bars[0] ?? 0) - (b.bars[0] ?? 0));
}

/**
 * Systems and bars of one page, top to bottom and left to right. `openEnding`: the previous page
 * ended inside a volta bracket that goes on here.
 */
export function detectPage(drawing: PageDrawing, page: number, openEnding = false): PageResult {
  const staves = findStaves(drawing.lines);
  const systems = findSystems(staves, drawing.lines, drawing.blobs);
  const vs = verticals(drawing.lines);
  const hs = horizontalOf(drawing.lines);
  const s = median(staves.map((st) => st.space));
  const dots = drawing.blobs.filter((b) => {
    if (!b.curved) return false;
    return (
      b.width >= 0.25 * s &&
      b.width <= 0.8 * s &&
      b.height >= 0.25 * s &&
      b.height <= 0.8 * s &&
      Math.abs(b.width - b.height) <= 0.3 * s
    );
  });
  const heads = headsBySystem(systems, drawing.blobs);
  const bars: PageBar[] = [];
  const endings: Ending[] = [];
  let open = openEnding;
  systems.forEach((system, i) => {
    const first = bars.length;
    bars.push(...systemBars(page, system, i, vs, dots, heads[i] ?? []));
    if (bars.length === first) return;
    const found = systemEndings(system, systems[i - 1], bars, first, hs, vs, open);
    endings.push(...found);
    open = found.at(-1)?.open ?? false;
  });
  return { staves, systems, bars, endings, openEnding: open };
}

/**
 * Ending numbers from the order of the brackets: a bracket that starts right after the previous
 * one ends is the next ending, any other starts again at 1. The printed number is an outlined
 * glyph, so it is not read.
 */
function numberEndings(
  bars: SheetBar[],
  endings: readonly { bars: number[]; continued: boolean }[],
) {
  let previousLast = -2;
  let number = 0;
  for (const e of endings) {
    const firstBar = e.bars[0];
    if (firstBar === undefined) continue;
    if (!e.continued) number = firstBar === previousLast + 1 ? number + 1 : 1;
    for (const b of e.bars) {
      const bar = bars[b];
      if (bar) bar.ending = Math.max(1, number);
    }
    previousLast = e.bars.at(-1) ?? previousLast;
  }
}

/** The layout of a whole document from its pages' drawings (pages without staves have no bars). */
export function layoutFromPages(
  pages: readonly { drawing: PageDrawing; result: PageResult; source: 'vector' | 'raster' }[],
): SheetLayout {
  const bars: SheetBar[] = [];
  const endings: { bars: number[]; continued: boolean }[] = [];
  let systemOffset = 0;
  let raster = false;
  for (const { result, source } of pages) {
    const offset = bars.length;
    for (const bar of result.bars) {
      const { headBoxes: _, ...plain } = bar;
      bars.push({ ...plain, system: bar.system + systemOffset });
    }
    for (const e of result.endings) endings.push({ ...e, bars: e.bars.map((b) => b + offset) });
    systemOffset += result.systems.length;
    if (source === 'raster' && result.bars.length > 0) raster = true;
  }
  numberEndings(bars, endings);
  return {
    pages: pages.map((p) => ({ ...p.drawing.page })),
    bars,
    source: raster ? 'raster' : 'vector',
  };
}

/** Detects every page and puts the bars in reading order. */
export function detectLayout(drawings: readonly PageDrawing[]): SheetLayout {
  let open = false;
  return layoutFromPages(
    drawings.map((drawing, page) => {
      const result = detectPage(drawing, page, open);
      open = result.openEnding;
      return { drawing, result, source: 'vector' as const };
    }),
  );
}
