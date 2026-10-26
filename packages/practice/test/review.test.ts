// Spaced review (P7-26): SM-2 grades and intervals, early and late reviews, one review a day, the
// schedule replayed from chord and scale rounds, and a simulated two months of chord practice.
import { describe, expect, it } from 'vitest';
import {
  chordReviewEvents,
  dueChordKinds,
  dueReviews,
  dueScaleKinds,
  gradeOf,
  localDayNumber,
  MAX_REVIEWS,
  MIN_EASE,
  nextEase,
  replayReviews,
  review,
  START_EASE,
} from '../src';
import type { ChordRound, ChordStats, ReviewGrade, ReviewState, ScaleStats } from '../src';

/** Noon, local time, `d` days after 26 October 2026. */
const at = (d: number) => new Date(2026, 9, 26 + d, 12).getTime();
const DAY0 = localDayNumber(at(0));

const chordRound = (d: number, kinds: Record<string, [number, number]>): ChordRound => {
  const entries = Object.values(kinds);
  return {
    at: at(d),
    chords: entries.reduce((s, [a]) => s + a, 0),
    firstTry: entries.reduce((s, [, f]) => s + f, 0),
    perMinute: 10,
    kinds: Object.fromEntries(Object.entries(kinds).map(([k, [a, f]]) => [k, [a, f, a * 2]])),
  };
};

describe('grades', () => {
  it('passes from the weak-chord line of 80 % right at the first try', () => {
    expect(gradeOf(19, 20)).toBe(5);
    expect(gradeOf(16, 20)).toBe(4);
    expect(gradeOf(15, 20)).toBe(2);
    expect(gradeOf(1, 20)).toBe(1);
    expect(gradeOf(0, 5)).toBe(0);
    expect(gradeOf(0, 0)).toBe(0);
  });

  it('moves the ease as SM-2 does, never below 1.3', () => {
    expect(nextEase(START_EASE, 5)).toBeCloseTo(2.6);
    expect(nextEase(START_EASE, 4)).toBeCloseTo(2.5);
    expect(nextEase(START_EASE, 2)).toBeCloseTo(2.18);
    expect(nextEase(MIN_EASE, 0)).toBe(MIN_EASE);
  });
});

describe('one item', () => {
  const pass = (s: ReviewState | undefined, day: number, grade: ReviewGrade = 5) =>
    review(s, 'chord:7.dom7', grade, DAY0 + day);

  it('comes back after 1, 6, then interval times ease days', () => {
    let s = pass(undefined, 0);
    expect([s.intervalDays, s.dueDay - DAY0]).toEqual([1, 1]);
    s = pass(s, 1);
    expect([s.intervalDays, s.dueDay - DAY0]).toEqual([6, 7]);
    s = pass(s, 7);
    expect(s.intervalDays).toBe(Math.round(6 * s.ease));
    expect(s.dueDay).toBe(DAY0 + 7 + s.intervalDays);
  });

  it('ignores a pass before the item is due', () => {
    const s = pass(pass(undefined, 0), 1);
    expect(pass(s, 3)).toBe(s);
  });

  it('starts again after a fail, early or on time, and counts a lapse once it was known', () => {
    const known = pass(pass(undefined, 0), 1);
    const failedEarly = pass(known, 3, 1);
    expect([failedEarly.intervalDays, failedEarly.reps, failedEarly.lapses]).toEqual([1, 0, 1]);
    expect(failedEarly.dueDay).toBe(DAY0 + 4);
    expect(pass(undefined, 0, 0).lapses).toBe(0);
  });
});

describe('the schedule from the rounds', () => {
  it('counts the rounds of one day as one review', () => {
    const s = replayReviews([
      { at: at(0), item: 'chord:0.maj', attempts: 4, firstTry: 3 },
      { at: at(0) + 3_600_000, item: 'chord:0.maj', attempts: 4, firstTry: 4 },
    ]).get('chord:0.maj');
    expect(s?.reps).toBe(1);
    expect(s?.ease).toBeCloseTo(2.5);
  });

  it('replays chord rounds into the kinds due each day', () => {
    const rounds = [
      chordRound(0, { '7.dom7': [4, 4], '0.maj': [4, 1] }),
      chordRound(1, { '7.dom7': [4, 4], '0.maj': [4, 4] }),
    ];
    const stats: ChordStats = { version: 1, rounds };
    expect(chordReviewEvents(stats)).toHaveLength(4);
    expect(dueChordKinds({ version: 1, rounds: rounds.slice(0, 1) }, at(1))).toEqual([
      '0.maj',
      '7.dom7',
    ]);
    expect(dueChordKinds(stats, at(1))).toEqual([]);
    expect(dueChordKinds(stats, at(2))).toEqual(['0.maj']);
    expect(dueChordKinds(stats, at(7))).toEqual(['0.maj', '7.dom7']);
    expect(dueChordKinds(stats, at(7), new Set(['7.dom7']))).toEqual(['7.dom7']);
  });

  it('replays scale rounds the same way', () => {
    const stats: ScaleStats = {
      version: 1,
      rounds: [
        {
          at: at(0),
          scales: 2,
          firstTry: 1,
          notesPerMinute: 60,
          evenness: null,
          kinds: { '2.major': [1, 1], '9.harmonic': [1, 0] },
        },
      ],
    };
    expect(dueScaleKinds(stats, at(0))).toEqual([]);
    expect(dueScaleKinds(stats, at(1))).toEqual(['9.harmonic', '2.major']);
  });

  it('puts the longest overdue first and stops at the limit', () => {
    const states = [
      review(undefined, 'a', 5, DAY0),
      review(undefined, 'b', 5, DAY0 - 3),
      review(undefined, 'c', 1, DAY0),
    ];
    expect(dueReviews(states, at(5)).map((s) => s.item)).toEqual(['b', 'c', 'a']);
    expect(dueReviews(states, at(5), 1).map((s) => s.item)).toEqual(['b']);
    expect(dueReviews(states, at(0)).map((s) => s.item)).toEqual(['b']);
  });
});

describe('a simulated two months', () => {
  it('lets the reviews settle while the intervals grow', () => {
    // 24 kinds of chord, four new ones a day, the due ones reviewed; 85 % of answers right.
    const kinds = Array.from({ length: 24 }, (_, i) => `${i % 12}.${i < 12 ? 'maj' : 'min'}`);
    let seed = 11;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let stats: ChordStats = { version: 1, rounds: [] };
    const duePerDay: number[] = [];
    for (let d = 0; d < 60; d++) {
      const due = dueChordKinds(stats, at(d), undefined, Number.POSITIVE_INFINITY);
      duePerDay.push(due.length);
      const seen = new Set(Object.keys(replayReviewsOf(stats)));
      const fresh = kinds.filter((k) => !seen.has(k)).slice(0, 4);
      const today: Record<string, [number, number]> = {};
      for (const k of [...due.slice(0, MAX_REVIEWS), ...fresh]) {
        const right = Array.from({ length: 4 }, () => random() < 0.85).filter(Boolean).length;
        today[k] = [4, right];
      }
      if (Object.keys(today).length > 0)
        stats = { version: 1, rounds: [...stats.rounds, chordRound(d, today)] };
    }
    expect(Math.max(...duePerDay)).toBeLessThanOrEqual(24);
    const lastWeek = duePerDay.slice(-7).reduce((a, b) => a + b, 0) / 7;
    expect(lastWeek).toBeLessThan(8);
    const states = [...replayReviews(chordReviewEvents(stats)).values()];
    const mean = states.reduce((s, x) => s + x.intervalDays, 0) / states.length;
    expect(mean).toBeGreaterThan(6);
  });
});

function replayReviewsOf(stats: ChordStats): Record<string, true> {
  const out: Record<string, true> = {};
  for (const r of stats.rounds) for (const k of Object.keys(r.kinds)) out[k] = true;
  return out;
}
