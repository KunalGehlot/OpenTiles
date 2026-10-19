// One playback scheduler for every place that plays a song's notes (P6-03, ADR 0019): Listen, the
// other hand in play-along, and the Player. A song becomes a list of timed events, and a cursor
// hands them out ahead of the clock, seeks and changes tempo without a jump. Pure: no DOM, no Web
// Audio, so it runs in Node tests and later in a worker.
//
// Events are timed in *song seconds*, the tempo map's seconds at 100 % tempo. The cursor maps
// them onto the caller's clock at the chosen tempo, so the `Song` itself never holds seconds
// (ADR 0003) and a tempo change only moves the mapping.
import { PEDAL_DOWN, pedalsBefore, TempoMap } from '@opentiles/song-model';
import type { Hand, PedalEvent, PedalKind, Song } from '@opentiles/song-model';
import { includesHand } from './steps';
import type { HandFilter } from './steps';
import { endingWarp, expressivePedals, expressiveVelocities } from './expression';
import { touchVelocities } from './touch';
import type { Touch } from './touch';

/** The velocity of a note whose source has none (MusicXML, ABC): mezzo-forte. */
export const DEFAULT_VELOCITY = 80;

export interface PlaybackNote {
  kind: 'note';
  pitch: number;
  /** Start, and when the key goes up, in song seconds. */
  start: number;
  end: number;
  /**
   * When the note stops sounding, in song seconds: later than `end` while the sustain pedal is
   * down then, or the sostenuto pedal caught it (P6-10). An instrument with pedals of its own (a
   * MIDI keyboard) gets `end` and the pedal events instead.
   */
  held: number;
  velocity: number;
  hand: Hand;
  noteId: string;
}

export type { PedalKind };

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
  /**
   * Include the pedal events (default). Off for play-along's other hand: the learner plays on the
   * same keyboard, and the file's pedal would hold their notes too. Notes are still held as the
   * pedal would hold them.
   */
  pedals?: boolean;
  /** How notes without a velocity of their own are played (P6-11): natural by default. */
  touch?: Touch;
  /**
   * Expressive playing (P6-16, the Player only): shaped touch and phrases for notes the file
   * leaves unshaped, and an automatic sustain pedal when the file has none. Overrides `touch`.
   */
  expressive?: boolean;
}

/** Spans of song seconds in which a pedal is down. */
function downSpans(
  list: readonly PedalEvent[],
  tempo: TempoMap,
  pedal: PedalKind,
): [number, number][] {
  const spans: [number, number][] = [];
  let downAt: number | null = null;
  for (const e of list) {
    if (e.pedal !== pedal) continue;
    const at = tempo.beatToSeconds(e.beat);
    if (e.value >= PEDAL_DOWN && downAt === null) downAt = at;
    else if (e.value < PEDAL_DOWN && downAt !== null) {
      spans.push([downAt, at]);
      downAt = null;
    }
  }
  if (downAt !== null) spans.push([downAt, Infinity]);
  return spans;
}

/** The song's notes (and, later, pedal events) to play, in song seconds, sorted by start. */
export function buildPlayback(song: Song, options: PlaybackOptions = {}): PlaybackEvent[] {
  const {
    hands = 'both',
    accompany = false,
    fromBeat = 0,
    toBeat = song.lengthBeats,
    pedals = true,
    touch = 'natural',
    expressive = false,
  } = options;
  const tempo = new TempoMap(song.tempos);
  const shaped = expressive ? expressiveVelocities(song) : touchVelocities(song, touch);
  const pedalList = expressive ? expressivePedals(song) : (song.pedals ?? []);
  const sustain = downSpans(pedalList, tempo, 'sustain');
  const sostenuto = downSpans(pedalList, tempo, 'sostenuto');
  const songEnd = tempo.beatToSeconds(song.lengthBeats);
  // Expressive playing eases the tempo into the last chord and holds it (P6-16).
  const played = expressive ? endingWarp(song) : (t: number) => t;
  const heldUntil = (start: number, end: number) => {
    let held = end;
    // The damper stays off the strings while the sustain pedal is down when the key goes up.
    const span = sustain.find(([down, up]) => down <= end + 1e-9 && end < up - 1e-9);
    if (span) held = Math.max(held, span[1]);
    // The sostenuto pedal holds the notes whose keys were down when it went down.
    for (const [down, up] of sostenuto) {
      if (start < down - 1e-9 && end > down + 1e-9) held = Math.max(held, up);
    }
    return Math.min(held, Math.max(end, songEnd));
  };
  const events: PlaybackEvent[] = [];
  for (const n of song.notes) {
    if (n.startBeat < fromBeat - 1e-6 || n.startBeat >= toBeat - 1e-6) continue;
    if (includesHand(hands, n.hand) === accompany) continue;
    const start = tempo.beatToSeconds(n.startBeat);
    const end = tempo.beatToSeconds(n.startBeat + n.durationBeats);
    events.push({
      kind: 'note',
      pitch: n.pitch,
      start: played(start),
      end: played(end),
      held: played(heldUntil(start, end)),
      // Expressive touch also reshapes a file that gives every note one velocity.
      velocity:
        (expressive ? shaped.get(n.id) : undefined) ??
        n.velocity ??
        shaped.get(n.id) ??
        DEFAULT_VELOCITY,
      hand: n.hand,
      noteId: n.id,
    });
  }
  if (pedals && pedalList.length) {
    // The pedals as they stand where playing starts, then their changes inside the range.
    const from = tempo.beatToSeconds(fromBeat);
    const state = pedalsBefore(pedalList, fromBeat);
    for (const pedal of ['sustain', 'soft', 'sostenuto'] as const) {
      if (state[pedal] > 0) {
        events.push({ kind: 'pedal', start: played(from), pedal, value: state[pedal] });
      }
    }
    for (const e of pedalList) {
      // A pedal lifted where the range ends is kept, so nothing stays held after it.
      const atEnd = Math.abs(e.beat - toBeat) <= 1e-6 && e.value < PEDAL_DOWN;
      if (e.beat < fromBeat - 1e-6 || (e.beat >= toBeat - 1e-6 && !atEnd)) continue;
      events.push({
        kind: 'pedal',
        start: played(tempo.beatToSeconds(e.beat)),
        pedal: e.pedal,
        value: e.value,
      });
    }
  }
  // Stable, so notes of one chord keep the song's order and a pedal change ("up, then down")
  // its own. A pedal comes before the notes on its beat, as the held lengths assume: a sostenuto
  // pressed with a note does not catch it, and a change of pedal does not cut the new note.
  const rank = (e: PlaybackEvent) => (e.kind === 'pedal' ? 0 : 1);
  return events.sort((a, b) => a.start - b.start || rank(a) - rank(b));
}

/**
 * How long the song plays, in song seconds at 100 % tempo: to the end of its last bar or its last
 * note, whichever is later, and with an expressive ending a little longer.
 */
export function playbackLength(song: Song, expressive = false): number {
  const lastEnd = song.notes.reduce((end, n) => Math.max(end, n.startBeat + n.durationBeats), 0);
  const seconds = new TempoMap(song.tempos).beatToSeconds(Math.max(song.lengthBeats, lastEnd));
  return expressive ? endingWarp(song)(seconds) : seconds;
}

/** A note handed out by the cursor, on the caller's clock. */
export interface TimedPlaybackNote extends PlaybackNote {
  /** Clock time to start, and how long to hold the key at the current tempo (both seconds). */
  time: number;
  duration: number;
  /** How long it sounds with the pedal, at the current tempo (seconds). */
  heldDuration: number;
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
      else if (e.held > seconds + 1e-9) {
        // A key already up but held by the pedal sounds on with no key held.
        sounding.push({
          ...e,
          time: at,
          duration: Math.max(0, e.end - seconds) / this.factorValue,
          heldDuration: (e.held - seconds) / this.factorValue,
        });
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
    return {
      ...e,
      time,
      duration: (e.end - e.start) / this.factorValue,
      heldDuration: (e.held - e.start) / this.factorValue,
    };
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
