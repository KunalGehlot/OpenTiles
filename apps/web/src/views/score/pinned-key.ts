// The scrolling score's clefs and key signature, read from the SVG Verovio drew (issue #75,
// PLAN.md P1-15). The scrolling view is one long system, so its opening clefs and key signature
// scroll out of sight after a few bars; the pinned header (pinned-header.ts) keeps the ones in
// force at the left edge in view, as MuseScore's continuous view does.
//
// Everything here comes from the drawn glyphs, never from the MusicXML `fifths`, so a transposed
// score and mid-piece key or clef changes come out as engraved. Pure DOM reading with
// `getElementsByTagName` and `getAttribute` only, so Node tests run it on xmldom documents.

/** A glyph Verovio drew as `<use href="#E050-…" transform="translate(x, y) scale(s, s)">`. */
export interface DrawnGlyph {
  href: string;
  x: number;
  y: number;
  scale: number;
}

/** One staff's clef and key signature as the pinned header shows them. */
export interface StaffHead {
  clef: DrawnGlyph | null;
  /** The key signature's accidentals, without the naturals that cancel an old key. */
  accids: DrawnGlyph[];
}

interface Change {
  /** Where the change is drawn: its clef, or the first accidental of its key signature. */
  x: number;
  staff: number;
  clef?: DrawnGlyph;
  key?: DrawnGlyph[];
}

export interface SystemHeads {
  /** Left end of the staff lines. */
  start: number;
  /** Each staff's line heights and thickness, top staff first. */
  staves: { lines: number[]; width: number }[];
  /** Where the opening's clefs sit, and where its key signatures begin. */
  clefX: number;
  keyX: number;
  opening: { clef: DrawnGlyph | null; key: DrawnGlyph[] }[];
  /** Mid-piece clef and key changes, left to right. */
  changes: Change[];
  /** Ids of the glyphs in the SVG's `<defs>`. */
  defined: ReadonlySet<string>;
  /** The system's opening line and its brace or bracket, drawn left of the staff lines. */
  frame: Element[];
}

/** SMuFL natural: in a key signature it only cancels the old key. */
const NATURAL = 'E261';
/** Verovio draws a mid-piece clef with the smaller "clef change" glyph; the header uses the full one. */
const FULL_CLEF: Record<string, string> = { E07A: 'E050', E07B: 'E05C', E07C: 'E062' };
/** Step (C = 0 … B = 6) of the line a clef sits on, by SMuFL glyph. */
function clefStep(href: string): number | null {
  const code = parseInt(glyphCode(href), 16);
  if (code === 0xe07a || (code >= 0xe050 && code <= 0xe05b)) return 4; // G clefs
  if (code === 0xe07b || (code >= 0xe05c && code <= 0xe061)) return 0; // C clefs
  if (code === 0xe07c || (code >= 0xe062 && code <= 0xe068)) return 3; // F clefs
  return null;
}

function glyphCode(href: string): string {
  return /^#?(E[0-9A-F]{3})/i.exec(href)?.[1]?.toUpperCase() ?? '';
}

function hasClass(el: Element, name: string): boolean {
  return (el.getAttribute('class') ?? '').split(/\s+/).includes(name);
}

function groups(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagName('g')).filter((g) => hasClass(g, name));
}

function childElements(el: Element): Element[] {
  return Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1);
}

function glyphsIn(el: Element): DrawnGlyph[] {
  const out: DrawnGlyph[] = [];
  for (const use of Array.from(el.getElementsByTagName('use'))) {
    const href = use.getAttribute('xlink:href') ?? use.getAttribute('href') ?? '';
    const m = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)(?:\s*scale\(\s*(-?[\d.]+))?/.exec(
      use.getAttribute('transform') ?? '',
    );
    if (!href || !m) continue;
    out.push({ href, x: Number(m[1]), y: Number(m[2]), scale: Number(m[3] ?? 1) });
  }
  return out;
}

/** A horizontal line drawn as `M x y L x2 y`, as Verovio draws staff lines. */
function hLine(el: Element): { x: number; y: number } | null {
  const m = /^M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*-?[\d.]+[\s,]+(-?[\d.]+)\s*$/.exec(
    el.getAttribute('d') ?? '',
  );
  return m && m[2] === m[3] ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function staffIndexOf(el: Element): number {
  let node: Node | null = el;
  while (node && !(node.nodeType === 1 && hasClass(node as Element, 'staff'))) {
    node = node.parentNode;
  }
  const staff = node as Element | null;
  const measure = staff?.parentNode as Element | null;
  if (!staff || !measure) return -1;
  return childElements(measure)
    .filter((c) => hasClass(c, 'staff'))
    .indexOf(staff);
}

/**
 * The clefs, key signatures and staff lines of the first system in a drawn score, or null when
 * there is none (an empty score).
 */
export function readSystemHeads(svg: Element): SystemHeads | null {
  const system = groups(svg, 'system')[0];
  const first = system ? groups(system, 'measure')[0] : undefined;
  if (!system || !first) return null;
  const staves: SystemHeads['staves'] = [];
  const opening: SystemHeads['opening'] = [];
  const openingEls = new Set<Element>();
  let start = Infinity;
  let meterX = Infinity;
  for (const staff of childElements(first).filter((c) => hasClass(c, 'staff'))) {
    const lines: number[] = [];
    let width = 0;
    for (const path of childElements(staff).filter((c) => c.tagName.toLowerCase() === 'path')) {
      const line = hLine(path);
      if (!line) continue;
      lines.push(line.y);
      start = Math.min(start, line.x);
      width = Number(path.getAttribute('stroke-width') ?? width);
    }
    staves.push({ lines, width });
    const kids = childElements(staff);
    const clefEl = kids.find((c) => hasClass(c, 'clef'));
    const keyEl = kids.find((c) => hasClass(c, 'keySig'));
    const meterEl = kids.find((c) => hasClass(c, 'meterSig'));
    if (clefEl) openingEls.add(clefEl);
    if (keyEl) openingEls.add(keyEl);
    if (meterEl) meterX = Math.min(meterX, ...glyphsIn(meterEl).map((g) => g.x));
    opening.push({
      clef: clefEl ? (glyphsIn(clefEl)[0] ?? null) : null,
      key: keyEl ? glyphsIn(keyEl) : [],
    });
  }
  if (staves.length === 0 || !Number.isFinite(start)) return null;

  const changes: Change[] = [];
  for (const el of Array.from(system.getElementsByTagName('g'))) {
    if (openingEls.has(el)) continue;
    const isClef = hasClass(el, 'clef');
    if (!isClef && !hasClass(el, 'keySig')) continue;
    const glyphs = glyphsIn(el);
    const staff = staffIndexOf(el);
    const firstGlyph = glyphs[0];
    if (!firstGlyph || staff < 0) continue;
    const x = Math.min(...glyphs.map((g) => g.x));
    changes.push(isClef ? { x, staff, clef: firstGlyph } : { x, staff, key: glyphs });
  }
  changes.sort((a, b) => a.x - b.x);

  const clefX = Math.min(...opening.map((o) => o.clef?.x ?? Infinity), start + spaceOf(staves) / 2);
  const keyStarts = opening.map((o) => o.key[0]?.x ?? Infinity);
  // With no opening key signature, a later one starts where the time signature does, which
  // Verovio places straight after the clefs.
  const keyX = Math.min(...keyStarts) < Infinity ? Math.min(...keyStarts) : meterX;

  const defined = new Set<string>();
  for (const defs of Array.from(svg.getElementsByTagName('defs'))) {
    for (const g of Array.from(defs.getElementsByTagName('*'))) {
      const id = g.getAttribute('id');
      if (id) defined.add(id);
    }
  }
  const frame = childElements(system).filter(
    (c) => (c.tagName.toLowerCase() === 'path' && !hLine(c)) || hasClass(c, 'grpSym'),
  );
  return {
    start,
    staves,
    clefX,
    keyX: Number.isFinite(keyX) ? keyX : clefX + 3.8 * spaceOf(staves),
    opening,
    changes,
    defined,
    frame,
  };
}

/** The distance between two staff lines. */
function spaceOf(staves: SystemHeads['staves']): number {
  const lines = staves.find((s) => s.lines.length > 1)?.lines;
  return lines && lines[0] !== undefined && lines[1] !== undefined
    ? Math.abs(lines[1] - lines[0])
    : 180;
}

/** Where a change starts to count: each x at which the header may show something else. */
export function changePoints(heads: SystemHeads): number[] {
  return [...new Set(heads.changes.map((c) => c.x))];
}

/**
 * How far a key signature drawn under one clef moves to sit right under another: the same pitch
 * classes, in the octave nearest to where they were. Verovio draws treble, bass and alto key
 * signatures in the same shape, so for those this matches what it would draw itself.
 */
function reseat(from: DrawnGlyph, to: DrawnGlyph, space: number): number {
  const a = clefStep(from.href);
  const b = clefStep(to.href);
  if (a === null || b === null) return 0;
  const half = space / 2;
  const octave = 7 * half;
  const same = to.y - from.y + (b - a) * half;
  let shift = same % octave;
  if (shift > octave / 2) shift -= octave;
  if (shift <= -octave / 2) shift += octave;
  return shift;
}

/**
 * The clef and key signature of each staff in force from `x` on, placed where the opening's are
 * drawn, so the header reads like the start of a system.
 */
export function headsAt(heads: SystemHeads, x: number): StaffHead[] {
  const space = spaceOf(heads.staves);
  return heads.opening.map((open, staff) => {
    let clef = open.clef;
    let key = { glyphs: open.key, clef: open.clef };
    for (const c of heads.changes) {
      if (c.x > x) break;
      if (c.staff !== staff) continue;
      if (c.clef) clef = c.clef;
      if (c.key) key = { glyphs: c.key, clef };
    }
    const kept = key.glyphs.filter((g) => glyphCode(g.href) !== NATURAL);
    const dx = heads.keyX - (kept[0]?.x ?? heads.keyX);
    const dy = key.clef && clef ? reseat(key.clef, clef, space) : 0;
    return {
      clef: clef ? placeClef(heads, clef, open.clef) : null,
      accids: kept.map((g) => ({ ...g, x: g.x + dx, y: g.y + dy })),
    };
  });
}

function placeClef(heads: SystemHeads, clef: DrawnGlyph, open: DrawnGlyph | null): DrawnGlyph {
  const code = glyphCode(clef.href);
  const full = FULL_CLEF[code];
  const suffix = clef.href.replace(/^#?E[0-9A-F]{3}/i, '');
  // The full-size glyph is in the defs only if Verovio drew it somewhere; otherwise the change
  // glyph it drew is shown, a little smaller.
  const href = full && heads.defined.has(`${full}${suffix}`) ? `#${full}${suffix}` : clef.href;
  return { href, x: open?.x ?? heads.clefX, y: clef.y, scale: open?.scale ?? clef.scale };
}
