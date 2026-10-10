// The live tally of a run (P5-07): perfect, good, missed and wrong notes, and the streak of notes
// played right in a row. Play-along: on time is perfect, early or late is good. Wait mode has no
// timing, so a note played right at the first try is perfect and one found after a wrong key is
// good; nothing is missed there.

export interface LiveStats {
  perfect: number;
  good: number;
  missed: number;
  wrong: number;
  /** Notes played right since the last miss or wrong key. */
  streak: number;
  /** The longest streak of the run. */
  bestStreak: number;
}

export const NO_LIVE_STATS: Readonly<LiveStats> = Object.freeze({
  perfect: 0,
  good: 0,
  missed: 0,
  wrong: 0,
  streak: 0,
  bestStreak: 0,
});

export class LiveTally {
  private value: LiveStats = { ...NO_LIVE_STATS };

  get stats(): Readonly<LiveStats> {
    return this.value;
  }

  reset(): void {
    this.value = { ...NO_LIVE_STATS };
  }

  /** A right note: `perfect` on time or at the first try, `good` otherwise. */
  right(kind: 'perfect' | 'good'): void {
    const v = this.value;
    const streak = v.streak + 1;
    this.value = {
      ...v,
      [kind]: v[kind] + 1,
      streak,
      bestStreak: Math.max(v.bestStreak, streak),
    };
  }

  /** A note that went by unplayed (play-along). */
  missed(): void {
    this.value = { ...this.value, missed: this.value.missed + 1, streak: 0 };
  }

  /** A key that was not expected. */
  wrong(): void {
    this.value = { ...this.value, wrong: this.value.wrong + 1, streak: 0 };
  }
}
