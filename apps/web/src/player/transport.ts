// The Player's transport (P6-05, ADR 0019): plays a queue of pieces one after another on this
// device, the learner's keyboard or both. It is plain TypeScript with its clock, ticker, loader and
// instrument handed in, so it is unit-tested with fakes; `browser.ts` gives it the real ones (a
// worker clock that keeps ticking in a hidden tab, the sampler, MIDI out).
//
// Notes come from the shared playback scheduler (P6-03), handed to the instrument a little ahead
// of the clock on every tick: about 120 ms while the page is visible (less for a MIDI output that
// cannot drop stamped notes), 1.5 s while it is hidden, since a hidden page's ticks come late.
import { buildPlayback, PlaybackCursor } from '@opentiles/practice';
import type { HandFilter } from '@opentiles/practice';
import { TempoMap } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { Instrument } from '../audio/instrument';
import type { CollectionKey } from './collection';
import {
  advance,
  createQueue,
  currentKey,
  enqueue,
  retreat,
  setRepeat as queueRepeat,
  setShuffle as queueShuffle,
} from './queue';
import type { Queue, Repeat } from './queue';

export interface Playable {
  song: Song;
  title: string;
  composer?: string;
}

export interface TransportDeps {
  /** Seconds on the clock the instrument schedules on. */
  now(): number;
  /** Calls `tick` regularly until the returned function is called. */
  ticker(tick: () => void): () => void;
  load(key: CollectionKey): Promise<Playable>;
  /** The instrument for where the notes play now; may start audio, so it is asked on Play. */
  instrument(): Promise<Instrument>;
  /** The page is hidden: hand notes over further ahead. */
  hidden?(): boolean;
  random?(): number;
  /** A piece started playing (the Player's "recently played"). */
  played?(key: CollectionKey): void;
  /** Keep the screen on, or let it sleep again. */
  awake?(on: boolean): void;
}

export type TransportStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'between';

export interface TransportState {
  status: TransportStatus;
  queue: Queue;
  key: CollectionKey | null;
  piece: Playable | null;
  /** Length of the piece in song seconds (at 100 % tempo). */
  duration: number;
  tempo: number;
  hands: HandFilter;
  /** Seconds of silence between two pieces (plan Q6: 2 s, from 0 to 5). */
  gap: number;
  /** Why playback stopped by itself: the keyboard went away, or a piece would not load. */
  message: 'disconnected' | 'failed' | null;
}

export const LOOK_AHEAD = 0.12;
export const HIDDEN_LOOK_AHEAD = 1.5;
/** Seconds into a piece after which Previous starts it again instead of going back. */
export const PREVIOUS_RESTARTS_AFTER = 3;
export const DEFAULT_GAP = 2;
/** The first notes are handed over this far ahead, so they are not late. */
const START_DELAY = 0.06;

export class PlayerTransport {
  private stateValue: TransportState;
  private readonly listeners = new Set<(s: TransportState) => void>();
  private cursor: PlaybackCursor | null = null;
  private instrument: Instrument | null = null;
  private stopTicker: (() => void) | null = null;
  /** Song seconds while not playing. */
  private position = 0;
  /** Where the last note ends, in song seconds. */
  private endSeconds = 0;
  private betweenUntil = 0;
  /** Each load gets a number; a newer one wins over one still loading. */
  private loads = 0;

  constructor(private readonly deps: TransportDeps) {
    this.stateValue = {
      status: 'idle',
      queue: createQueue([]),
      key: null,
      piece: null,
      duration: 0,
      tempo: 1,
      hands: 'both',
      gap: DEFAULT_GAP,
      message: null,
    };
  }

  get state(): TransportState {
    return this.stateValue;
  }

  subscribe(listener: (s: TransportState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(patch: Partial<TransportState>): void {
    this.stateValue = { ...this.stateValue, ...patch };
    for (const l of this.listeners) l(this.stateValue);
  }

  private random(): number {
    return (this.deps.random ?? Math.random)();
  }

  /** Where the music is, in song seconds; read every frame by the canvases. */
  positionNow(): number {
    if (this.stateValue.status === 'playing' && this.cursor) {
      const at = this.cursor.secondsAt(this.deps.now());
      return Math.max(0, Math.min(this.stateValue.duration, at));
    }
    return this.position;
  }

  /** Plays `keys` from the piece at `start`, keeping the shuffle and repeat choices. */
  async playQueue(keys: readonly CollectionKey[], start = 0): Promise<void> {
    const { repeat, shuffle } = this.stateValue.queue;
    await this.open(
      createQueue(keys, start, { repeat, shuffle }, () => this.random()),
      true,
    );
  }

  /** Adds a piece to play next or at the end; with nothing playing, it is opened. */
  async add(key: CollectionKey, next = false): Promise<void> {
    const queue = enqueue(this.stateValue.queue, key, next);
    if (this.stateValue.key === null) await this.open(queue, false);
    else this.set({ queue });
  }

  private async open(queue: Queue, play: boolean): Promise<void> {
    this.halt();
    const key = currentKey(queue) ?? null;
    const load = ++this.loads;
    this.position = 0;
    this.set({ queue, key, piece: null, duration: 0, status: key ? 'loading' : 'idle' });
    if (!key) return;
    let piece: Playable;
    try {
      piece = await this.deps.load(key);
    } catch {
      if (load === this.loads) this.set({ status: 'paused', message: 'failed' });
      return;
    }
    if (load !== this.loads) return;
    // The written length, or where the last note ends if it rings past it.
    const lastEnd = piece.song.notes.reduce(
      (end, n) => Math.max(end, n.startBeat + n.durationBeats),
      0,
    );
    const map = new TempoMap(piece.song.tempos);
    const duration = map.beatToSeconds(Math.max(piece.song.lengthBeats, lastEnd));
    this.set({ piece, duration, status: 'paused', message: null });
    if (play) await this.play();
  }

  async play(): Promise<void> {
    const { piece, key, status } = this.stateValue;
    if (!piece || !key || status === 'playing' || status === 'loading') return;
    const load = this.loads;
    const instrument = await this.deps.instrument();
    // The learner may have chosen another piece while sound was starting.
    if (load !== this.loads || this.stateValue.status === 'playing') return;
    this.instrument = instrument;
    if (this.position >= this.stateValue.duration - 1e-3) this.position = 0;
    this.startAt(this.position);
    this.stopTicker ??= this.deps.ticker(() => this.tick());
    this.deps.awake?.(true);
    this.deps.played?.(key);
    this.set({ status: 'playing', message: null });
    this.tick();
  }

  pause(): void {
    const { status } = this.stateValue;
    if (status !== 'playing' && status !== 'between') return;
    this.position = status === 'between' ? 0 : this.positionNow();
    this.halt();
    this.deps.awake?.(false);
    this.set({ status: 'paused' });
  }

  async toggle(): Promise<void> {
    if (this.stateValue.status === 'playing' || this.stateValue.status === 'between') this.pause();
    else await this.play();
  }

  /** Stops, as when practice takes over the sound: the position goes back to the start. */
  stop(): void {
    this.halt();
    this.position = 0;
    this.deps.awake?.(false);
    if (this.stateValue.status !== 'idle') this.set({ status: 'paused' });
  }

  /** Moves to `seconds` (song seconds) and plays on from there if playing. */
  seek(seconds: number): void {
    const at = Math.max(0, Math.min(this.stateValue.duration, seconds));
    if (this.stateValue.status === 'playing' && this.instrument) {
      this.instrument.silence?.();
      this.startAt(at);
      this.tick();
    } else {
      this.position = at;
      this.set({});
    }
  }

  async next(): Promise<void> {
    await this.moveOn(false);
  }

  /** Back to the start of the piece, or, in its first seconds, to the piece before. */
  async previous(): Promise<void> {
    if (this.positionNow() > PREVIOUS_RESTARTS_AFTER) {
      this.seek(0);
      return;
    }
    const queue = retreat(this.stateValue.queue);
    if (queue === this.stateValue.queue) {
      this.seek(0);
      return;
    }
    const playing = this.stateValue.status === 'playing' || this.stateValue.status === 'between';
    await this.open(queue, playing);
  }

  setTempo(factor: number): void {
    if (this.stateValue.status === 'playing' && this.cursor) {
      this.cursor.setTempo(factor, this.deps.now());
    }
    this.set({ tempo: factor });
  }

  setHands(hands: HandFilter): void {
    const playing = this.stateValue.status === 'playing' && this.instrument;
    const at = this.positionNow();
    this.set({ hands });
    if (playing && this.instrument) {
      this.instrument.silence?.();
      this.startAt(at);
      this.tick();
    }
  }

  setRepeat(repeat: Repeat): void {
    this.set({ queue: queueRepeat(this.stateValue.queue, repeat) });
  }

  setShuffle(shuffle: boolean): void {
    this.set({ queue: queueShuffle(this.stateValue.queue, shuffle, () => this.random()) });
  }

  setGap(seconds: number): void {
    this.set({ gap: Math.max(0, Math.min(5, seconds)) });
  }

  /** The keyboard the notes went to is gone: pause and say so (plan §P6-05). */
  outputLost(): void {
    if (this.stateValue.status === 'playing' || this.stateValue.status === 'between') {
      this.pause();
    }
    this.set({ message: 'disconnected' });
  }

  /** Where the notes play changed: go on from the same place on the new instrument. */
  async changeInstrument(): Promise<void> {
    if (this.stateValue.status !== 'playing') return;
    const at = this.positionNow();
    this.instrument?.silence?.();
    this.instrument = await this.deps.instrument();
    this.startAt(at);
    this.tick();
  }

  private startAt(seconds: number): void {
    const { piece, hands, tempo } = this.stateValue;
    if (!piece) return;
    const events = buildPlayback(piece.song, { hands });
    this.endSeconds = events.reduce(
      (end, e) => (e.kind === 'note' ? Math.max(end, e.end) : end),
      0,
    );
    const start = this.deps.now() + START_DELAY;
    this.cursor = new PlaybackCursor(events, { time: start, seconds }, tempo);
    const { sounding } = this.cursor.seek(seconds, start);
    for (const n of sounding) this.instrument?.play(n.pitch, n.time, n.duration, n.velocity);
  }

  private tick(): void {
    const now = this.deps.now();
    const { status } = this.stateValue;
    if (status === 'between') {
      if (now >= this.betweenUntil) void this.moveOn(true);
      return;
    }
    const cursor = this.cursor;
    const instrument = this.instrument;
    if (status !== 'playing' || !cursor || !instrument) return;
    const ahead = this.deps.hidden?.()
      ? HIDDEN_LOOK_AHEAD
      : Math.min(LOOK_AHEAD, instrument.lookAhead ?? LOOK_AHEAD);
    for (const e of cursor.take(now + ahead, now)) {
      if (e.kind === 'note') instrument.play(e.pitch, e.time, e.duration, e.velocity);
    }
    if (cursor.done && now >= cursor.timeOf(this.endSeconds)) {
      this.cursor = null;
      this.position = this.stateValue.duration;
      this.betweenUntil = now + this.stateValue.gap;
      this.set({ status: 'between' });
      if (this.stateValue.gap <= 0) void this.moveOn(true);
    }
  }

  private async moveOn(auto: boolean): Promise<void> {
    const queue = advance(this.stateValue.queue, auto, () => this.random());
    const playing =
      auto || this.stateValue.status === 'playing' || this.stateValue.status === 'between';
    if (!queue) {
      // The end of the queue: back to the start of the last piece, paused.
      this.halt();
      this.position = 0;
      this.deps.awake?.(false);
      this.set({ status: 'paused' });
      return;
    }
    if (currentKey(queue) === this.stateValue.key && this.stateValue.piece) {
      // Repeat one, or a queue of one piece going round.
      this.halt();
      this.position = 0;
      this.set({ queue, status: 'paused' });
      if (playing) await this.play();
      return;
    }
    await this.open(queue, playing);
  }

  /** Stops the sound and the ticker; the state is left to the caller. */
  private halt(): void {
    this.instrument?.silence?.();
    this.cursor = null;
    this.stopTicker?.();
    this.stopTicker = null;
  }
}
