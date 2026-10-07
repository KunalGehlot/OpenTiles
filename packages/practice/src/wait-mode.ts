// Wait mode (spec §4): the cursor stops at each step until every expected note has been played;
// wrong notes are reported but don't block progress.
import type { NoteEvent } from './events';
import type { Step } from './steps';

export type WaitOutcome =
  | { kind: 'correct'; pitch: number; step: number; completed: boolean }
  | { kind: 'repeat'; pitch: number; step: number }
  | { kind: 'wrong'; pitch: number; step: number }
  | { kind: 'finished' };

export interface WaitStats {
  correct: number;
  wrong: number;
  stepsDone: number;
  /** Per measure: wrong notes played while waiting there. */
  wrongByMeasure: Map<number, number>;
}

export class WaitMode {
  private position = 0;
  private played = new Set<number>();
  readonly stats: WaitStats = { correct: 0, wrong: 0, stepsDone: 0, wrongByMeasure: new Map() };
  /** Called whenever the current step changes (start, advance, seek). */
  onStep: (step: Step | undefined) => void = () => {};

  constructor(readonly steps: readonly Step[]) {}

  get index(): number {
    return this.position;
  }

  get current(): Step | undefined {
    return this.steps[this.position];
  }

  get finished(): boolean {
    return this.position >= this.steps.length;
  }

  /** Pitches of the current step not yet played. */
  get remaining(): number[] {
    return (this.current?.pitches ?? []).filter((p) => !this.played.has(p));
  }

  /** Pitches of the current step already played. */
  get satisfied(): number[] {
    return [...this.played];
  }

  seek(index: number): void {
    this.position = Math.max(0, Math.min(this.steps.length, index));
    this.played.clear();
    this.onStep(this.current);
  }

  reset(): void {
    this.stats.correct = 0;
    this.stats.wrong = 0;
    this.stats.stepsDone = 0;
    this.stats.wrongByMeasure.clear();
    this.seek(0);
  }

  handle(event: NoteEvent): WaitOutcome {
    const step = this.current;
    if (!step) return { kind: 'finished' };
    if (step.pitches.includes(event.pitch)) {
      if (this.played.has(event.pitch)) {
        return { kind: 'repeat', pitch: event.pitch, step: step.index };
      }
      this.played.add(event.pitch);
      this.stats.correct += 1;
      const completed = this.remaining.length === 0;
      if (completed) {
        this.stats.stepsDone += 1;
        this.position += 1;
        this.played.clear();
        this.onStep(this.current);
      }
      return { kind: 'correct', pitch: event.pitch, step: step.index, completed };
    }
    this.stats.wrong += 1;
    this.stats.wrongByMeasure.set(
      step.measureIndex,
      (this.stats.wrongByMeasure.get(step.measureIndex) ?? 0) + 1,
    );
    return { kind: 'wrong', pitch: event.pitch, step: step.index };
  }
}
