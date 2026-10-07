// Maps a song onto the practice clock at a chosen tempo.
import { TempoMap } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import { includesHand } from './steps';
import type { HandFilter } from './steps';
import type { TimedNote } from './play-along';

export const MIN_TEMPO = 0.25;
export const MAX_TEMPO = 1.5;

export function clampTempo(factor: number): number {
  return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, factor));
}

export class Timeline {
  readonly tempo: TempoMap;
  readonly factor: number;

  /** `startTime` is the practice-clock time of `startBeat`. */
  constructor(
    song: Song,
    factor: number,
    readonly startTime = 0,
    readonly startBeat = 0,
  ) {
    this.tempo = new TempoMap(song.tempos);
    this.factor = clampTempo(factor);
  }

  timeOf(beat: number): number {
    const sec = this.tempo.beatToSeconds(beat) - this.tempo.beatToSeconds(this.startBeat);
    return this.startTime + sec / this.factor;
  }

  beatAt(time: number): number {
    const sec = (time - this.startTime) * this.factor + this.tempo.beatToSeconds(this.startBeat);
    return this.tempo.secondsToBeat(sec);
  }

  /** Notes of the selected hands from `startBeat` on, timed for play-along scoring. */
  timedNotes(song: Song, hands: HandFilter, toBeat = Infinity): TimedNote[] {
    return song.notes
      .filter(
        (n) =>
          includesHand(hands, n.hand) &&
          n.startBeat >= this.startBeat - 1e-6 &&
          n.startBeat < toBeat,
      )
      .map((n) => ({
        id: n.id,
        pitch: n.pitch,
        time: this.timeOf(n.startBeat),
        measureIndex: n.measureIndex,
      }));
  }
}
