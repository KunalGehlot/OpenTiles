import { describe, expect, it } from 'vitest';
import { TempoMap } from '../src/tempo';

describe('TempoMap', () => {
  it('converts at a constant tempo', () => {
    const t = new TempoMap([{ beat: 0, bpm: 120 }]);
    expect(t.beatToSeconds(4)).toBeCloseTo(2);
    expect(t.secondsToBeat(1.5)).toBeCloseTo(3);
  });

  it('handles tempo changes and round-trips', () => {
    const t = new TempoMap([
      { beat: 0, bpm: 60 },
      { beat: 4, bpm: 120 },
    ]);
    expect(t.beatToSeconds(4)).toBeCloseTo(4);
    expect(t.beatToSeconds(6)).toBeCloseTo(5);
    for (const b of [0, 1.5, 4, 5.25, 10])
      expect(t.secondsToBeat(t.beatToSeconds(b))).toBeCloseTo(b);
    expect(t.bpmAt(3.9)).toBe(60);
    expect(t.bpmAt(4)).toBe(120);
  });

  it('falls back to 120 bpm and fills a missing start', () => {
    expect(new TempoMap([]).beatToSeconds(2)).toBeCloseTo(1);
    const t = new TempoMap([{ beat: 2, bpm: 60 }]);
    expect(t.beatToSeconds(2)).toBeCloseTo(2);
  });
});
