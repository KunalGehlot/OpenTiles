// The live tally of a run (P5-07).
import { describe, expect, it } from 'vitest';
import { LiveTally, NO_LIVE_STATS } from '../src';

describe('LiveTally', () => {
  it('counts right notes and keeps the streak and the best streak', () => {
    const tally = new LiveTally();
    tally.right('perfect');
    tally.right('good');
    tally.right('perfect');
    expect(tally.stats).toEqual({
      perfect: 2,
      good: 1,
      missed: 0,
      wrong: 0,
      streak: 3,
      bestStreak: 3,
    });
    tally.wrong();
    tally.right('perfect');
    expect(tally.stats.streak).toBe(1);
    expect(tally.stats.bestStreak).toBe(3);
    tally.missed();
    expect(tally.stats).toMatchObject({ missed: 1, wrong: 1, streak: 0, bestStreak: 3 });
  });

  it('starts afresh on reset, and never hands out its own copy to change', () => {
    const tally = new LiveTally();
    tally.right('perfect');
    const before = tally.stats;
    tally.right('perfect');
    expect(before.perfect).toBe(1);
    tally.reset();
    expect(tally.stats).toEqual(NO_LIVE_STATS);
  });
});
