// Beats ↔ seconds through the tempo map (ADR 0003).
import type { TempoEvent } from './types';

/** Fallback tempo when a file has none. */
export const DEFAULT_BPM = 120;

interface Segment {
  beat: number;
  seconds: number;
  bpm: number;
}

/**
 * Precomputed tempo map for fast conversions. Practice tempo scaling (25–150 %) is applied by
 * the caller, never baked into the song.
 */
export class TempoMap {
  private readonly segments: Segment[];

  constructor(tempos: readonly TempoEvent[]) {
    const sorted = [...tempos]
      .filter((t) => Number.isFinite(t.bpm) && t.bpm > 0 && t.beat >= 0)
      .sort((a, b) => a.beat - b.beat);
    if (sorted.length === 0 || (sorted[0]?.beat ?? 0) > 0) {
      sorted.unshift({ beat: 0, bpm: sorted[0]?.bpm ?? DEFAULT_BPM });
    }
    const segments: Segment[] = [];
    let seconds = 0;
    for (const t of sorted) {
      const prev = segments[segments.length - 1];
      if (prev) {
        if (t.beat === prev.beat) {
          prev.bpm = t.bpm;
          continue;
        }
        seconds = prev.seconds + ((t.beat - prev.beat) * 60) / prev.bpm;
      }
      segments.push({ beat: t.beat, seconds, bpm: t.bpm });
    }
    this.segments = segments;
  }

  private segmentAtBeat(beat: number): Segment {
    const s = this.segments;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((s[mid]?.beat ?? 0) <= beat) lo = mid;
      else hi = mid - 1;
    }
    return s[lo] as Segment;
  }

  private segmentAtSeconds(seconds: number): Segment {
    const s = this.segments;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((s[mid]?.seconds ?? 0) <= seconds) lo = mid;
      else hi = mid - 1;
    }
    return s[lo] as Segment;
  }

  beatToSeconds(beat: number): number {
    const seg = this.segmentAtBeat(beat);
    return seg.seconds + ((beat - seg.beat) * 60) / seg.bpm;
  }

  secondsToBeat(seconds: number): number {
    const seg = this.segmentAtSeconds(seconds);
    return seg.beat + ((seconds - seg.seconds) * seg.bpm) / 60;
  }

  bpmAt(beat: number): number {
    return this.segmentAtBeat(beat).bpm;
  }

  /** Seconds per beat at `beat`. */
  secondsPerBeatAt(beat: number): number {
    return 60 / this.bpmAt(beat);
  }
}

export function beatToSeconds(tempos: readonly TempoEvent[], beat: number): number {
  return new TempoMap(tempos).beatToSeconds(beat);
}

export function secondsToBeat(tempos: readonly TempoEvent[], seconds: number): number {
  return new TempoMap(tempos).secondsToBeat(seconds);
}
