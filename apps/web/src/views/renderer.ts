// Canvas 2D drawing of falling notes and the keyboard, 60 fps, outside React (spec §6).
//
// P4-10: notes are tiles (an outline and a lit leading edge), bars are numbered, the black keys'
// lanes are shaded, the keyboard has a shadow under its top edge and glossy black keys, finger
// numbers are large, and a played key blooms for a third of a second. Everything is flat fills and
// a few gradients built once per resize: no shadowBlur, no gradient per note, and the font is set
// only when it changes (WebKit looks the font up on every assignment). Built to stay cheap on an
// older iPad; frame time on a device has not been measured yet. A highlighted key stays one flat
// token colour down to its bottom row (the Playwright probe in e2e/layout.spec.ts finds it there).
import type { Song, SongNote } from '@opentiles/song-model';
import { isDark, parseColour, rgba } from './colour';
import type { Rgb } from './colour';
import { BLACK_HEIGHT, keyAt, keyboardHeightFor, practiceLayout } from './keyboard';
import type { KeyboardLayout, KeyRect, KeysToDraw } from './keyboard';
import type { PracticeSession } from './session';
import { appSettings, effectiveSettings, labelScale } from '../settings/store';
import { t } from '../i18n';
import { noteLabel, pitchClassName, spellingFor } from '../lib/notes';
import type { Spelling } from '../lib/notes';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
/** How long a played key blooms (seconds); the session keeps its flashes this long. */
const BLOOM_SECONDS = 0.35;
/** How long a struck key takes to come back up (seconds): long enough to see, short enough for trills. */
const STRIKE_SECONDS = 0.16;

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
  accent: string;
  /** Marks drawn on a hand colour: finger numbers and the early/late labels. */
  onHand: string;
  /** Early or late: the right note at the wrong moment (P1-24). */
  timing: string;
  loopBand: string;
  loopEdge: string;
  /** Octave labels on the white keys: the black keys' colour, softened. */
  keyLabel: string;
  /** A note tile's outline, and the lit strip along its leading edge. */
  edge: string;
  shine: string;
  /** The soft halo behind the notes to play now, per hand. */
  rightGlow: string;
  leftGlow: string;
  /** The wash above the now-line, the shadow under the keyboard's top edge, the black keys' gloss. */
  nowGlow: string;
  keybed: string;
  blackShine: string;
  /** Hit bloom colours as plain channels, so the opacity can change every frame. */
  bloom: { correct: Rgb; wrong: Rgb; timing: Rgb };
  dark: boolean;
}

export function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const channels = (value: string, fallback: Rgb): Rgb => parseColour(value)?.rgb ?? fallback;
  const background = v('--canvas-bg', '#eef2f0');
  const right = v('--hand-right', '#2b78b8');
  const left = v('--hand-left', '#b45a1c');
  const correct = v('--ok', '#1d7a44');
  const wrong = v('--bad', '#bd3426');
  const timing = v('--warn', '#8f5509');
  const dark = isDark(channels(background, [238, 242, 240]));
  return {
    background,
    grid: v('--canvas-grid', 'rgba(19,26,24,0.07)'),
    right,
    rightSoft: v('--hand-right-soft', 'rgba(43,120,184,0.3)'),
    left,
    leftSoft: v('--hand-left-soft', 'rgba(180,90,28,0.3)'),
    correct,
    wrong,
    missed: v('--muted', '#54615d'),
    done: v('--done', 'rgba(29,122,68,0.45)'),
    white: v('--key-white', '#ffffff'),
    whiteEdge: v('--key-edge', '#c9d1ce'),
    black: v('--key-black', '#1c2321'),
    nowLine: v('--now-line', 'rgba(19,26,24,0.55)'),
    text: v('--text', '#131a18'),
    accent: v('--accent', '#1f6f5c'),
    onHand: v('--on-hand', '#ffffff'),
    timing,
    loopBand: v('--loop-band', 'rgba(31,111,92,0.1)'),
    loopEdge: v('--accent', '#1f6f5c'),
    keyLabel: rgba(channels(v('--key-black', '#1c2321'), [28, 35, 33]), 0.7),
    edge: dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.22)',
    shine: dark ? 'rgba(255, 255, 255, 0.34)' : 'rgba(255, 255, 255, 0.4)',
    rightGlow: rgba(channels(right, [43, 120, 184]), 0.3),
    leftGlow: rgba(channels(left, [180, 90, 28]), 0.3),
    nowGlow: dark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.05)',
    keybed: dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.3)',
    blackShine: 'rgba(255, 255, 255, 0.1)',
    bloom: {
      correct: channels(correct, [29, 122, 68]),
      wrong: channels(wrong, [189, 52, 38]),
      timing: channels(timing, [143, 85, 9]),
    },
    dark,
  };
}

/** The key of `PracticeRenderer.spelledNames`: a beat (to the thousandth) and a pitch class. */
export const spellKey = (beat: number, pitch: number): string =>
  `${Math.round(beat * 1000)}:${((Math.round(pitch) % 12) + 12) % 12}`;

export interface RenderOptions {
  /** Beats visible above the now-line. */
  lookahead: number;
  showNoteNames: boolean;
}

export class PracticeRenderer {
  layout: KeyboardLayout;
  /** Bars being selected by a drag, drawn as a dashed band until the pointer is released. */
  preview: { fromBeat: number; toBeat: number } | null = null;
  /** Chord names to draw on the falling bars of a chord drill, by the beat they start on (P7-06). */
  chordLabels: readonly { beat: number; text: string }[] = [];
  /**
   * A chord drill's notes named as its chords spell them (D♭ F A♭, not C♯ F G♯), by `spellKey`:
   * the beat and the pitch class, so a piece moved by octaves to fit the keyboard keeps them.
   */
  spelledNames: ReadonlyMap<string, string> | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  palette: Palette;
  /** Built once per size, not per frame. */
  private glow: CanvasGradient | null = null;
  private glowTop = 0;
  private keybed: CanvasGradient | null = null;
  /** Read once per frame: Large print scales labels, Reduce motion switches the bloom off. */
  private scale = 1;
  /** Per frame: show note names, and spell black keys as the key or the learner chose (P5-04). */
  private noteNames = true;
  private spelling: Spelling = 'sharps';
  private calm = false;
  /** The font last set on the context; resizing the canvas resets it. */
  private font = '';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private keys: KeysToDraw,
    readonly options: RenderOptions = { lookahead: 6, showNoteNames: false },
  ) {
    this.palette = readPalette(canvas);
    this.layout = this.layoutAt(1);
  }

  get keyboardHeight(): number {
    return keyboardHeightFor(this.height, this.layout.whiteWidth);
  }

  get keyboardTop(): number {
    return this.height - this.keyboardHeight;
  }

  /** The beat drawn at canvas height `y` (CSS pixels) while `nowBeat` is at the now-line. */
  beatAtY(y: number, nowBeat: number): number {
    const top = this.keyboardTop;
    const pxPerBeat = top / this.options.lookahead;
    return nowBeat + (top - y) / pxPerBeat;
  }

  /** Draws other keys: the learner's own keyboard, or the keys a piece needs (P4-07). */
  setRange(keys: KeysToDraw): void {
    // "Fit piece" can ask for the same keys as a preset (C3–C5 is both), but only it may widen.
    const k = this.keys;
    if (keys.low === k.low && keys.high === k.high && keys.fixed === k.fixed) return;
    this.keys = keys;
    this.layout = this.layoutAt(this.width);
    this.buildGradients();
  }

  /** The keyboard at `width`; the canvas carries the drawn keys for the end-to-end tests. */
  private layoutAt(width: number): KeyboardLayout {
    const layout = practiceLayout(this.keys, width);
    this.canvas.dataset.drawn = `${layout.low}-${layout.high}`;
    return layout;
  }

  resize(width: number, height: number, dpr = window.devicePixelRatio || 1): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.font = '';
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.layout = this.layoutAt(width);
    this.palette = readPalette(this.canvas);
    this.buildGradients();
  }

  /** The glow above the now-line and the shadow below the keyboard's top edge. */
  private buildGradients(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || this.width === 0) return;
    const p = this.palette;
    const top = this.keyboardTop;
    const glowHeight = Math.min(top * 0.35, 140);
    this.glowTop = top - glowHeight;
    const glow = ctx.createLinearGradient(0, this.glowTop, 0, top);
    glow.addColorStop(0, 'rgba(0, 0, 0, 0)');
    glow.addColorStop(1, p.nowGlow);
    this.glow = glow;
    const keybed = ctx.createLinearGradient(0, top, 0, top + 9);
    keybed.addColorStop(0, p.keybed);
    keybed.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this.keybed = keybed;
  }

  draw(session: PracticeSession, now: number): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || this.width === 0) return;
    const p = this.palette;
    this.scale = labelScale();
    this.calm = effectiveSettings().reducedMotion;
    this.noteNames = appSettings().noteNames;
    this.spelling = spellingFor(
      appSettings().noteSpelling,
      session.song.keySignatures[0]?.fifths ?? 0,
    );
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, this.width, this.height);

    const top = this.keyboardTop;
    const pxPerBeat = top / this.options.lookahead;
    const beat = session.beat;
    const yOf = (b: number) => top - (b - beat) * pxPerBeat;

    this.drawGrid(ctx, session.song, yOf, top);
    if (this.glow) {
      ctx.fillStyle = this.glow;
      ctx.fillRect(0, this.glowTop, this.width, top - this.glowTop);
    }
    const loop = session.loopSpan;
    if (loop) this.drawBand(ctx, yOf(loop.fromBeat), yOf(loop.toBeat), top, false);
    if (this.preview) {
      this.drawBand(ctx, yOf(this.preview.fromBeat), yOf(this.preview.toBeat), top, true);
    }
    const current = new Set(
      session.mode === 'wait' ? (session.wait.current?.notes ?? []).map((n) => n.id) : [],
    );
    // A sight-reading drill shows no falling notes: the score is what is read (P5-05).
    if (session.guide === 'full') {
      for (const n of session.song.notes) {
        const y0 = yOf(n.startBeat);
        const y1 = yOf(n.startBeat + n.durationBeats);
        if (y1 > top || y0 < -10) continue;
        this.drawNote(ctx, n, y1, y0, session, current.has(n.id));
      }
      if (this.chordLabels.length > 0) this.drawChordLabels(ctx, session, yOf, top);
    }
    // Now-line.
    ctx.fillStyle = p.nowLine;
    ctx.fillRect(0, top - 2, this.width, 2);
    this.drawKeyboard(ctx, session, now, top);
    this.drawBlooms(ctx, session, now, top);
    this.drawLabels(ctx, session, now, top);
    this.drawProgress(ctx, session);
  }

  /** A note's name: as a chord drill spells it, or by the piece's key (P5-04). */
  private nameOf(pitch: number, beat?: number): string {
    const spelled = beat === undefined ? undefined : this.spelledNames?.get(spellKey(beat, pitch));
    return spelled ?? pitchClassName(pitch, this.spelling);
  }

  /** Sets the font only when it differs from the last one; sizes snap to half pixels. */
  private setFont(ctx: CanvasRenderingContext2D, weight: number, size: number): void {
    const next = `${weight} ${Math.round(size * 2) / 2}px ${FONT}`;
    if (next === this.font) return;
    ctx.font = next;
    this.font = next;
  }

  /** Size of a finger number on a key (P4-08). */
  private fingerSize(k: KeyRect): number {
    return Math.min(Math.max(k.width * 0.55, 12), 24) * this.scale;
  }

  /**
   * Sets a font for `text` no larger than `size` that fits `width`, or returns false when even 8 px
   * would not fit ("Sol♯" on a narrow black key).
   */
  private fitFont(
    ctx: CanvasRenderingContext2D,
    text: string,
    weight: number,
    size: number,
    width: number,
  ): boolean {
    this.setFont(ctx, weight, size);
    const measured = ctx.measureText(text).width;
    if (measured <= width) return true;
    const smaller = (size * width) / measured;
    if (smaller < 8) return false;
    this.setFont(ctx, weight, smaller);
    return true;
  }

  /** How far through the piece the now-line is: a hairline along the top of the canvas. */
  private drawProgress(ctx: CanvasRenderingContext2D, session: PracticeSession): void {
    const length = session.song.lengthBeats;
    if (length <= 0) return;
    const p = this.palette;
    ctx.fillStyle = p.grid;
    ctx.fillRect(0, 0, this.width, 2);
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, 0, this.width * Math.min(1, Math.max(0, session.beat / length)), 2);
  }

  /** The looped bars: a tinted band with solid edges (dashed while still being dragged). */
  private drawBand(
    ctx: CanvasRenderingContext2D,
    yStart: number,
    yEnd: number,
    top: number,
    dashed: boolean,
  ): void {
    const y0 = Math.max(0, Math.min(yStart, yEnd));
    const y1 = Math.min(top, Math.max(yStart, yEnd));
    if (y1 <= 0 || y0 >= top) return;
    const p = this.palette;
    ctx.fillStyle = p.loopBand;
    ctx.fillRect(0, y0, this.width, y1 - y0);
    ctx.strokeStyle = p.loopEdge;
    ctx.lineWidth = 2;
    ctx.setLineDash(dashed ? [6, 4] : []);
    ctx.beginPath();
    for (const y of [yStart, yEnd]) {
      if (y < 0 || y > top) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(this.width, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * A chord drill's names (P7-06): a label over each chord's falling bars, just above their lower
   * end, so it reaches the keyboard with the chord and can be read as it lands.
   */
  private drawChordLabels(
    ctx: CanvasRenderingContext2D,
    session: PracticeSession,
    yOf: (b: number) => number,
    top: number,
  ): void {
    const p = this.palette;
    const size = 15 * this.scale;
    const drawn: string[] = [];
    this.setFont(ctx, 700, size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const label of this.chordLabels) {
      const y0 = yOf(label.beat);
      if (y0 < 0 || y0 > top + 1) continue;
      let left = Infinity;
      let right = -Infinity;
      // Over the right hand's notes when both hands play: the left hand's root is far below.
      const notes = session.song.notes.filter(
        (n) => Math.abs(n.startBeat - label.beat) < 1e-3 && session.inHands(n),
      );
      const upper = notes.some((n) => n.hand === 'right')
        ? notes.filter((n) => n.hand === 'right')
        : notes;
      for (const n of upper) {
        const key = keyAt(this.layout, n.pitch);
        if (!key) continue;
        left = Math.min(left, key.x);
        right = Math.max(right, key.x + key.width);
      }
      if (!Number.isFinite(left)) continue;
      const w = ctx.measureText(label.text).width + 16 * this.scale;
      const h = size + 10 * this.scale;
      const cx = Math.min(this.width - w / 2, Math.max(w / 2, (left + right) / 2));
      const cy = Math.max(h / 2, y0 - h / 2 - 6 * this.scale);
      ctx.fillStyle = p.background;
      ctx.globalAlpha = 0.9;
      roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = p.text;
      ctx.fillText(label.text, cx, cy + 0.5);
      drawn.push(label.text);
    }
    ctx.textBaseline = 'alphabetic';
    // The names on screen, for the end-to-end tests (as `data-drawn` carries the keys).
    const names = drawn.join(' ');
    if (this.canvas.dataset.chords !== names) this.canvas.dataset.chords = names;
  }

  /** "early" / "late" just above the key that was played off the beat (P1-24). */
  private drawLabels(
    ctx: CanvasRenderingContext2D,
    session: PracticeSession,
    now: number,
    top: number,
  ): void {
    if (session.labels.length === 0) return;
    const p = this.palette;
    this.setFont(ctx, 600, 12 * this.scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of session.labels) {
      const key = keyAt(this.layout, l.pitch);
      if (!key || l.until <= now) continue;
      const text = labelText(l.kind);
      const w = ctx.measureText(text).width + 12;
      const cx = Math.min(this.width - w / 2, Math.max(w / 2, key.x + key.width / 2));
      // Early labels sit a little higher than late ones, so the direction reads at a glance;
      // hold feedback sits above both.
      const cy = top - (l.kind === 'early' ? 32 : l.kind === 'late' ? 17 : 47) * this.scale;
      ctx.globalAlpha = Math.min(1, (l.until - now) / 0.3);
      ctx.fillStyle = p.timing;
      roundRect(ctx, cx - w / 2, cy - 9 * this.scale, w, 18 * this.scale, 9 * this.scale);
      ctx.fill();
      ctx.fillStyle = p.onHand;
      ctx.fillText(text, cx, cy + 0.5);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = 'alphabetic';
  }

  /**
   * Hold gauges (P4-09): a held key stays lit in its hand's colour and drains from the top as the
   * note's written length runs out, so an empty key means "you can let go". A good hold turns
   * green; one too short or too long turns amber; then the gauge fades.
   */
  private drawHold(
    ctx: CanvasRenderingContext2D,
    key: KeyRect,
    session: PracticeSession,
    now: number,
    top: number,
    height: number,
  ): void {
    const h = session.holds.get(key.pitch);
    if (!h) return;
    const p = this.palette;
    const fade = h.end === undefined ? 1 : Math.max(0, 1 - (now - h.end) / 0.4);
    if (fade <= 0) return;
    const until = h.end ?? now;
    const left = h.length > 0 ? Math.max(0, 1 - (until - h.start) / h.length) : 0;
    const judged = h.judgement !== undefined;
    const colour =
      h.judgement === 'good'
        ? p.correct
        : judged
          ? p.timing
          : h.hand === 'right'
            ? p.right
            : p.left;
    // A good hold still going shows as a full green key; otherwise what is left of the note.
    const level =
      h.judgement === 'good' && h.end === undefined ? 1 : judged ? Math.max(left, 0.15) : left;
    if (level <= 0) return;
    const inset = key.black ? 1 : 2;
    const fh = (height - inset * 2) * level;
    ctx.globalAlpha = fade * (judged ? 0.75 : 0.9);
    ctx.fillStyle = colour;
    roundRect(ctx, key.x + inset, top + height - inset - fh, key.width - inset * 2 - 1, fh, 3);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /**
   * A struck key dips: it darkens and the keybed's shadow falls deeper across its top, then it comes
   * back up. So a repeated note reads as a new press even while the key stays lit. Nothing moves,
   * so it stays on under Reduce motion.
   */
  private drawStrike(
    ctx: CanvasRenderingContext2D,
    key: KeyRect,
    session: PracticeSession,
    now: number,
    top: number,
    height: number,
  ): void {
    const at = session.strikes.get(key.pitch);
    if (at === undefined) return;
    const k = (now - at) / STRIKE_SECONDS;
    if (k < 0 || k >= 1) return;
    // Down at once, back up gently.
    const depth = (1 - k) * (1 - k);
    const width = key.black ? key.width : key.width - 1;
    ctx.fillStyle = `rgba(0, 0, 0, ${(0.24 * depth).toFixed(3)})`;
    if (key.black) {
      roundRect(ctx, key.x, top, width, height, 3);
      ctx.fill();
    } else ctx.fillRect(key.x, top, width, height);
    const shade = Math.min(height * 0.3, 18);
    const g = ctx.createLinearGradient(0, top, 0, top + shade);
    g.addColorStop(0, `rgba(0, 0, 0, ${(0.4 * depth).toFixed(3)})`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(key.x, top, width, shade);
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    song: Song,
    yOf: (b: number) => number,
    top: number,
  ): void {
    const p = this.palette;
    // The lanes of the black keys, shaded, so the keyboard's shape runs up the screen.
    ctx.fillStyle = p.grid;
    ctx.globalAlpha = 0.4;
    for (const k of this.layout.keys) if (k.black) ctx.fillRect(k.x, 0, k.width, top);
    ctx.globalAlpha = 1;
    // A faint guide at every C and F to help find keys.
    for (const k of this.layout.keys) {
      if (k.black || (k.pitch % 12 !== 0 && k.pitch % 12 !== 5)) continue;
      ctx.fillRect(k.x, 0, 1, top);
    }
    // Bar lines, each with its number on the left edge.
    this.setFont(ctx, 600, 11 * this.scale);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (const m of song.measures) {
      const y = yOf(m.startBeat);
      if (y < 0 || y > top) continue;
      ctx.fillStyle = p.grid;
      ctx.fillRect(0, y, this.width, 1);
      if (y > 14 && y < top - 4 * this.scale) {
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = p.missed;
        ctx.fillText(m.number, 6, y + 3);
        ctx.globalAlpha = 1;
      }
    }
    ctx.textBaseline = 'alphabetic';
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
    const y = yTop + 1;
    const h = Math.max(4, yBottom - yTop - 2);
    const radius = Math.min(7, w * 0.3, h / 2);
    const isDone = session.done.has(n.id);
    let fill = n.hand === 'right' ? p.right : p.left;
    if (!practised) fill = n.hand === 'right' ? p.rightSoft : p.leftSoft;
    const judgement = session.judged.get(n.id);
    // An early or late note keeps its hand colour (a played right-hand note stays blue); only a
    // thin edge in the timing colour says it was off the beat. Filling it amber turned nearly
    // every played note orange.
    const offBeat = judgement === 'early' || judgement === 'late';
    if (judgement === 'missed') fill = p.missed;
    else if (isDone) fill = p.done;
    // The notes to play now glow, so the eye finds them among the ones still falling.
    if (isCurrent && !isDone) {
      ctx.fillStyle = n.hand === 'right' ? p.rightGlow : p.leftGlow;
      roundRect(ctx, x - 3, y - 3, w + 6, h + 6, radius + 3);
      ctx.fill();
    }
    ctx.fillStyle = fill;
    roundRect(ctx, x, y, w, h, radius);
    ctx.fill();
    if (practised && !isDone) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = p.edge;
      ctx.stroke();
      // The leading edge, which reaches the keys first, is lit.
      if (h > 12 && w > 6) {
        ctx.fillStyle = p.shine;
        roundRect(ctx, x + 1.5, y + h - 5, w - 3, 3.5, 1.75);
        ctx.fill();
      }
    }
    if (offBeat && !isDone) {
      ctx.strokeStyle = p.timing;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, h, radius);
      ctx.stroke();
    }
    if (isCurrent && !isDone) {
      ctx.strokeStyle = p.text;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, h, radius);
      ctx.stroke();
    }
    if (practised && !isDone && w >= 13 && this.noteNames) {
      // The name sits at the top (the far edge), the finger at the bottom; both only when the tile
      // is tall enough that they do not touch.
      const size = Math.min(Math.max(w * 0.42, 10), 17) * this.scale;
      const fingerRoom = n.fingering ? Math.min(Math.max(w * 0.5, 11), 22) * this.scale + 6 : 0;
      if (h >= size + 8 + fingerRoom) {
        ctx.fillStyle = p.onHand;
        this.setFont(ctx, 600, Math.min(size, w * 0.62));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.nameOf(n.pitch, n.startBeat), x + w / 2, y + size * 0.5 + 5);
        ctx.textBaseline = 'alphabetic';
      }
    }
    if (n.fingering && practised && !isDone && w >= 13) {
      const size = Math.min(Math.max(w * 0.5, 11), 22) * this.scale;
      if (h >= size + 4) {
        ctx.fillStyle = p.onHand;
        this.setFont(ctx, 700, Math.min(size, w * 0.85));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n.fingering), x + w / 2, y + h - Math.min(h / 2, size * 0.5 + 6));
        ctx.textBaseline = 'alphabetic';
      }
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
    const expectedNotes = session.litNotes();
    const expected = new Set(expectedNotes.map((n) => n.pitch));
    const handOf = new Map<number, 'left' | 'right'>();
    // Fingers on the keys to play next (P4-08); the song carries them only when they are shown.
    const fingerOf = new Map<number, number>();
    const beatOf = new Map<number, number>();
    for (const n of expectedNotes) {
      handOf.set(n.pitch, n.hand);
      beatOf.set(n.pitch, n.startBeat);
      if (n.fingering !== undefined) fingerOf.set(n.pitch, n.fingering);
    }
    const flashOf = new Map<number, string>();
    for (const f of session.flashes) {
      if (f.until > now)
        flashOf.set(
          f.pitch,
          f.kind === 'correct'
            ? p.correct
            : f.kind === 'wrong'
              ? p.wrong
              : f.kind === 'missed'
                ? p.missed
                : p.timing,
        );
    }
    const colourFor = (pitch: number, base: string) => {
      const flash = flashOf.get(pitch);
      if (flash) return flash;
      if (session.keys.has(pitch)) return session.keys.get(pitch) === 'wrong' ? p.wrong : p.missed;
      if (expected.has(pitch)) return handOf.get(pitch) === 'left' ? p.left : p.right;
      return base;
    };
    const bh = height * BLACK_HEIGHT;
    for (const k of this.layout.keys) {
      if (k.black) continue;
      ctx.fillStyle = colourFor(k.pitch, p.white);
      ctx.fillRect(k.x, top, k.width, height);
      ctx.fillStyle = p.whiteEdge;
      ctx.fillRect(k.x + k.width - 1, top, 1, height);
      this.drawHold(ctx, k, session, now, top, height);
      this.drawStrike(ctx, k, session, now, top, height);
      const baseline = top + height - 6;
      ctx.textAlign = 'center';
      if (this.noteNames && expected.has(k.pitch)) {
        // The key to play is named at its front edge, below its finger when there is room (P5-03).
        const name = this.nameOf(k.pitch, beatOf.get(k.pitch));
        const size = Math.min(Math.max(k.width * 0.42, 10), 15) * this.scale;
        const finger = fingerOf.has(k.pitch)
          ? top + bh + (height - bh) * 0.4 + this.fingerSize(k) / 2 + 2
          : top + bh;
        if (baseline - size * 0.75 >= finger && this.fitFont(ctx, name, 600, size, k.width - 3)) {
          ctx.fillStyle = p.onHand;
          ctx.fillText(name, k.x + k.width / 2, baseline);
        }
      } else if (k.pitch % 12 === 0) {
        // Large print (P2-15) makes the octave labels bigger, as far as the key allows.
        const label = noteLabel(k.pitch);
        const scale = this.scale;
        if (this.fitFont(ctx, label, scale > 1 ? 600 : 500, 12 * scale, k.width - 2)) {
          ctx.fillStyle = p.keyLabel;
          ctx.fillText(label, k.x + k.width / 2, baseline);
        }
      }
    }
    // The shadow the keybed's top edge casts on the keys.
    if (this.keybed) {
      ctx.fillStyle = this.keybed;
      ctx.fillRect(0, top, this.width, 9);
    }
    for (const k of this.layout.keys) {
      if (!k.black) continue;
      const colour = colourFor(k.pitch, p.black);
      ctx.fillStyle = colour;
      roundRect(ctx, k.x, top, k.width, bh, 3);
      ctx.fill();
      if (colour === p.black && k.width > 6) {
        // The glossy face of an unplayed black key.
        ctx.fillStyle = p.blackShine;
        roundRect(ctx, k.x + 2, top + 1, k.width - 4, bh - 7, 2);
        ctx.fill();
      }
      this.drawHold(ctx, k, session, now, top, bh);
      this.drawStrike(ctx, k, session, now, top, bh);
      if (this.noteNames && expected.has(k.pitch)) {
        // Above the finger, which sits near the front edge; only where the name fits the key.
        const name = this.nameOf(k.pitch, beatOf.get(k.pitch));
        const size = Math.min(Math.max(k.width * 0.5, 9), 13) * this.scale;
        if (bh >= 60 && this.fitFont(ctx, name, 600, size, k.width - 2)) {
          ctx.fillStyle = p.onHand;
          ctx.textAlign = 'center';
          ctx.fillText(name, k.x + k.width / 2, top + bh * 0.42);
        }
      }
    }
    if (fingerOf.size === 0) return;
    ctx.fillStyle = p.onHand;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const k of this.layout.keys) {
      const finger = fingerOf.get(k.pitch);
      if (finger === undefined || k.width < 8) continue;
      const size = this.fingerSize(k);
      this.setFont(ctx, 700, Math.min(size, k.width * 0.85));
      // White keys: in the part below the black keys; black keys: near their front edge.
      const y = k.black ? top + bh * 0.72 : top + bh + (height - bh) * 0.4;
      ctx.fillText(String(finger), k.x + k.width / 2, y);
    }
    ctx.textBaseline = 'alphabetic';
  }

  /** A played key blooms for a moment, so a hit is felt as well as seen. Off under Reduce motion. */
  private drawBlooms(
    ctx: CanvasRenderingContext2D,
    session: PracticeSession,
    now: number,
    top: number,
  ): void {
    if (this.calm) return;
    for (const f of session.flashes) {
      if (f.kind === 'missed') continue;
      const life = (f.until - now) / BLOOM_SECONDS;
      if (life <= 0 || life > 1) continue;
      const key = keyAt(this.layout, f.pitch);
      if (!key) continue;
      const channels =
        f.kind === 'correct'
          ? this.palette.bloom.correct
          : f.kind === 'wrong'
            ? this.palette.bloom.wrong
            : this.palette.bloom.timing;
      const cx = key.x + key.width / 2;
      // It spreads as it fades.
      const radius = Math.max(28, key.width * 2) * (1.7 - 0.7 * life);
      const g = ctx.createRadialGradient(cx, top, 0, cx, top, radius);
      g.addColorStop(0, rgba(channels, 0.55 * life));
      g.addColorStop(1, rgba(channels, 0));
      ctx.fillStyle = g;
      // Only above the keys: the keyboard keeps its own colours.
      ctx.fillRect(cx - radius, top - radius, radius * 2, radius);
    }
  }
}

function labelText(kind: 'early' | 'late' | 'short' | 'long'): string {
  switch (kind) {
    case 'early':
      return t('early');
    case 'late':
      return t('late');
    case 'short':
      return t('hold longer');
    default:
      return t('let go');
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
