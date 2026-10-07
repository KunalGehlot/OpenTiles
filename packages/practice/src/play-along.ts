// Play-along scoring (spec §4, §7): the score scrolls at the set tempo and each note is judged as
// hit, early, late or missed. ±75 ms is on time and ±150 ms early or late at full tempo; the
// windows widen at slower practice tempos and shift by the measured input latency.
import type { InputSource, NoteEvent } from './events';

export type Judgement = 'hit' | 'early' | 'late' | 'missed';

export interface TimedNote {
  id: string;
  pitch: number;
  /** When the note should be played, on the practice clock (seconds). */
  time: number;
  measureIndex: number;
}

export interface PlayAlongOptions {
  /** Practice tempo as a fraction of the score tempo (0.25–1.5). */
  tempoFactor?: number;
  /** Input latency to compensate (seconds): events are treated as this much earlier. */
  latency?: number;
  /**
   * Per-input latency (seconds), measured by calibration; overrides `latency` for that source.
   * A MIDI keyboard and a microphone used together each keep their own figure (P1-19, P1-20).
   */
  latencyBySource?: Partial<Record<InputSource, number>>;
  onTimeWindow?: number;
  outerWindow?: number;
}

export interface NoteResult {
  note: TimedNote;
  judgement: Judgement;
  /** Played minus expected time, seconds (undefined when missed). */
  offset?: number;
}

export type PlayAlongOutcome =
  { kind: 'judged'; result: NoteResult } | { kind: 'extra'; pitch: number; time: number };

/** Window scale for a practice tempo: 1 at full speed and above, up to 2 at quarter speed. */
export function windowScale(tempoFactor: number): number {
  return Math.sqrt(Math.min(4, Math.max(1, 1 / Math.max(tempoFactor, 1e-3))));
}

export class PlayAlongScorer {
  readonly onTime: number;
  readonly outer: number;
  private readonly latency: number;
  private readonly latencyBySource: Partial<Record<InputSource, number>>;
  /** The largest latency of any source: a note only counts as missed once every input is late. */
  private readonly maxLatency: number;
  private readonly pending: TimedNote[];
  readonly results: NoteResult[] = [];
  readonly extras: { pitch: number; time: number }[] = [];

  constructor(notes: readonly TimedNote[], options: PlayAlongOptions = {}) {
    const scale = windowScale(options.tempoFactor ?? 1);
    this.onTime = (options.onTimeWindow ?? 0.075) * scale;
    this.outer = (options.outerWindow ?? 0.15) * scale;
    this.latency = options.latency ?? 0;
    this.latencyBySource = options.latencyBySource ?? {};
    this.maxLatency = Math.max(
      this.latency,
      ...Object.values(this.latencyBySource).filter((v): v is number => Number.isFinite(v)),
    );
    this.pending = [...notes].sort((a, b) => a.time - b.time);
  }

  /** Judges a played note against the nearest unplayed note of the same pitch. */
  handle(event: NoteEvent): PlayAlongOutcome {
    const t = event.time - (this.latencyBySource[event.source] ?? this.latency);
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.pending.length; i++) {
      const n = this.pending[i] as TimedNote;
      if (n.time - t > this.outer) break;
      if (n.pitch !== event.pitch) continue;
      const d = Math.abs(t - n.time);
      if (d <= this.outer && d < bestDist) {
        best = i;
        bestDist = d;
      }
    }
    if (best < 0) {
      this.extras.push({ pitch: event.pitch, time: t });
      return { kind: 'extra', pitch: event.pitch, time: t };
    }
    const [note] = this.pending.splice(best, 1) as [TimedNote];
    const offset = t - note.time;
    const judgement: Judgement =
      Math.abs(offset) <= this.onTime ? 'hit' : offset < 0 ? 'early' : 'late';
    const result = { note, judgement, offset };
    this.results.push(result);
    return { kind: 'judged', result };
  }

  /** Marks notes whose window has closed by `now` as missed and returns them. */
  update(now: number): NoteResult[] {
    const t = now - this.maxLatency;
    const missed: NoteResult[] = [];
    while (this.pending.length > 0 && (this.pending[0] as TimedNote).time + this.outer < t) {
      const note = this.pending.shift() as TimedNote;
      const r: NoteResult = { note, judgement: 'missed' };
      this.results.push(r);
      missed.push(r);
    }
    return missed;
  }

  /** Ends the run: everything not yet played is missed. */
  finish(): NoteResult[] {
    return this.update(Infinity);
  }
}
