// The pinned header of the scrolling score (issue #75, PLAN.md P1-15): once the opening of the
// one long system has scrolled out of view, the staff lines' beginning, the brace and the clefs
// and key signature in force are drawn at the left edge, like MuseScore's continuous view.
//
// Built once per drawn score from the strip's own glyphs (pinned-key.ts); its `<use>` elements
// point at the strip's `<defs>`, which are in the same document. Each key or clef region gets its
// own group, so scrolling only switches which group shows when a region boundary is crossed:
// nothing is built or measured from requestAnimationFrame.
import { changePoints, headsAt, readSystemHeads } from './pinned-key';
import type { DrawnGlyph, StaffHead, SystemHeads } from './pinned-key';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface Region {
  /** The region counts once its first change has reached the header's right edge. */
  from: number;
  group: SVGGElement;
}

export class PinnedHeader {
  private system: SVGGraphicsElement | null = null;
  private svg: SVGSVGElement | null = null;
  private root: SVGGElement | null = null;
  private regions: Region[] = [];
  /** The header's left and right edges, in the score's own units. */
  private left = 0;
  private right = 0;
  /** Score units per CSS pixel, and the unit at the view's left edge when the score is at 0. */
  private perPx = 1;
  private base = 0;
  /** The region shown (index), or -1 while the real opening is in view. */
  private shown = -1;
  private placed = false;

  constructor(private readonly el: HTMLElement) {}

  /** Reads the drawn score and builds a group for each key and clef region. */
  build(strip: HTMLElement): void {
    this.clear();
    const svg = strip.querySelector('svg');
    const heads = svg ? readSystemHeads(svg) : null;
    const system = svg?.querySelector<SVGGraphicsElement>('g.system') ?? null;
    if (!heads || !system) return;
    this.system = system;

    const out = document.createElementNS(SVG_NS, 'svg');
    out.setAttribute('class', 'ot-score-key-svg');
    const root = document.createElementNS(SVG_NS, 'g');
    out.appendChild(root);
    const lines = document.createElementNS(SVG_NS, 'g');
    lines.setAttribute('class', 'ot-key-lines');
    root.appendChild(lines);
    const frame = document.createElementNS(SVG_NS, 'g');
    for (const el of heads.frame) frame.appendChild(withoutIds(el.cloneNode(true) as Element));
    root.appendChild(frame);

    // One group per distinct state: a change on one staff that the others do not share still
    // makes a new region, but repeated states (back to the first key) reuse their group.
    const byState = new Map<string, SVGGElement>();
    const points = [-Infinity, ...changePoints(heads)];
    this.regions = points.map((from) => {
      const state = headsAt(heads, from);
      const id = JSON.stringify(state);
      let group = byState.get(id);
      if (!group) {
        group = drawHeads(state);
        group.style.display = 'none';
        root.appendChild(group);
        byState.set(id, group);
      }
      return { from, group };
    });

    // Measure every region's glyphs once, while laid out but not seen.
    this.el.appendChild(out);
    this.el.style.visibility = 'hidden';
    this.el.hidden = false;
    let left = heads.start;
    let right = heads.start;
    try {
      for (const r of new Set(this.regions.map((x) => x.group))) {
        r.style.display = '';
        const box = r.getBBox();
        if (box.width > 0) right = Math.max(right, box.x + box.width);
        r.style.display = 'none';
      }
      const box = frame.getBBox();
      if (box.width > 0) left = Math.min(left, box.x);
    } catch {
      // No layout (a browser that cannot measure SVG): the header stays off.
      this.clear();
      return;
    } finally {
      this.el.hidden = true;
      this.el.style.visibility = '';
    }
    const space = spaceOf(heads);
    // A staff space of room after the last accidental, about what Verovio leaves before the time
    // signature, so the notes do not crowd the key signature as they slide under the edge.
    this.left = left - space * 0.25;
    this.right = right + space;
    for (const staff of heads.staves) {
      for (const y of staff.lines) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', `M${heads.start} ${y} L${this.right} ${y}`);
        path.setAttribute('stroke-width', String(staff.width));
        lines.appendChild(path);
      }
    }
    this.svg = out;
    this.root = root;
  }

  /**
   * Sizes and places the header to match the strip as it is drawn now. `scrollPos` is the scroll
   * position the strip is currently moved to. Called when the score is drawn or the view resized.
   */
  place(host: HTMLElement, mover: HTMLElement, scrollPos: number): void {
    const ctm = this.system?.getScreenCTM();
    if (!this.svg || !this.root || !ctm || ctm.a <= 0) {
      this.placed = false;
      return;
    }
    const hostBox = host.getBoundingClientRect();
    const moverBox = mover.getBoundingClientRect();
    const width = (this.right - this.left) * ctm.a;
    const height = mover.offsetHeight;
    this.el.style.top = `${mover.offsetTop}px`;
    this.el.style.width = `${width.toFixed(2)}px`;
    this.el.style.height = `${height}px`;
    this.svg.setAttribute('width', width.toFixed(2));
    this.svg.setAttribute('height', String(height));
    // The strip's own unit-to-pixel mapping, so the staff lines line up to the sub-pixel.
    this.root.setAttribute(
      'transform',
      `matrix(${ctm.a} 0 0 ${ctm.d} ${-this.left * ctm.a} ${ctm.f - moverBox.top})`,
    );
    this.perPx = 1 / ctm.a;
    this.base = (hostBox.left - ctm.e - scrollPos) * this.perPx;
    this.placed = true;
    this.shown = -2;
  }

  /** Called every frame with the scroll position; touches the DOM only when the region changes. */
  update(scrollPos: number): void {
    if (!this.placed) return;
    const at = this.base + scrollPos * this.perPx;
    let next = -1;
    // Shown once the system's start has reached the view's left edge: the header then lies exactly
    // over the real opening, which slides away under it.
    if (at >= this.left) {
      const edge = at + (this.right - this.left);
      next = 0;
      while (next + 1 < this.regions.length && (this.regions[next + 1]?.from ?? Infinity) <= edge)
        next += 1;
    }
    if (next === this.shown) return;
    const was = this.regions[this.shown]?.group;
    const now = this.regions[next]?.group;
    if (was && was !== now) was.style.display = 'none';
    if (now) now.style.display = '';
    this.el.hidden = next < 0;
    this.shown = next;
  }

  clear(): void {
    this.el.hidden = true;
    this.el.replaceChildren();
    this.system = null;
    this.svg = null;
    this.root = null;
    this.regions = [];
    this.placed = false;
    this.shown = -1;
  }
}

function spaceOf(heads: SystemHeads): number {
  const lines = heads.staves.find((s) => s.lines.length > 1)?.lines ?? [];
  return lines[0] !== undefined && lines[1] !== undefined ? Math.abs(lines[1] - lines[0]) : 180;
}

/** The clefs and key signatures of one region, with Verovio's class names. */
function drawHeads(state: StaffHead[]): SVGGElement {
  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('class', 'ot-key-region');
  for (const staff of state) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'ot-key-staff');
    if (staff.clef) g.appendChild(glyph('clef', staff.clef));
    const key = document.createElementNS(SVG_NS, 'g');
    key.setAttribute('class', 'keySig');
    for (const a of staff.accids) key.appendChild(glyph('keyAccid', a));
    g.appendChild(key);
    group.appendChild(g);
  }
  return group;
}

function glyph(cls: string, at: DrawnGlyph): SVGGElement {
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', cls);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', at.href);
  use.setAttribute('transform', `translate(${at.x}, ${at.y}) scale(${at.scale}, ${at.scale})`);
  g.appendChild(use);
  return g;
}

/** A clone must not repeat the strip's ids. */
function withoutIds(el: Element): Element {
  el.removeAttribute('id');
  for (const child of Array.from(el.querySelectorAll('[id]'))) child.removeAttribute('id');
  return el;
}
