// Selecting bars to loop by dragging across the falling notes (PLAN.md P2-08). The drag is drawn
// by the renderer as it happens; React only hears about the finished range.
import { loopFromBeats } from '@opentiles/practice';
import type { LoopRange } from '@opentiles/practice';
import type { PracticeRenderer } from './renderer';
import type { PracticeSession } from './session';

/** Pointer travel (CSS px) before a press counts as a drag rather than a tap. */
const DRAG_THRESHOLD = 12;

export class LoopDrag {
  private active: { pointerId: number; y: number; beat: number; moved: boolean } | null = null;

  constructor(
    private readonly session: PracticeSession,
    private readonly renderer: () => PracticeRenderer | null,
  ) {}

  get dragging(): boolean {
    return this.active !== null;
  }

  /** Starts a drag at canvas height `y` if it is above the keyboard. Returns true if it did. */
  down(pointerId: number, y: number): boolean {
    const r = this.renderer();
    if (!r || y >= r.keyboardTop) return false;
    this.active = { pointerId, y, beat: r.beatAtY(y, this.session.beat), moved: false };
    return true;
  }

  move(pointerId: number, y: number): void {
    const a = this.active;
    const r = this.renderer();
    if (!a || !r || a.pointerId !== pointerId) return;
    if (!a.moved && Math.abs(y - a.y) < DRAG_THRESHOLD) return;
    a.moved = true;
    const range = this.rangeTo(y);
    if (!range) return;
    const song = this.session.song;
    const from = song.measures[range.fromMeasure];
    const to = song.measures[range.toMeasure];
    if (from && to) r.preview = { fromBeat: from.startBeat, toBeat: to.startBeat + to.lengthBeats };
  }

  /** Ends the drag; returns the selected bars, or null for a tap. */
  up(pointerId: number, y: number): LoopRange | null {
    const a = this.active;
    if (!a || a.pointerId !== pointerId) return null;
    this.cancel();
    if (!a.moved && Math.abs(y - a.y) < DRAG_THRESHOLD) return null;
    this.active = a;
    const range = this.rangeTo(y);
    this.active = null;
    return range;
  }

  cancel(): void {
    this.active = null;
    const r = this.renderer();
    if (r) r.preview = null;
  }

  private rangeTo(y: number): LoopRange | null {
    const a = this.active;
    const r = this.renderer();
    if (!a || !r) return null;
    const top = r.keyboardTop;
    const beat = r.beatAtY(Math.min(top - 1, Math.max(0, y)), this.session.beat);
    return loopFromBeats(this.session.song, a.beat, beat);
  }
}
