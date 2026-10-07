// Canvas 2D drawing of falling notes and the keyboard, 60 fps, outside React (spec §6).
import type { Song, SongNote } from '@opentiles/song-model';
import { BLACK_HEIGHT, keyAt, keyboardHeightFor, layoutKeyboard } from './keyboard';
import type { KeyboardLayout } from './keyboard';
import type { PracticeSession } from './session';

export interface Palette {
  background: string;
  grid: string;
  right: string;
  rightSoft: string;
  left: string;
  leftSoft: string;
  correct: string;
  wrong: string;
  missed: string;
  done: string;
  white: string;
  whiteEdge: string;
  black: string;
  nowLine: string;
  text: string;
}

export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--canvas-bg', '#f6f5f1'),
    grid: v('--canvas-grid', 'rgba(0,0,0,0.08)'),
    right: v('--hand-right', '#2f80c0'),
    rightSoft: v('--hand-right-soft', 'rgba(47,128,192,0.35)'),
    left: v('--hand-left', '#d07a2a'),
    leftSoft: v('--hand-left-soft', 'rgba(208,122,42,0.35)'),
    correct: v('--ok', '#2f9e5b'),
    wrong: v('--bad', '#d64545'),
    missed: v('--muted', '#9a9a9a'),
    done: v('--done', 'rgba(47,158,91,0.45)'),
    white: v('--key-white', '#ffffff'),
    whiteEdge: v('--key-edge', '#c8c6c0'),
    black: v('--key-black', '#222222'),
    nowLine: v('--now-line', 'rgba(0,0,0,0.35)'),
    text: v('--text', '#222'),
  };
}

export interface RenderOptions {
  /** Beats visible above the now-line. */
  lookahead: number;
  showNoteNames: boolean;
}

export class PracticeRenderer {
  layout: KeyboardLayout;
  private width = 0;
  private height = 0;
  private dpr = 1;
  palette: Palette;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly range: { low: number; high: number },
    readonly options: RenderOptions = { lookahead: 6, showNoteNames: false },
  ) {
    this.palette = readPalette(canvas);
    this.layout = layoutKeyboard(range.low, range.high, 1);
  }

  get keyboardHeight(): number {
    return keyboardHeightFor(this.height, this.layout.whiteWidth);
  }

  get keyboardTop(): number {
    return this.height - this.keyboardHeight;
  }

  resize(width: number, height: number, dpr = window.devicePixelRatio || 1): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.layout = layoutKeyboard(this.range.low, this.range.high, width);
    this.palette = readPalette(this.canvas);
  }

  draw(session: PracticeSession, now: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || this.width === 0) return;
    const p = this.palette;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, this.width, this.height);

    const top = this.keyboardTop;
    const pxPerBeat = top / this.options.lookahead;
    const beat = session.beat;
    const yOf = (b: number) => top - (b - beat) * pxPerBeat;

    this.drawGrid(ctx, session.song, yOf, top);
    const current = new Set(
      session.mode === 'wait' ? (session.wait.current?.notes ?? []).map((n) => n.id) : [],
    );
    for (const n of session.song.notes) {
      const y0 = yOf(n.startBeat);
      const y1 = yOf(n.startBeat + n.durationBeats);
      if (y1 > top || y0 < -10) continue;
      this.drawNote(ctx, n, y1, y0, session, current.has(n.id));
    }
    // Now-line.
    ctx.fillStyle = p.nowLine;
    ctx.fillRect(0, top - 2, this.width, 2);
    this.drawKeyboard(ctx, session, now, top);
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    song: Song,
    yOf: (b: number) => number,
    top: number,
  ): void {
    ctx.fillStyle = this.palette.grid;
    for (const m of song.measures) {
      const y = yOf(m.startBeat);
      if (y < 0 || y > top) continue;
      ctx.fillRect(0, y, this.width, 1);
    }
    // Faint lanes at every C and F to help find keys.
    for (const k of this.layout.keys) {
      if (k.black || (k.pitch % 12 !== 0 && k.pitch % 12 !== 5)) continue;
      ctx.fillRect(k.x, 0, 1, top);
    }
  }

  private drawNote(
    ctx: CanvasRenderingContext2D,
    n: SongNote,
    yTop: number,
    yBottom: number,
    session: PracticeSession,
    isCurrent: boolean,
  ): void {
    const key = keyAt(this.layout, n.pitch);
    if (!key) return;
    const p = this.palette;
    const practised = session.inHands(n);
    const pad = Math.max(1, key.width * 0.08);
    const x = key.x + pad;
    const w = key.width - pad * 2;
    const h = Math.max(4, yBottom - yTop - 2);
    let fill = n.hand === 'right' ? p.right : p.left;
    if (!practised) fill = n.hand === 'right' ? p.rightSoft : p.leftSoft;
    if (session.done.has(n.id)) fill = p.done;
    ctx.fillStyle = fill;
    roundRect(ctx, x, yTop + 1, w, h, Math.min(6, w / 3));
    ctx.fill();
    if (isCurrent && !session.done.has(n.id)) {
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (n.fingering && w > 12) {
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${Math.min(14, w * 0.6)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(n.fingering), x + w / 2, yTop + h - 4);
    }
  }

  private drawKeyboard(
    ctx: CanvasRenderingContext2D,
    session: PracticeSession,
    now: number,
    top: number,
  ): void {
    const p = this.palette;
    const height = this.keyboardHeight;
    const expected = new Set(session.expected());
    const handOf = new Map<number, 'left' | 'right'>();
    if (session.mode === 'wait') {
      for (const n of session.wait.current?.notes ?? []) handOf.set(n.pitch, n.hand);
    }
    const flashOf = new Map<number, string>();
    for (const f of session.flashes) {
      if (f.until > now)
        flashOf.set(
          f.pitch,
          f.kind === 'correct' ? p.correct : f.kind === 'wrong' ? p.wrong : p.missed,
        );
    }
    const colourFor = (pitch: number, base: string) => {
      const flash = flashOf.get(pitch);
      if (flash) return flash;
      if (session.keys.has(pitch)) return session.keys.get(pitch) === 'wrong' ? p.wrong : p.missed;
      if (expected.has(pitch)) return handOf.get(pitch) === 'left' ? p.left : p.right;
      return base;
    };
    for (const k of this.layout.keys) {
      if (k.black) continue;
      ctx.fillStyle = colourFor(k.pitch, p.white);
      ctx.fillRect(k.x, top, k.width, height);
      ctx.fillStyle = p.whiteEdge;
      ctx.fillRect(k.x + k.width - 1, top, 1, height);
      if (k.pitch % 12 === 0) {
        ctx.fillStyle = p.missed;
        ctx.font = `${Math.max(9, Math.min(12, k.width * 0.45))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(`C${Math.floor(k.pitch / 12) - 1}`, k.x + k.width / 2, top + height - 6);
      }
    }
    const bh = height * BLACK_HEIGHT;
    for (const k of this.layout.keys) {
      if (!k.black) continue;
      ctx.fillStyle = colourFor(k.pitch, p.black);
      roundRect(ctx, k.x, top, k.width, bh, 2);
      ctx.fill();
    }
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
