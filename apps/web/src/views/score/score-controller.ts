// Draws the score with Verovio and keeps it in step with the practice session: cursor, note
// colours, page turns, hardest bars (PLAN.md P1-15, P1-24, P2-11, P2-12). Plain DOM work from
// requestAnimationFrame; React only mounts the host elements (docs/development.md: timing-critical drawing
// bypasses React).
import type { Song, SongNote } from '@opentiles/song-model';
import type { PracticeSession } from '../session';
import { buildAnchors, positionAt } from './cursor-map';
import type { Anchor, MeasureBox } from './cursor-map';
import { glyphsFromTimemap, linkNotes, measureOrderFromSvg } from './glyph-map';
import type { ScoreLinks, TimemapEntry } from './glyph-map';
import { fingersToAdd, glyphStates, nearestByBeat, noteStates } from './note-states';
import type { NoteState } from './note-states';
import type { Toolkit } from './verovio';

export type ScoreLayout = 'scroll' | 'page';

const STATE_CLASSES: Record<NoteState, string> = {
  expected: 'ot-expected',
  correct: 'ot-correct',
  wrong: 'ot-wrong',
  done: 'ot-done',
  other: 'ot-other',
};
const ALL_STATE_CLASSES = Object.values(STATE_CLASSES);
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Verovio scale (percent) for a view width: smaller on narrow screens (⅓ iPad, P1-27). */
export function scaleFor(width: number, layout: ScoreLayout): number {
  if (layout === 'scroll') return width < 500 ? 32 : 40;
  return width < 500 ? 26 : width < 900 ? 32 : 38;
}

export interface PageInfo {
  page: number;
  pageCount: number;
}

export class ScoreController {
  readonly links: ScoreLinks;
  private readonly startOf: Map<string, number>;
  private readonly noteById: Map<string, SongNote>;
  /** Source measure index → measure element id (document order). */
  private measureIds: string[] = [];
  private pages: string[] = [];
  private measurePage = new Map<number, number>();
  private shown = 1;
  private cursorPage = 0;
  private anchors: Anchor[] = [];
  private elements = new Map<string, Element>();
  private applied = new Map<string, NoteState>();
  private lastSignature = '';
  private lastBeat = Number.NaN;
  private lastForced = 0;
  private hardest: number[] = [];
  private size = { width: 0, height: 0 };
  /** Called when the shown page or the page count changes. */
  onPage: (info: PageInfo) => void = () => {};

  constructor(
    private readonly tk: Toolkit,
    private readonly song: Song,
    private readonly session: PracticeSession,
    readonly layout: ScoreLayout,
    private readonly host: HTMLElement,
    private readonly strip: HTMLElement,
    private readonly cursor: HTMLElement,
    /** Ids of notes whose finger was suggested rather than written (P4-08). */
    private readonly suggested: ReadonlySet<string> = new Set(),
  ) {
    this.startOf = new Map(song.notes.map((n) => [n.id, n.startBeat]));
    this.noteById = new Map(song.notes.map((n) => [n.id, n]));
    this.size = { width: host.clientWidth, height: host.clientHeight };
    this.layoutPages();
    const timemap = tk.renderToTimemap({ includeMeasures: true, includeRests: false });
    const glyphs = glyphsFromTimemap(
      Array.isArray(timemap) ? (timemap as TimemapEntry[]) : [],
      this.measureIds,
      (id) => tk.getMIDIValuesForElement(id)?.pitch,
    );
    this.links = linkNotes(song, glyphs);
    this.showPage(1);
  }

  /** Renders every page to SVG strings and indexes which page each measure is on. */
  private layoutPages(): void {
    const { width, height } = this.size;
    const scale = scaleFor(width, this.layout);
    const units = (px: number) => Math.round((px * 100) / scale);
    if (this.layout === 'scroll') {
      this.tk.setOptions({
        scale,
        breaks: 'none',
        adjustPageHeight: true,
        adjustPageWidth: true,
        pageMarginLeft: 0,
        pageMarginRight: 0,
        pageMarginTop: 40,
        pageMarginBottom: 40,
      });
    } else {
      this.tk.setOptions({
        scale,
        breaks: 'auto',
        adjustPageHeight: false,
        adjustPageWidth: false,
        pageWidth: Math.max(units(width), 600),
        pageHeight: Math.max(units(height), 600),
        pageMarginLeft: 60,
        pageMarginRight: 60,
        pageMarginTop: 60,
        pageMarginBottom: 60,
      });
    }
    this.tk.redoLayout();
    const count = Math.max(1, this.tk.getPageCount());
    this.pages = Array.from({ length: count }, (_, i) => this.tk.renderToSVG(i + 1));
    this.measurePage.clear();
    this.measureIds = measureOrderFromSvg(this.pages);
    const order = new Map(this.measureIds.map((id, i) => [id, i]));
    this.pages.forEach((svg, i) => {
      for (const id of measureOrderFromSvg([svg])) {
        const index = order.get(id);
        if (index !== undefined && !this.measurePage.has(index)) this.measurePage.set(index, i + 1);
      }
    });
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get page(): number {
    return this.shown;
  }

  /** Shows a page (page view) or the single long system (scrolling view). */
  showPage(page: number): void {
    const n = Math.min(Math.max(1, page), this.pages.length);
    this.shown = n;
    this.strip.innerHTML = this.pages[n - 1] ?? '';
    this.elements.clear();
    this.applied.clear();
    this.lastSignature = '';
    for (const el of this.strip.querySelectorAll('g.note')) this.elements.set(el.id, el);
    // Left-hand notes take the left-hand colour when expected, as on the keyboard.
    for (const n of this.song.notes) {
      if (n.hand !== 'left') continue;
      for (const g of this.links.glyphsOf.get(n.id) ?? [])
        this.elements.get(g)?.classList.add('ot-lh');
    }
    this.addFingering();
    this.measure();
    this.decorateHardest();
    this.onPage({ page: n, pageCount: this.pages.length });
  }

  turn(delta: number): void {
    this.showPage(this.shown + delta);
  }

  /** Re-lays out the pages after the view was resized (page view only). */
  resize(width: number, height: number): void {
    if (this.layout !== 'page') {
      this.measure();
      return;
    }
    if (Math.abs(width - this.size.width) < 24 && Math.abs(height - this.size.height) < 24) return;
    this.size = { width, height };
    this.layoutPages();
    this.cursorPage = 0;
    this.showPage(Math.min(this.shown, this.pages.length));
  }

  /** Measure and note positions on the shown page, in pixels relative to the strip. */
  private measure(): void {
    const svg = this.strip.querySelector('svg');
    if (!svg) {
      this.anchors = [];
      return;
    }
    const origin = this.strip.getBoundingClientRect();
    const boxes = new Map<number, MeasureBox>();
    this.measureIds.forEach((id, index) => {
      const el = this.strip.querySelector(`[id="${id}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const system = el.closest('g.system')?.getBoundingClientRect() ?? r;
      boxes.set(index, {
        left: r.left - origin.left,
        right: r.right - origin.left,
        top: system.top - origin.top,
        height: system.height,
        page: this.shown,
      });
    });
    const noteX = new Map<string, number>();
    for (const [noteId, glyphs] of this.links.glyphsOf) {
      const el = glyphs[0] ? this.elements.get(glyphs[0]) : undefined;
      const head = el?.querySelector('.notehead') ?? el;
      if (!head) continue;
      const r = head.getBoundingClientRect();
      noteX.set(noteId, r.left + r.width / 2 - origin.left);
    }
    this.anchors = buildAnchors(this.song, boxes, noteX);
  }

  /**
   * Adds fingers above (right hand) or below (left hand) the note heads: the written ones Verovio
   * did not draw (ABC) and the suggested ones (P2-12, P4-08).
   */
  private addFingering(): void {
    const drawn = this.strip.querySelector('g.fing') !== null;
    for (const mark of fingersToAdd(this.song.notes, drawn, this.suggested)) {
      const n = this.noteById.get(mark.noteId);
      const id = this.links.glyphsOf.get(mark.noteId)?.[0];
      const el = id ? this.elements.get(id) : undefined;
      const head = el?.querySelector('.notehead');
      if (!n || !el || !head || el.querySelector('.ot-fing')) continue;
      const box = (head as SVGGraphicsElement).getBBox?.();
      if (!box) continue;
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('class', mark.suggested ? 'ot-fing ot-fing-suggested' : 'ot-fing');
      text.setAttribute('x', String(box.x + box.width / 2));
      text.setAttribute(
        'y',
        String(n.hand === 'left' ? box.y + box.height + 420 : Math.max(0, box.y - 160)),
      );
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', '300');
      text.textContent = String(mark.finger);
      el.appendChild(text);
    }
  }

  /** Marks the bars with the most mistakes after a run (P1-24); empty clears them. */
  setHardest(measureIndices: readonly number[]): void {
    const sources = measureIndices
      .map((i) => this.song.measures[i]?.sourceIndex)
      .filter((s): s is number => s !== undefined);
    const changed = sources.join(',') !== this.hardest.join(',');
    this.hardest = sources;
    if (!changed) return;
    const first = sources[0];
    if (first !== undefined && this.layout === 'page') {
      const page = this.measurePage.get(first);
      if (page && page !== this.shown) {
        this.showPage(page);
        return;
      }
    }
    this.decorateHardest();
    if (first !== undefined && this.layout === 'scroll') {
      const box = this.anchors.find((a) => a.beat >= (this.measureStartOfSource(first) ?? 0));
      if (box) this.host.scrollLeft = Math.max(0, box.x - this.host.clientWidth * 0.3);
    }
  }

  private measureStartOfSource(source: number): number | undefined {
    return this.song.measures.find((m) => m.sourceIndex === source)?.startBeat;
  }

  private decorateHardest(): void {
    for (const el of this.strip.querySelectorAll('.ot-hardest')) el.remove();
    for (const el of this.strip.querySelectorAll('.ot-hardest-bar')) {
      el.classList.remove('ot-hardest-bar');
    }
    this.hardest.forEach((source, rank) => {
      const id = this.measureIds[source];
      const el = id ? this.strip.querySelector<SVGGraphicsElement>(`[id="${id}"]`) : null;
      if (!el || typeof el.getBBox !== 'function') return;
      const box = el.getBBox();
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('class', 'ot-hardest');
      rect.setAttribute('x', String(box.x - 60));
      rect.setAttribute('y', String(box.y - 60));
      rect.setAttribute('width', String(box.width + 120));
      rect.setAttribute('height', String(box.height + 120));
      rect.setAttribute('rx', '80');
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = rank === 0 ? 'Hardest bar' : 'One of the hardest bars';
      rect.appendChild(title);
      el.classList.add('ot-hardest-bar');
      el.insertBefore(rect, el.firstChild);
    });
  }

  /** Called every animation frame. */
  frame(now: number): void {
    const s = this.session;
    const beat = s.beat;
    this.followCursor(beat);
    const current =
      s.mode === 'wait' ? new Set((s.wait.current?.notes ?? []).map((n) => n.id)) : null;
    let wrong = 0;
    for (const v of s.marks.values()) if (v === 'wrong') wrong += 1;
    const signature = `${beat.toFixed(2)}|${s.wait.index}|${s.marks.size}|${wrong}|${s.hands}|${this.shown}`;
    if (signature === this.lastSignature && now - this.lastForced < 0.5) return;
    this.lastSignature = signature;
    this.lastForced = now;
    const states = noteStates({
      notes: this.song.notes,
      beat,
      current,
      marks: s.marks,
      inHands: (n) => s.inHands(n),
    });
    const glyphs = glyphStates(states, this.links.notesOf, (ids) =>
      nearestByBeat(ids, (id) => this.startOf.get(id), beat),
    );
    for (const [glyph, el] of this.elements) {
      const next = glyphs.get(glyph);
      if (this.applied.get(glyph) === next) continue;
      el.classList.remove(...ALL_STATE_CLASSES);
      if (next) el.classList.add(STATE_CLASSES[next]);
      if (next) this.applied.set(glyph, next);
      else this.applied.delete(glyph);
    }
  }

  private followCursor(beat: number): void {
    // Page view: turn to the page the cursor is on whenever it moves to another page. After a run
    // the view stays where the hardest bars are.
    const reviewing = this.hardest.length > 0;
    if (this.layout === 'page' && !reviewing) {
      const m = this.song.measures.findLast((x) => x.startBeat <= beat + 1e-6);
      const page = m ? this.measurePage.get(m.sourceIndex) : undefined;
      if (page !== undefined && page !== this.cursorPage) {
        this.cursorPage = page;
        if (page !== this.shown) this.showPage(page);
      }
    }
    const pos = positionAt(this.anchors, beat);
    const visible = pos !== null && pos.page === this.shown;
    this.cursor.hidden = !visible;
    if (!pos || !visible) return;
    this.cursor.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.top.toFixed(1)}px)`;
    this.cursor.style.height = `${pos.height.toFixed(1)}px`;
    if (this.layout === 'scroll' && !reviewing) {
      const moving = this.session.playing || Math.abs(beat - this.lastBeat) > 1e-4;
      if (moving) {
        const target = pos.x - this.host.clientWidth * 0.3;
        if (Math.abs(this.host.scrollLeft - target) > 0.5) this.host.scrollLeft = target;
      }
    }
    this.lastBeat = beat;
  }

  destroy(): void {
    this.strip.innerHTML = '';
    this.tk.destroy();
  }
}
