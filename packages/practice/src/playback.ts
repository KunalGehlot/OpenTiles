// One playback scheduler for every place that plays a song's notes (P6-03, ADR 0019): Listen, the
// other hand in play-along, and the Player. A song becomes a list of timed events, and a cursor
// hands them out ahead of the clock, seeks and changes tempo without a jump. Pure: no DOM, no Web
// Audio, so it runs in Node tests and later in a worker.
//
// Events are timed in *song seconds*, the tempo map's seconds at 100 % tempo. The cursor maps
// them onto the caller's clock at the chosen tempo, so the `Song` itself never holds seconds
// (ADR 0003) and a tempo change only moves the mapping.
import { TempoMap } from '@opentiles/song-model';
import type { Hand, Song } from '@opentiles/song-model';
import { includesHand } from './steps';
import type { HandFilter } from './steps';

/** The velocity of a note whose source has none (MusicXML, ABC): mezzo-forte. */
export const DEFAULT_VELOCITY = 80;

export interface PlaybackNote {
  kind: 'note';
  pitch: number;
  /** Start and end in song seconds. */
  start: number;
  end: number;
  velocity: number;
  hand: Hand;
  noteId: string;
}

export type PedalKind = 'sustain' | 'soft' | 'sostenuto';

export interface PlaybackPedal {
  kind: 'pedal';
  /** In song seconds. */
  start: number;
  pedal: PedalKind;
  /** 0–127, as MIDI control changes: 64 and up is down for the sustain pedal. */
  value: number;
}

export type PlaybackEvent = PlaybackNote | PlaybackPedal;

export interface PlaybackOptions {
  /** The hands the learner chose. */
  hands?: HandFilter;
  /**
   * Play the hands the learner does *not* play (play-along's other hand) instead of the chosen
   * ones.
   */
  accompany?: boolean;
  /** Notes starting in `[fromBeat, toBeat)` play; defaults to the whole song. */
  fromBeat?: number;
  toBeat?: number;
}

/** The song's notes (and, later, pedal events) to play, in song seconds, sorted by start. */
export function buildPlayback(song: Song, options: PlaybackOptions = {}): PlaybackEvent[] {
  const { hands = 'both', accompany = false, fromBeat = 0, toBeat = song.lengthBeats } = options;
  const tempo = new TempoMap(song.tempos);
  const events: PlaybackEvent[] = [];
  for (const n of song.notes) {
    if (n.startBeat < fromBeat - 1e-6 || n.startBeat >= toBeat - 1e-6) continue;
    if (includesHand(hands, n.hand) === accompany) continue;
    events.push({
      kind: 'note',
      pitch: n.pitch,
      start: tempo.beatToSeconds(n.startBeat),
      end: tempo.beatToSeconds(n.startBeat + n.durationBeats),
      velocity: n.velocity ?? DEFAULT_VELOCITY,
      hand: n.hand,
      noteId: n.id,
    });
  }
  // Stable, so notes of one chord keep the song's order.
  return events.sort((a, b) => a.start - b.start);
}

/** A note handed out by the cursor, on the caller's clock. */
export interface TimedPlaybackNote extends PlaybackNote {
  /** Clock time to start, and how long to hold it at the current tempo (both seconds). */
  time: number;
  duration: number;
}

export interface TimedPlaybackPedal extends PlaybackPedal {
  time: number;
}

export type TimedPlaybackEvent = TimedPlaybackNote | TimedPlaybackPedal;

/** The pedals' positions at some point: the last value of each, 0 when never pressed. */
export type PedalState = Record<PedalKind, number>;

const NO_PEDALS: Readonly<PedalState> = Object.freeze({ sustain: 0, soft: 0, sostenuto: 0 });

/**
 * Hands out a list of playback events ahead of a clock, at a tempo factor. The caller asks for
 * everything due before "now plus its look-ahead" on every tick (`take`), so how far ahead it
 * schedules is its own choice: shorter for a MIDI output that cannot drop stamped notes.
 */
export class PlaybackCursor {
  private next = 0;
  private anchorTime: number;
  private anchorSeconds: number;
  private factorValue: number;

  constructor(
    private readonly events: readonly PlaybackEvent[],
    /** Clock time at which song second `seconds` plays. */
    anchor: { time: number; seconds: number },
    factor = 1,
  ) {
    this.anchorTime = anchor.time;
    this.anchorSeconds = anchor.seconds;
    this.factorValue = factor;
    this.next = this.firstAtOrAfter(anchor.seconds);
  }

  get factor(): number {
    return this.factorValue;
  }

  /** True once every event has been handed out. */
  get done(): boolean {
    return this.next >= this.events.length;
  }

  /** The clock time a song second plays at. */
  timeOf(seconds: number): number {
    return this.anchorTime + (seconds - this.anchorSeconds) / this.factorValue;
  }

  /** The song second playing at a clock time. */
  secondsAt(time: number): number {
    return this.anchorSeconds + (time - this.anchorTime) * this.factorValue;
  }

  /**
   * Events due before `until` that were not handed out yet, in order. A note due more than `late`
   * seconds before `now` is skipped (a busy page must not play a burst of old notes); pedal events
   * are never skipped, so the pedal ends where it should.
   */
  take(until: number, now = -Infinity, late = 0.05): TimedPlaybackEvent[] {
    const out: TimedPlaybackEvent[] = [];
    while (this.next < this.events.length) {
      const e = this.events[this.next];
      if (!e) break;
      const time = this.timeOf(e.start);
      if (time > until) break;
      this.next += 1;
      if (e.kind === 'pedal') out.push({ ...e, time });
      else if (time >= now - late) out.push(this.timed(e, time));
    }
    return out;
  }

  /**
   * Moves to song second `seconds`, which plays at clock time `at`. Returns the notes that would
   * already be sounding there, to start at once with what is left of them, and the pedals'
   * positions; the cursor goes on with the events after it.
   */
  seek(seconds: number, at: number): { sounding: TimedPlaybackNote[]; pedals: PedalState } {
    this.anchorTime = at;
    this.anchorSeconds = seconds;
    this.next = this.firstAtOrAfter(seconds);
    const sounding: TimedPlaybackNote[] = [];
    const pedals: PedalState = { ...NO_PEDALS };
    for (let i = 0; i < this.next; i++) {
      const e = this.events[i];
      if (!e) continue;
      if (e.kind === 'pedal') pedals[e.pedal] = e.value;
      else if (e.end > seconds + 1e-9) {
        sounding.push({ ...e, time: at, duration: (e.end - seconds) / this.factorValue });
      }
    }
    return { sounding, pedals };
  }

  /** Changes the tempo from clock time `at` on, without a jump in the music. */
  setTempo(factor: number, at: number): void {
    const seconds = this.secondsAt(at);
    this.anchorTime = at;
    this.anchorSeconds = seconds;
    this.factorValue = factor;
  }

  private timed(e: PlaybackNote, time: number): TimedPlaybackNote {
    return { ...e, time, duration: (e.end - e.start) / this.factorValue };
  }

  /** Index of the first event starting at or after `seconds`. */
  private firstAtOrAfter(seconds: number): number {
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.events[mid]?.start ?? Infinity) < seconds - 1e-9) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
