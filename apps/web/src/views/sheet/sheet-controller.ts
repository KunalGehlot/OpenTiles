// Draws the learner's own sheet (ADR 0018) and keeps it in step with the practice session: the bar
// being played is highlighted, a thin cursor moves through it, and the view scrolls by itself so
// that bar stays in sight. Plain DOM and canvas work from requestAnimationFrame; React only mounts
// the host (docs/architecture.md: timing-critical drawing bypasses React).
//
// Pages are drawn lazily, at the size shown and the device's pixel ratio, only near the visible
// part of the document; canvases far from it are freed, since an iPad holds little canvas memory.
import { measureIndexAt } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { SheetBar, SheetMap } from '@opentiles/sheet';
import type { PracticeSession } from '../session';
import type { PdfDocument, PdfPage } from './pdf';

/** The widest a page is drawn at the fitting zoom (CSS px); wider windows centre it. */
const MAX_PAGE_WIDTH = 1100;
const GAP = 12;
/** Pixels per page canvas at most: sharp on a 2× screen, and three of them fit an iPad's memory. */
const MAX_CANVAS_PIXELS = 8_000_000;
/** After the learner scrolls or zooms, the view leaves the scrolling to them for this long. */
const HANDS_OFF_MS = 2500;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

export interface SheetPageInfo {
  page: number;
  pageCount: number;
}

/** A point on a page, in PDF points from its top-left corner. */
export interface SheetPoint {
  page: number;
  x: number;
  y: number;
}

interface PageSlot {
  proxy: PdfPage;
  /** Size in points at scale 1. */
  width: number;
  height: number;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement | null;
  /** Scale the canvas was drawn at (CSS px per point), 0 when none. */
  drawnScale: number;
  task: { cancel(): void; promise: Promise<unknown> } | null;
  top: number;
  left: number;
}

export class SheetController {
  private readonly slots: PageSlot[] = [];
  private readonly sheet: HTMLDivElement;
  private readonly highlight: HTMLDivElement;
  private readonly cursor: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly outlines: HTMLDivElement;
  private readonly mark: HTMLDivElement;
  private markPoint: SheetPoint | null = null;
  private map: SheetMap | null = null;
  private zoom = 1;
  private scale = 1;
  private shownBar = -2;
  private shownLayout = '';
  private touchedAt = -Infinity;
  private drawing = false;
  private queued = false;
  private destroyed = false;
  private adjusting = false;
  private currentPage = -1;
  private tap: { id: number; x: number; y: number; at: number } | null = null;
  private readonly detach: () => void;
  /** Called when the page mostly in view changes. */
  onPage: (info: SheetPageInfo) => void = () => {};
  /** A tap on a page while adjusting the bars. */
  onAdjustTap: (point: SheetPoint) => void = () => {};

  private constructor(
    private readonly host: HTMLElement,
    proxies: PdfPage[],
    private readonly session: PracticeSession | null,
    private readonly song: Song | null,
  ) {
    this.sheet = document.createElement('div');
    this.sheet.className = 'ot-sheet-pages';
    this.highlight = document.createElement('div');
    this.highlight.className = 'ot-sheet-bar';
    this.highlight.dataset.testid = 'sheet-highlight';
    this.highlight.hidden = true;
    this.label = document.createElement('span');
    this.label.className = 'ot-sheet-bar__label';
    this.highlight.appendChild(this.label);
    this.cursor = document.createElement('div');
    this.cursor.className = 'ot-sheet-cursor';
    this.cursor.hidden = true;
    this.mark = document.createElement('div');
    this.mark.className = 'ot-sheet-mark';
    this.mark.hidden = true;
    this.outlines = document.createElement('div');
    this.outlines.className = 'ot-sheet-outlines';
    for (const proxy of proxies) {
      const viewport = proxy.getViewport({ scale: 1 });
      const element = document.createElement('div');
      element.className = 'ot-sheet-page';
      this.sheet.appendChild(element);
      this.slots.push({
        proxy,
        width: viewport.width,
        height: viewport.height,
        element,
        canvas: null,
        drawnScale: 0,
        task: null,
        top: 0,
        left: 0,
      });
    }
    this.sheet.append(this.outlines, this.highlight, this.cursor, this.mark);
    host.appendChild(this.sheet);
    this.detach = this.listen();
    this.layout();
  }

  static async create(
    host: HTMLElement,
    doc: PdfDocument,
    session: PracticeSession | null = null,
    song: Song | null = null,
  ): Promise<SheetController> {
    const proxies = await Promise.all(
      Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
    );
    return new SheetController(host, proxies, session, song);
  }

  get pageCount(): number {
    return this.slots.length;
  }

  get zoomLevel(): number {
    return this.zoom;
  }

  /** CSS pixels per PDF point as drawn now. */
  get scaleNow(): number {
    return this.scale;
  }

  setMap(map: SheetMap | null): void {
    this.map = map;
    this.shownBar = -2;
    this.shownLayout = '';
    this.drawOutlines();
  }

  setAdjusting(on: boolean): void {
    this.adjusting = on;
    if (!on) this.setMark(null);
    this.host.classList.toggle('adjusting', on);
    this.shownBar = -2;
    this.drawOutlines();
  }

  setZoom(zoom: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    if (Math.abs(next - this.zoom) < 1e-3) return;
    // Keep the middle of the view where it is.
    const middle =
      (this.host.scrollTop + this.host.clientHeight / 2) / Math.max(1, this.sheet.offsetHeight);
    this.zoom = next;
    this.touchedAt = performance.now();
    this.layout();
    this.host.scrollTop = middle * this.sheet.offsetHeight - this.host.clientHeight / 2;
  }

  /** Scrolls to the start of the next or previous page (page-turn pedal, page buttons). */
  turn(delta: number): void {
    const page = Math.min(this.slots.length - 1, Math.max(0, this.pageInView() + delta));
    const slot = this.slots[page];
    if (!slot) return;
    this.touchedAt = performance.now();
    this.scrollTo(slot.top - GAP, null);
  }

  /** Re-lays out the pages after the view was resized. */
  resize(): void {
    this.shownLayout = '';
    this.layout();
  }

  /** Positions the pages for the current width and zoom, and draws the ones in view. */
  private layout(): void {
    const available = Math.max(160, this.host.clientWidth - 2 * GAP);
    const widest = Math.max(1, ...this.slots.map((s) => s.width));
    this.scale = (Math.min(available, MAX_PAGE_WIDTH) / widest) * this.zoom;
    let top = GAP;
    let contentWidth = 0;
    for (const slot of this.slots) {
      const w = slot.width * this.scale;
      const h = slot.height * this.scale;
      slot.top = top;
      slot.left = Math.max(GAP, (this.host.clientWidth - w) / 2);
      slot.element.style.transform = `translate(${slot.left.toFixed(1)}px, ${top.toFixed(1)}px)`;
      slot.element.style.width = `${w.toFixed(1)}px`;
      slot.element.style.height = `${h.toFixed(1)}px`;
      top += h + GAP;
      contentWidth = Math.max(contentWidth, slot.left + w + GAP);
    }
    this.sheet.style.height = `${top.toFixed(0)}px`;
    this.sheet.style.width = `${Math.max(contentWidth, this.host.clientWidth).toFixed(0)}px`;
    this.shownBar = -2;
    this.drawOutlines();
    this.setMark(this.markPoint);
    this.schedule();
  }

  /** Point on a page under a client position, or null between pages. */
  pointAt(clientX: number, clientY: number): SheetPoint | null {
    const origin = this.sheet.getBoundingClientRect();
    const x = clientX - origin.left;
    const y = clientY - origin.top;
    for (let page = 0; page < this.slots.length; page++) {
      const slot = this.slots[page] as PageSlot;
      const w = slot.width * this.scale;
      const h = slot.height * this.scale;
      if (x >= slot.left && x <= slot.left + w && y >= slot.top && y <= slot.top + h) {
        return { page, x: (x - slot.left) / this.scale, y: (y - slot.top) / this.scale };
      }
    }
    return null;
  }

  /** The page most of the view shows. */
  private pageInView(): number {
    const line = this.host.scrollTop + this.host.clientHeight / 3;
    let page = 0;
    this.slots.forEach((slot, i) => {
      if (slot.top <= line) page = i;
    });
    return page;
  }

  /** Draws the pages near the view and frees the ones far from it. */
  private schedule(): void {
    if (this.queued || this.destroyed) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      void this.drawVisible();
    });
  }

  private async drawVisible(): Promise<void> {
    if (this.drawing || this.destroyed) return;
    this.drawing = true;
    try {
      const view = this.host.clientHeight;
      const from = this.host.scrollTop - view * 0.5;
      const to = this.host.scrollTop + view * 1.5;
      const near = (slot: PageSlot) =>
        slot.top + slot.height * this.scale >= from && slot.top <= to;
      const keep = (slot: PageSlot) =>
        slot.top + slot.height * this.scale >= from - view * 2 && slot.top <= to + view * 2;
      for (const slot of this.slots) if (!keep(slot)) this.free(slot);
      // The page in view first, then the ones before and after it.
      const order = this.slots
        .filter(near)
        .sort(
          (a, b) => Math.abs(a.top - this.host.scrollTop) - Math.abs(b.top - this.host.scrollTop),
        );
      for (const slot of order) {
        if (this.destroyed) return;
        if (Math.abs(slot.drawnScale - this.scale) > 1e-3) await this.draw(slot);
      }
    } finally {
      this.drawing = false;
    }
    // The view may have moved or been resized while drawing.
    const stale = this.slots.some(
      (s) =>
        s.top + s.height * this.scale >= this.host.scrollTop - this.host.clientHeight * 0.5 &&
        s.top <= this.host.scrollTop + this.host.clientHeight * 1.5 &&
        Math.abs(s.drawnScale - this.scale) > 1e-3,
    );
    if (stale) this.schedule();
  }

  private async draw(slot: PageSlot): Promise<void> {
    slot.task?.cancel();
    const scale = this.scale;
    const cssWidth = slot.width * scale;
    const cssHeight = slot.height * scale;
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, cssWidth * cssHeight)),
    );
    const viewport = slot.proxy.getViewport({ scale: scale * ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = 'ot-sheet-canvas';
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    const task = slot.proxy.render({
      canvas,
      canvasContext: context,
      viewport,
      background: '#ffffff',
    });
    slot.task = task;
    try {
      await task.promise;
    } catch {
      // Cancelled (resized, scrolled away) or a page pdf.js cannot draw: leave it blank.
      canvas.width = 0;
      canvas.height = 0;
      if (slot.task === task) slot.task = null;
      return;
    }
    if (slot.task === task) slot.task = null;
    if (this.destroyed) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }
    if (slot.canvas) {
      slot.canvas.width = 0;
      slot.canvas.height = 0;
      slot.canvas.remove();
    }
    slot.element.appendChild(canvas);
    slot.canvas = canvas;
    slot.drawnScale = scale;
  }

  private free(slot: PageSlot): void {
    slot.task?.cancel();
    slot.task = null;
    if (!slot.canvas) return;
    // Safari keeps a canvas's memory until it is shrunk.
    slot.canvas.width = 0;
    slot.canvas.height = 0;
    slot.canvas.remove();
    slot.canvas = null;
    slot.drawnScale = 0;
    slot.proxy.cleanup();
  }

  /** A bar's rectangle in the pages' coordinates (CSS px), with a little room around it. */
  private rectOf(
    bar: SheetBar,
  ): { left: number; top: number; width: number; height: number } | null {
    const slot = this.slots[bar.page];
    if (!slot) return null;
    const pad = Math.max(3, bar.box.height * this.scale * 0.08);
    return {
      left: slot.left + bar.box.x * this.scale,
      top: slot.top + bar.box.y * this.scale - pad,
      width: Math.max(2, bar.box.width * this.scale),
      height: bar.box.height * this.scale + 2 * pad,
    };
  }

  /** Outlines every bar found, numbered, while the learner adjusts them. */
  private drawOutlines(): void {
    this.outlines.replaceChildren();
    if (!this.adjusting || !this.map) return;
    this.map.layout.bars.forEach((bar, i) => {
      const rect = this.rectOf(bar);
      if (!rect) return;
      const outline = document.createElement('div');
      outline.className = 'ot-sheet-outline';
      outline.style.transform = `translate(${rect.left.toFixed(1)}px, ${rect.top.toFixed(1)}px)`;
      outline.style.width = `${rect.width.toFixed(1)}px`;
      outline.style.height = `${rect.height.toFixed(1)}px`;
      const n = document.createElement('span');
      n.textContent = String(i + 1);
      outline.appendChild(n);
      this.outlines.appendChild(outline);
    });
  }

  /** The measure the session is in, or -1. */
  private measureNow(): number {
    const song = this.song;
    const session = this.session;
    if (!song || !session || song.measures.length === 0) return -1;
    return measureIndexAt(song.measures, session.beat);
  }

  /** Called every animation frame. */
  frame(): void {
    const page = this.pageInView();
    if (page !== this.currentPage) {
      this.currentPage = page;
      this.onPage({ page: page + 1, pageCount: this.slots.length });
    }
    const map = this.map;
    const measureIndex = this.measureNow();
    const barIndex = map && measureIndex >= 0 ? (map.barOfMeasure[measureIndex] ?? -1) : -1;
    const bar = map?.layout.bars[barIndex];
    const layoutKey = `${this.scale}|${this.slots[0]?.left ?? 0}`;
    if (barIndex !== this.shownBar || layoutKey !== this.shownLayout) {
      const changed = barIndex !== this.shownBar;
      this.shownBar = barIndex;
      this.shownLayout = layoutKey;
      const rect = bar ? this.rectOf(bar) : null;
      this.highlight.hidden = !rect;
      if (rect) {
        this.highlight.style.transform = `translate(${rect.left.toFixed(1)}px, ${rect.top.toFixed(1)}px)`;
        this.highlight.style.width = `${rect.width.toFixed(1)}px`;
        this.highlight.style.height = `${rect.height.toFixed(1)}px`;
        this.label.textContent = this.song?.measures[measureIndex]?.number ?? '';
        this.highlight.dataset.bar = String(barIndex);
        if (changed) this.follow(rect);
      }
    }
    // The cursor glides through the bar from its first note to its end.
    const measure = this.song?.measures[measureIndex];
    const rect = bar ? this.rectOf(bar) : null;
    if (!bar || !rect || !measure || !this.session) {
      this.cursor.hidden = true;
      return;
    }
    const slot = this.slots[bar.page] as PageSlot;
    const start =
      bar.firstNoteX !== undefined
        ? Math.min(slot.left + bar.firstNoteX * this.scale, rect.left + rect.width / 2)
        : rect.left;
    const end = rect.left + rect.width;
    const along = Math.min(
      1,
      Math.max(0, (this.session.beat - measure.startBeat) / Math.max(1e-6, measure.lengthBeats)),
    );
    this.cursor.hidden = false;
    this.cursor.style.transform = `translate(${(start + (end - start) * along).toFixed(1)}px, ${rect.top.toFixed(1)}px)`;
    this.cursor.style.height = `${rect.height.toFixed(1)}px`;
  }

  /** Scrolls so a bar is in view, with what follows it below, unless the learner is scrolling. */
  private follow(rect: { left: number; top: number; width: number; height: number }): void {
    if (performance.now() - this.touchedAt < HANDS_OFF_MS) return;
    const { scrollTop, scrollLeft, clientHeight, clientWidth } = this.host;
    const margin = Math.min(48, clientHeight * 0.1);
    let top: number | null = null;
    let left: number | null = null;
    if (
      rect.top < scrollTop + margin ||
      rect.top + rect.height > scrollTop + clientHeight - margin
    ) {
      // The system near the top: the next ones show below it.
      top = rect.top - Math.min(clientHeight * 0.2, Math.max(0, clientHeight - rect.height) / 2);
    }
    if (rect.left < scrollLeft || rect.left + rect.width > scrollLeft + clientWidth) {
      left = rect.left - clientWidth * 0.25;
    }
    if (top !== null || left !== null) this.scrollTo(top, left);
  }

  private scrollTo(top: number | null, left: number | null): void {
    const reduced = document.documentElement.hasAttribute('data-reduced-motion');
    this.host.scrollTo({
      ...(top !== null ? { top: Math.max(0, top) } : {}),
      ...(left !== null ? { left: Math.max(0, left) } : {}),
      behavior: reduced ? 'auto' : 'smooth',
    });
  }

  /** Measure to go to for a tapped bar: its next playing from where the session is, else its first. */
  private measureForBar(bar: number): number {
    const map = this.map;
    if (!map) return -1;
    const now = this.measureNow();
    let first = -1;
    for (let i = 0; i < map.barOfMeasure.length; i++) {
      if (map.barOfMeasure[i] !== bar) continue;
      if (first < 0) first = i;
      if (i >= now) return i;
    }
    return first;
  }

  /** The bar at a point, with a little room above and below its staves, or -1. */
  barAt(point: SheetPoint): number {
    return (
      this.map?.layout.bars.findIndex(
        (b) =>
          b.page === point.page &&
          point.x >= b.box.x &&
          point.x <= b.box.x + b.box.width &&
          point.y >= b.box.y - b.box.height * 0.25 &&
          point.y <= b.box.y + b.box.height * 1.25,
      ) ?? -1
    );
  }

  /** Moves the session to a bar, as dragging the score does. */
  goToBar(bar: number): void {
    const measure = this.song?.measures[this.measureForBar(bar)];
    if (bar >= 0 && measure) this.session?.seek(measure.startBeat);
  }

  /** Marks where a barline would be added (a dashed line across the bar), or clears the mark. */
  setMark(point: SheetPoint | null): void {
    this.markPoint = point;
    const bar = point ? this.map?.layout.bars[this.barAt(point)] : undefined;
    const rect = bar ? this.rectOf(bar) : null;
    const slot = point ? this.slots[point.page] : undefined;
    this.mark.hidden = !rect || !slot || !point;
    if (!rect || !slot || !point) return;
    this.mark.style.transform = `translate(${(slot.left + point.x * this.scale).toFixed(1)}px, ${rect.top.toFixed(1)}px)`;
    this.mark.style.height = `${rect.height.toFixed(1)}px`;
  }

  private onTap(clientX: number, clientY: number): void {
    const point = this.pointAt(clientX, clientY);
    if (!point) return;
    if (this.adjusting) {
      this.onAdjustTap(point);
      return;
    }
    // A tap goes to that bar, as dragging the score does; not in the middle of a run.
    if (!this.session?.playing) this.goToBar(this.barAt(point));
  }

  private listen(): () => void {
    const host = this.host;
    const touched = () => {
      this.touchedAt = performance.now();
    };
    const scroll = () => this.schedule();
    const down = (e: PointerEvent) => {
      touched();
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp };
    };
    const up = (e: PointerEvent) => {
      const tap = this.tap;
      this.tap = null;
      if (!tap || tap.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8 || e.timeStamp - tap.at > 600)
        return;
      this.onTap(e.clientX, e.clientY);
    };
    const cancel = () => {
      this.tap = null;
    };
    host.addEventListener('scroll', scroll, { passive: true });
    host.addEventListener('wheel', touched, { passive: true });
    host.addEventListener('touchstart', touched, { passive: true });
    host.addEventListener('pointerdown', down);
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', cancel);
    return () => {
      host.removeEventListener('scroll', scroll);
      host.removeEventListener('wheel', touched);
      host.removeEventListener('touchstart', touched);
      host.removeEventListener('pointerdown', down);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', cancel);
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.detach();
    for (const slot of this.slots) this.free(slot);
    this.sheet.remove();
  }
}
