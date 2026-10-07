// Step practice (PLAN.md P3-04, spec §4): split a piece into short phrases, loop one until it is
// secure, then move on. Phrase ends are guessed from what a player hears as a breath: a rest, a
// long note, and the usual 2-, 4-bar phrase lengths.
import type { Song, SongNote } from '@opentiles/song-model';
import { includesHand } from './steps';
import type { HandFilter } from './steps';
import type { LoopRange } from './loop';

export interface Phrase extends LoopRange {
  index: number;
  fromBeat: number;
  toBeat: number;
}

export interface PhraseOptions {
  minBars?: number;
  maxBars?: number;
}

const EPS = 1e-6;

/**
 * How strongly the music breathes at the end of bar `m` (between bar m and m+1): 0 for no cue,
 * higher for a rest or a long note there.
 */
export function boundaryStrength(song: Song, notes: readonly SongNote[], m: number): number {
  const next = song.measures[m + 1];
  const bar = song.measures[m];
  if (!next || !bar) return 0;
  const t = next.startBeat;
  let lastEnd = -Infinity;
  let lastOnset = -Infinity;
  let nextOnset = Infinity;
  for (const n of notes) {
    if (n.startBeat < t - EPS) {
      lastEnd = Math.max(lastEnd, n.startBeat + n.durationBeats);
      lastOnset = Math.max(lastOnset, n.startBeat);
    } else {
      nextOnset = Math.min(nextOnset, n.startBeat);
    }
  }
  if (lastEnd === -Infinity) return 0;
  let strength = 0;
  const rest = Math.min(nextOnset, song.lengthBeats) - lastEnd;
  if (rest >= 1 - EPS) strength += 2;
  else if (rest >= 0.5 - EPS) strength += 1;
  // A long note (half the bar, and at least a half note) on the bar's last onset.
  if (lastOnset >= bar.startBeat - EPS) {
    const longest = Math.max(
      ...notes.filter((n) => Math.abs(n.startBeat - lastOnset) <= EPS).map((n) => n.durationBeats),
    );
    if (longest >= Math.max(2, bar.lengthBeats / 2) - EPS) strength += 1.5;
  }
  return strength;
}

/** Slight preference for the common 4- and 2-bar lengths when the music gives no cue. */
function lengthBonus(bars: number): number {
  if (bars === 4) return 0.5;
  if (bars === 2) return 0.25;
  return 0;
}

/** Splits the piece into phrases of `minBars`–`maxBars` bars for the selected hands. */
export function splitPhrases(
  song: Song,
  hands: HandFilter = 'both',
  options: PhraseOptions = {},
): Phrase[] {
  const minBars = Math.max(1, options.minBars ?? 2);
  const maxBars = Math.max(minBars, options.maxBars ?? 4);
  const count = song.measures.length;
  if (count === 0) return [];
  const notes = song.notes.filter((n) => includesHand(hands, n.hand));
  const strength = song.measures.map((_, m) => boundaryStrength(song, notes, m));
  const ranges: LoopRange[] = [];
  let start = 0;
  while (start < count) {
    const remaining = count - start;
    if (remaining <= maxBars) {
      ranges.push({ fromMeasure: start, toMeasure: count - 1 });
      break;
    }
    let bestEnd = start + minBars - 1;
    let bestScore = -Infinity;
    for (let len = minBars; len <= maxBars; len++) {
      const end = start + len - 1;
      // Never leave a tail shorter than a phrase.
      if (count - (end + 1) < minBars) continue;
      const score = (strength[end] ?? 0) + lengthBonus(len);
      if (score >= bestScore) {
        bestScore = score;
        bestEnd = end;
      }
    }
    ranges.push({ fromMeasure: start, toMeasure: bestEnd });
    start = bestEnd + 1;
  }
  return ranges.map((r, index) => {
    const from = song.measures[r.fromMeasure];
    const to = song.measures[r.toMeasure];
    return {
      ...r,
      index,
      fromBeat: from?.startBeat ?? 0,
      toBeat: to ? to.startBeat + to.lengthBeats : song.lengthBeats,
    };
  });
}

/** Accuracy a phrase needs before the next one is suggested (spec §4). */
export const PHRASE_READY_ACCURACY = 0.9;

export interface PhraseRunOutcome {
  phrase: number;
  accuracy: number;
  /** True when the phrase is secure and there is a next phrase to move to. */
  suggestNext: boolean;
  /** True when the last phrase has reached the threshold. */
  pieceDone: boolean;
}

/** Walks through the phrases: loop the current one, suggest the next once it is secure. */
export class StepPractice {
  private position = 0;
  /** Best accuracy reached in each phrase. */
  readonly best: number[];

  constructor(
    readonly phrases: readonly Phrase[],
    readonly threshold = PHRASE_READY_ACCURACY,
  ) {
    this.best = phrases.map(() => 0);
  }

  get index(): number {
    return this.position;
  }

  get current(): Phrase | undefined {
    return this.phrases[this.position];
  }

  get hasNext(): boolean {
    return this.position < this.phrases.length - 1;
  }

  /** Records a run of the current phrase. */
  record(accuracy: number): PhraseRunOutcome {
    const i = this.position;
    if (i < this.best.length) this.best[i] = Math.max(this.best[i] ?? 0, accuracy);
    const ready = accuracy >= this.threshold - EPS;
    return {
      phrase: i,
      accuracy,
      suggestNext: ready && this.hasNext,
      pieceDone: ready && !this.hasNext,
    };
  }

  goTo(index: number): Phrase | undefined {
    this.position = Math.max(0, Math.min(this.phrases.length - 1, index));
    return this.current;
  }

  next(): Phrase | undefined {
    return this.goTo(this.position + 1);
  }

  previous(): Phrase | undefined {
    return this.goTo(this.position - 1);
  }
}
