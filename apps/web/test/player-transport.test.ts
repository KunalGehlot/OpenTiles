// The Player's queue and transport (P6-05) with a fake clock, a hand-driven ticker and an
// instrument that writes down what it is asked to play. Songs are generated here (CC0).
import { describe, expect, it } from 'vitest';
import type { Song, SongNote } from '@opentiles/song-model';
import type { Instrument } from '../src/audio/instrument';
import type { CollectionKey } from '../src/player/collection';
import {
  advance,
  createQueue,
  currentKey,
  enqueue,
  retreat,
  setShuffle,
  upNext,
} from '../src/player/queue';
import { HIDDEN_LOOK_AHEAD, PlayerTransport } from '../src/player/transport';
import { onPageClock } from '../src/player/page-clock';

const key = (n: number): CollectionKey => `catalogue:piece-${n}`;

/** `notes` quarter notes at 120 bpm: half a second each, starting at C4. */
function piece(notes: number, startPitch = 60, durationBeats = 1): Song {
  return {
    title: 'p',
    format: 'musicxml',
    notes: Array.from({ length: notes }, (_, i): SongNote => ({
      id: `n${i}`,
      pitch: startPitch + i,
      startBeat: i,
      durationBeats,
      hand: 'right',
      staff: 1,
      voice: 1,
      part: 0,
      measureIndex: Math.floor(i / 4),
      sourceRefs: [],
    })),
    measures: [],
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [],
    lengthBeats: notes,
    warnings: [],
  };
}

/** A seeded random, so shuffles are the same every run. */
function seeded(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function harness(songs: Song[], options: { hidden?: boolean; lookAhead?: number } = {}) {
  const clock = { t: 100 };
  let tick: (() => void) | null = null;
  const played: { pitch: number; when: number; duration: number; at: number; held?: number }[] = [];
  const log: string[] = [];
  const started: CollectionKey[] = [];
  const awake: boolean[] = [];
  let silenced = 0;
  const instrument: Instrument = {
    volume: 1,
    noteOn: () => ({ stop: () => {} }),
    play: (pitch, when, duration, _velocity, held) => {
      played.push({ pitch, when, duration, at: clock.t, ...(held === undefined ? {} : { held }) });
      log.push(`note ${pitch}`);
      return { stop: () => {} };
    },
    pedal: (pedal, value) => {
      log.push(`${pedal} ${value}`);
    },
    click: () => {},
    silence: () => {
      silenced += 1;
    },
    ...(options.lookAhead === undefined ? {} : { lookAhead: options.lookAhead }),
  };
  const transport = new PlayerTransport({
    now: () => clock.t,
    ticker: (fn) => {
      tick = fn;
      return () => {
        tick = null;
      };
    },
    load: async (k) => {
      const n = Number(k.split('-').pop());
      const song = songs[n];
      if (!song) throw new Error('no such piece');
      return { song, title: `Piece ${n}` };
    },
    instrument: async () => instrument,
    hidden: () => options.hidden ?? false,
    random: seeded(),
    played: (k) => started.push(k),
    awake: (on) => awake.push(on),
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** Moves the clock on in 25 ms ticks, as the worker clock does. */
  const run = async (seconds: number) => {
    const end = clock.t + seconds;
    while (clock.t < end - 1e-9) {
      clock.t = Math.min(end, clock.t + 0.025);
      tick?.();
      await flush();
    }
  };
  return {
    transport,
    clock,
    played,
    log,
    started,
    awake,
    run,
    flush,
    silenced: () => silenced,
    ticking: () => tick !== null,
  };
}

describe('the Player’s queue (P6-05)', () => {
  const keys = [0, 1, 2, 3].map(key);

  it('goes through the list, and round again with repeat all', () => {
    let q = createQueue(keys, 1);
    expect(currentKey(q)).toBe(key(1));
    expect(upNext(q)).toEqual([key(2), key(3)]);
    q = advance(q, true)!;
    q = advance(q, true)!;
    expect(advance(q, true)).toBeNull();
    expect(currentKey(advance({ ...q, repeat: 'all' }, true)!)).toBe(key(0));
  });

  it('plays a piece again with repeat one, unless Next is pressed', () => {
    const q = createQueue(keys, 0, { repeat: 'one' });
    expect(currentKey(advance(q, true)!)).toBe(key(0));
    expect(currentKey(advance(q, false)!)).toBe(key(1));
  });

  it('shuffles every piece once before any plays again, never the last one first', () => {
    const random = seeded(3);
    let q = createQueue(keys, 2, { shuffle: true, repeat: 'all' }, random);
    const heard = [currentKey(q)];
    for (let i = 0; i < 3; i++) {
      q = advance(q, true, random)!;
      heard.push(currentKey(q));
    }
    expect(heard[0]).toBe(key(2));
    expect(new Set(heard).size).toBe(4);
    const last = heard[3];
    q = advance(q, true, random)!;
    expect(currentKey(q)).not.toBe(last);
    // Turning shuffle off keeps the piece playing and goes on in the list's order.
    const now = currentKey(q);
    const plain = setShuffle(q, false);
    expect(currentKey(plain)).toBe(now);
  });

  it('goes back a piece, wrapping only with repeat', () => {
    const q = createQueue(keys, 0);
    expect(retreat(q)).toBe(q);
    expect(currentKey(retreat({ ...q, repeat: 'all' }))).toBe(key(3));
    expect(currentKey(retreat(createQueue(keys, 2)))).toBe(key(1));
  });

  it('adds a piece to play next or last', () => {
    const q = createQueue([key(0), key(1)], 0);
    expect(upNext(enqueue(q, key(9), true))).toEqual([key(9), key(1)]);
    expect(upNext(enqueue(q, key(9)))).toEqual([key(1), key(9)]);
    expect(currentKey(enqueue(createQueue([]), key(5)))).toBe(key(5));
  });
});

describe('the Player’s transport (P6-05)', () => {
  it('plays a piece on time, pauses where it is and goes on from there', async () => {
    const h = harness([piece(8)]);
    await h.transport.playQueue([key(0)]);
    expect(h.transport.state.status).toBe('playing');
    expect(h.started).toEqual([key(0)]);
    expect(h.awake).toEqual([true]);
    await h.run(1.3);
    // Notes at 0, 0.5, 1 and 1.5 s after the start (100.06 s): the last within the look-ahead.
    expect(h.played.map((p) => p.pitch)).toEqual([60, 61, 62]);
    expect(h.played[1]!.when).toBeCloseTo(100.56, 6);
    expect(Math.max(...h.played.map((p) => p.when - p.at))).toBeLessThanOrEqual(0.12 + 1e-9);
    h.transport.pause();
    expect(h.transport.positionNow()).toBeCloseTo(1.24, 2);
    expect(h.silenced()).toBeGreaterThan(0);
    expect(h.ticking()).toBe(false);
    expect(h.awake.at(-1)).toBe(false);
    h.played.length = 0;
    await h.run(5);
    expect(h.played).toEqual([]);
    await h.transport.play();
    await h.run(0.5);
    // Resumed inside the note at 1 s (still sounding), then the one at 1.5 s.
    expect(h.played.map((p) => p.pitch)).toEqual([62, 63]);
    expect(h.played[0]!.duration).toBeCloseTo(0.26, 2);
  });

  it('seeks into a held note and plays what is left of it', async () => {
    const h = harness([piece(4, 60, 2)]);
    await h.transport.playQueue([key(0)]);
    h.played.length = 0;
    h.transport.seek(0.75);
    // The notes at 0 s and 0.5 s are each a second long, so both still sound at 0.75 s.
    expect(h.played.map((p) => [p.pitch, Number(p.duration.toFixed(2))])).toEqual([
      [60, 0.25],
      [61, 0.75],
    ]);
  });

  it('moves on to the next piece after the gap, and stops at the end', async () => {
    const h = harness([piece(2), piece(2, 70)]);
    await h.transport.playQueue([key(0), key(1)]);
    await h.run(1.2);
    expect(h.transport.state.status).toBe('between');
    await h.run(1.5);
    expect(h.transport.state.key).toBe(key(0));
    await h.run(1);
    expect(h.transport.state.key).toBe(key(1));
    expect(h.transport.state.status).toBe('playing');
    expect(h.played.map((p) => p.pitch)).toEqual([60, 61, 70, 71]);
    await h.run(4);
    expect(h.transport.state.status).toBe('paused');
    expect(h.transport.positionNow()).toBe(0);
    expect(h.ticking()).toBe(false);
  });

  it('plays a piece again with repeat one, and the queue again with repeat all', async () => {
    const one = harness([piece(2), piece(2, 70)]);
    one.transport.setRepeat('one');
    one.transport.setGap(0);
    await one.transport.playQueue([key(0), key(1)]);
    await one.run(2.5);
    expect(one.played.map((p) => p.pitch).slice(0, 4)).toEqual([60, 61, 60, 61]);
    expect(one.transport.state.key).toBe(key(0));

    const all = harness([piece(2), piece(2, 70)]);
    all.transport.setRepeat('all');
    all.transport.setGap(0);
    await all.transport.playQueue([key(0), key(1)]);
    await all.run(3.4);
    expect(all.played.map((p) => p.pitch).slice(0, 6)).toEqual([60, 61, 70, 71, 60, 61]);
  });

  it('plays every piece once in shuffle before any repeats', async () => {
    const h = harness([piece(1), piece(1, 70), piece(1, 80), piece(1, 90)]);
    h.transport.setShuffle(true);
    h.transport.setRepeat('all');
    h.transport.setGap(0);
    await h.transport.playQueue([0, 1, 2, 3].map(key), 1);
    await h.run(2.5);
    const firstFour = h.started.slice(0, 4);
    expect(firstFour[0]).toBe(key(1));
    expect(new Set(firstFour).size).toBe(4);
  });

  it('goes back a piece in its first seconds, and otherwise to its start', async () => {
    const h = harness([piece(16), piece(16, 70)]);
    await h.transport.playQueue([key(0), key(1)], 1);
    await h.run(1);
    await h.transport.previous();
    expect(h.transport.state.key).toBe(key(0));
    expect(h.transport.state.status).toBe('playing');
    await h.run(4);
    await h.transport.previous();
    expect(h.transport.state.key).toBe(key(0));
    expect(h.transport.positionNow()).toBeLessThan(0.1);
  });

  it('pauses and says so when the keyboard goes away', async () => {
    const h = harness([piece(8)]);
    await h.transport.playQueue([key(0)]);
    await h.run(1);
    h.transport.outputLost();
    expect(h.transport.state).toMatchObject({ status: 'paused', message: 'disconnected' });
    expect(h.ticking()).toBe(false);
  });

  it('hands notes over further ahead while the page is hidden', async () => {
    const h = harness([piece(16)], { hidden: true });
    await h.transport.playQueue([key(0)]);
    await h.run(0.05);
    expect(h.played.length).toBe(Math.floor((HIDDEN_LOOK_AHEAD + 0.05 - 0.06) / 0.5) + 1);
  });

  it('keeps to a MIDI output’s shorter look-ahead', async () => {
    const h = harness([piece(16)], { lookAhead: 0.05 });
    await h.transport.playQueue([key(0)]);
    await h.run(2);
    expect(Math.max(...h.played.map((p) => p.when - p.at))).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('changes tempo without a jump', async () => {
    const h = harness([piece(8)]);
    await h.transport.playQueue([key(0)]);
    await h.run(0.7);
    const at = h.transport.positionNow();
    h.transport.setTempo(0.5);
    expect(h.transport.positionNow()).toBeCloseTo(at, 6);
    h.played.length = 0;
    await h.run(1.2);
    // The note at 1 s of the piece, 0.36 s away at full speed, now comes 0.72 s later.
    expect(h.played[0]!.pitch).toBe(62);
    expect(h.played[0]!.duration).toBeCloseTo(1, 6);
  });

  it('cues a queue without playing it, ready for Play and Next', async () => {
    const h = harness([piece(2), piece(2, 70)]);
    await h.transport.cue([key(0), key(1)]);
    expect(h.transport.state).toMatchObject({ status: 'paused', key: key(0) });
    expect(h.played).toEqual([]);
    await h.transport.next();
    expect(h.transport.state.key).toBe(key(1));
    expect(h.transport.state.status).toBe('paused');
  });

  it('a piece that will not load leaves the transport paused with a message', async () => {
    const h = harness([]);
    await h.transport.playQueue([key(3)]);
    expect(h.transport.state).toMatchObject({ status: 'paused', message: 'failed' });
  });
});

describe('this device’s piano on the page’s clock (P6-05)', () => {
  it('turns page times into audio times through the output timestamp', () => {
    const calls: { pitch: number; when: number }[] = [];
    const inner: Instrument = {
      volume: 1,
      noteOn: () => ({ stop: () => {} }),
      play: (pitch, when) => {
        calls.push({ pitch, when });
        return { stop: () => {} };
      },
      click: () => {},
    };
    // The audio clock reads 10 s when the page clock reads 5 s.
    const ctx = {
      currentTime: 9.99,
      getOutputTimestamp: () => ({ contextTime: 10, performanceTime: 5000 }),
    } as unknown as BaseAudioContext;
    onPageClock(inner, ctx).play(60, 6.25, 0.5);
    expect(calls[0]?.when).toBeCloseTo(11.25, 9);
  });
});

describe('the pedals through the transport (P6-10)', () => {
  // Four notes under the sustain pedal until beat 6 (3 s).
  const pedalled: Song = {
    ...piece(4),
    lengthBeats: 8,
    pedals: [
      { beat: 0, pedal: 'sustain', value: 127 },
      { beat: 6, pedal: 'sustain', value: 0 },
    ],
  };

  it('sends the pedal with the notes, and the held lengths', async () => {
    const h = harness([pedalled]);
    await h.transport.playQueue([key(0)]);
    await h.run(0.2);
    expect(h.log.slice(0, 2)).toEqual(['sustain 127', 'note 60']);
    expect(h.played[0]?.held).toBeCloseTo(3, 6);
    await h.run(3.5);
    expect(h.log).toContain('sustain 0');
  });

  it('puts the pedal down first when it seeks into pedalled music', async () => {
    const h = harness([pedalled]);
    await h.transport.playQueue([key(0)]);
    h.log.length = 0;
    h.transport.seek(2.25);
    // Every key is up at 2.25 s, but the pedal still holds all four notes.
    expect(h.log).toEqual(['sustain 127', 'note 60', 'note 61', 'note 62', 'note 63']);
  });
});
