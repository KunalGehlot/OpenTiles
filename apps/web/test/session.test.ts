// The practice controller with a fake clock and a fake piano: metronome clicks, looping, the
// automatic speed-up and live early/late feedback. Songs are generated here (CC0).
import type { NoteEvent } from '@opentiles/practice';
import type { Song, SongNote } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import type { PianoSynth } from '../src/audio/synth';
import { PracticeSession } from '../src/views/session';
import type { LoopRunReport } from '../src/views/session';

/** Four bars of 4/4 at 120 bpm (0.5 s a beat), one quarter note per beat, C D E F repeating. */
function scale(bars = 4): Song {
  const notes: SongNote[] = Array.from({ length: bars * 4 }, (_, i) => ({
    id: `n${i}`,
    pitch: [60, 62, 64, 65][i % 4] as number,
    startBeat: i,
    durationBeats: 1,
    hand: 'right',
    staff: 1,
    voice: 1,
    part: 0,
    measureIndex: Math.floor(i / 4),
    sourceRefs: [],
  }));
  return {
    title: 'Scale',
    format: 'musicxml',
    notes,
    measures: Array.from({ length: bars }, (_, i) => ({
      index: i,
      number: String(i + 1),
      sourceIndex: i,
      startBeat: i * 4,
      lengthBeats: 4,
    })),
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: bars * 4,
    warnings: [],
  };
}

function setup(song = scale()) {
  const clock = { t: 0 };
  const synth: PianoSynth = {
    volume: 1,
    noteOn: () => ({ stop: () => {} }),
    play: () => ({ stop: () => {} }),
    click: () => {},
  };
  const session = new PracticeSession(song, () => clock.t, synth);
  const clicks: { when: number; accent: boolean }[] = [];
  session.setClickOutput((when, accent) => clicks.push({ when, accent }));
  /** Advances the clock in 1/60 s frames. */
  const run = (seconds: number) => {
    const end = clock.t + seconds;
    while (clock.t < end) {
      clock.t += 1 / 60;
      session.frame();
    }
  };
  const press = (pitch: number, source: NoteEvent['source'] = 'touch') =>
    session.input({ pitch, time: clock.t, confidence: 1, source });
  return { session, clock, clicks, run, press };
}

describe('metronome', () => {
  it('clicks every beat in play-along, accented on the downbeat', () => {
    const { session, clicks, run } = setup();
    session.setMode('play-along');
    session.setMetronome(true);
    session.start();
    clicks.length = 0; // the count-in
    run(1.5 + 2); // lead-in, then one bar
    const bar = clicks.filter((c) => c.when >= 1.5 - 1e-6 && c.when < 3.5 - 1e-6);
    expect(bar.map((c) => c.when)).toEqual([1.5, 2, 2.5, 3].map((x) => expect.closeTo(x, 6)));
    expect(bar.map((c) => c.accent)).toEqual([true, false, false, false]);
  });

  it('keeps a steady click in wait mode at the practice tempo', () => {
    const { session, clicks, run } = setup();
    session.setTempo(0.5);
    session.setMetronome(true);
    run(4);
    // 0.5 s a beat at full speed → 1 s at half speed.
    const gaps = clicks.slice(1).map((c, i) => c.when - (clicks[i]?.when ?? 0));
    expect(clicks.length).toBeGreaterThanOrEqual(4);
    for (const g of gaps) expect(g).toBeCloseTo(1, 6);
    expect(clicks.filter((c) => c.accent).length).toBe(Math.ceil(clicks.length / 4));
  });

  it('is silent when off', () => {
    const { session, clicks, run } = setup();
    run(2);
    expect(clicks).toHaveLength(0);
    expect(session.status().metronome).toBe(false);
  });
});

describe('loop', () => {
  it('limits wait mode to the bars and starts them again after a run', () => {
    const { session, run, press } = setup();
    const runs: LoopRunReport[] = [];
    session.addLoopListener((r) => runs.push(r));
    session.setLoop({ fromMeasure: 1, toMeasure: 1 });
    expect(session.steps.map((s) => s.beat)).toEqual([4, 5, 6, 7]);
    for (const p of [60, 62, 64, 65]) press(p);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ run: 1, clean: true, accuracy: 1 });
    expect(session.status().finished).toBe(false);
    run(1);
    expect(session.wait.index).toBe(0);
    expect(session.wait.stats.correct).toBe(0);
  });

  it('speeds up 5 % after each clean run when asked, up to 100 %', () => {
    const { session, run, press } = setup();
    const tempos: number[] = [];
    session.onTempo = (t) => tempos.push(t);
    session.setTempo(0.9);
    session.autoTempo = true;
    session.setLoop({ fromMeasure: 0, toMeasure: 0 });
    for (let k = 0; k < 3; k++) {
      for (const p of [60, 62, 64, 65]) press(p);
      run(1);
    }
    expect(tempos).toEqual([0.95, 1]);
    expect(session.tempo).toBe(1);
    // A run with a wrong note does not count as clean.
    press(61);
    for (const p of [60, 62, 64, 65]) press(p);
    expect(session.loopTrainer.streak).toBe(0);
  });

  it('loops play-along and reports missed notes', () => {
    const { session, run, press, clock } = setup();
    const runs: LoopRunReport[] = [];
    session.addLoopListener((r) => runs.push(r));
    session.setMode('play-along');
    session.setLoop({ fromMeasure: 0, toMeasure: 0 });
    session.start();
    // Play the first three notes on time and miss the fourth.
    for (const [i, p] of [60, 62, 64].entries()) {
      run(1.5 + i * 0.5 - clock.t);
      press(p);
    }
    run(3.5);
    expect(runs[0]).toMatchObject({ run: 1, clean: false, missed: 1, wrong: 0 });
    expect(session.playing).toBe(true); // going round again
    expect(session.status().finished).toBe(false);
  });

  it('clears back to the whole piece', () => {
    const { session } = setup();
    session.setLoop({ fromMeasure: 2, toMeasure: 3 });
    expect(session.status().loop).toEqual({ fromMeasure: 2, toMeasure: 3 });
    session.setLoop(null);
    expect(session.steps).toHaveLength(16);
  });
});

describe('live timing feedback', () => {
  it('labels early and late notes and colours them by judgement', () => {
    const { session, run, press, clock } = setup();
    session.setMode('play-along');
    session.start();
    run(1.5 - 0.11 - clock.t); // 110 ms before the first note
    press(60);
    run(0.4);
    session.release(60, clock.t);
    run(2 + 0.12 - clock.t); // 120 ms after the second
    press(62);
    expect(session.judged.get('n0')).toBe('early');
    expect(session.judged.get('n1')).toBe('late');
    expect(session.labels.map((l) => l.kind)).toEqual(['early', 'late']);
    expect(session.labels[0]?.offsetMs).toBeLessThan(-80);
    run(0.4);
    session.release(62, clock.t);
    run(1);
    expect(session.labels).toHaveLength(0);
    expect(session.judged.get('n2')).toBe('missed');
  });

  it('takes the measured MIDI latency off MIDI notes', () => {
    const { session, run, press, clock } = setup();
    session.latency = { midi: 0.1 };
    session.setMode('play-along');
    session.start();
    run(1.5 + 0.1 - clock.t);
    press(60, 'midi');
    expect(session.judged.get('n0')).toBe('hit');
  });
});

describe('hold teaching and recording (P4-09)', () => {
  it('judges holds in wait mode: too short, or long enough once the bar has drained', () => {
    const { session, run, press, clock } = setup();
    press(60);
    expect(session.holds.get(60)).toMatchObject({ noteId: 'n0', length: 0.5 });
    run(0.1);
    session.release(60, clock.t);
    expect(session.holds.get(60)?.judgement).toBe('short');
    expect(session.labels.map((l) => l.kind)).toEqual(['short']);
    press(62);
    run(0.6);
    expect(session.holds.get(62)?.judgement).toBe('good');
    // Holding on in wait mode is fine: no "let go".
    run(2);
    session.release(62, clock.t);
    expect(session.status().holds).toEqual({ good: 1, short: 1, long: 0 });
    // Judged bars fade out.
    run(0.5);
    expect(session.holds.size).toBe(0);
  });

  it('makes no holds from the microphone, which cannot hear a key come up', () => {
    const { session, press } = setup();
    press(60, 'microphone');
    expect(session.wait.stats.correct).toBe(1);
    expect(session.holds.size).toBe(0);
  });

  it('says "let go" in play-along when a note is held well past its length', () => {
    const { session, run, press, clock } = setup();
    session.setMode('play-along');
    session.start();
    run(1.5 - clock.t);
    press(60);
    run(0.5);
    expect(session.holds.get(60)?.judgement).toBeUndefined();
    run(0.3);
    expect(session.holds.get(60)?.judgement).toBe('long');
    expect(session.labels.some((l) => l.kind === 'long')).toBe(true);
  });

  it('records a wait-mode run and renders it as played and polished', () => {
    const { session, run, clock } = setup(scale(1));
    const velocities = [100, 50, 70, 90];
    [60, 62, 64, 65].forEach((p, i) => {
      session.input({
        pitch: p,
        time: clock.t,
        velocity: velocities[i],
        confidence: 1,
        source: 'midi',
      });
      run(0.7); // slower than written: wait mode follows the learner
      session.release(p, clock.t);
    });
    const status = session.status();
    expect(status.finished).toBe(true);
    expect(status.recorded).toBe(true);
    const r = session.renderings();
    expect(r?.asPlayed.map((n) => n.time)).toEqual(
      [0, 0.7, 1.4, 2.1].map((x) => expect.closeTo(x, 1)),
    );
    expect(r?.polished).toEqual(
      [60, 62, 64, 65].map((pitch, i) => ({
        pitch,
        time: expect.closeTo(i * 0.5, 6),
        duration: expect.closeTo(0.5, 6),
        velocity: velocities[i],
      })),
    );
    session.rebuild();
    expect(session.renderings()).toBeNull();
  });

  it('adds the other hand to the polished version when it was played along', () => {
    const song = scale(1);
    song.notes = song.notes.map((n, i) => (i % 2 ? { ...n, hand: 'left' as const } : n));
    const { session, press } = setup(song);
    session.setHands('right');
    press(60);
    press(64);
    const r = session.renderings();
    expect(r?.asPlayed).toHaveLength(2);
    expect(r?.polished.map((n) => [n.pitch, n.velocity])).toEqual([
      [60, 80],
      [62, 64],
      [64, 80],
      [65, 64],
    ]);
  });

  it('swaps in a refitted song and starts again', () => {
    const { session, press } = setup();
    press(60);
    const up = {
      ...session.song,
      notes: session.song.notes.map((n) => ({ ...n, pitch: n.pitch + 12 })),
    };
    session.setSong(up);
    expect(session.wait.index).toBe(0);
    expect(session.steps[0]?.pitches).toEqual([72]);
    expect(session.expectedNotes().map((n) => n.id)).toEqual(['n0']);
  });
});

describe('steady clock', () => {
  it('moves evenly although the audio clock moves in steps', async () => {
    const { steadyClock } = await import('../src/views/session');
    let perf = 0;
    let audio = 0;
    const clock = steadyClock(
      () => audio,
      () => perf,
    );
    const seen: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      perf += 1 / 60;
      // The audio clock only advances in 12 ms buffers.
      audio = Math.floor(perf / 0.012) * 0.012;
      seen.push(clock());
    }
    const steps = seen.slice(1).map((t, i) => t - (seen[i] ?? 0));
    for (const step of steps) expect(step).toBeGreaterThanOrEqual(0);
    expect(Math.max(...steps) - Math.min(...steps)).toBeLessThan(0.004);
    // It stays within one buffer of the audio clock.
    expect(Math.abs((seen.at(-1) ?? 0) - audio)).toBeLessThan(0.02);
  });

  it('jumps to the audio clock when it moves far (a pause, or the clock being swapped)', async () => {
    const { steadyClock } = await import('../src/views/session');
    let perf = 0;
    let audio = 0;
    const clock = steadyClock(
      () => audio,
      () => perf,
    );
    clock();
    perf = 1;
    audio = 5;
    expect(clock()).toBe(5);
  });
});

describe('scrubbing (P4-18)', () => {
  it('moves wait mode to the step at the new place and holds the drag position', () => {
    const { session, run, press } = setup();
    press(60);
    run(0.2);
    session.scrubbing = true;
    session.seek(5.5);
    run(0.5);
    // While dragging, the position is exactly where the learner put it.
    expect(session.beat).toBeCloseTo(5.5, 6);
    expect(session.wait.current?.beat).toBe(6);
    session.scrubbing = false;
    // Let go: the step to play is the one at the new place (the display eases to it in real time).
    expect(session.expected()).toEqual([64]);
    // Notes from there on are not marked done; the first one played still is.
    expect(session.done.has('n6')).toBe(false);
    expect(session.done.has('n0')).toBe(true);
  });

  it('stops a playing run and starts again from the new place', () => {
    const { session, run } = setup();
    session.setMode('listen');
    session.start();
    run(3);
    expect(session.playing).toBe(true);
    session.seek(8);
    expect(session.playing).toBe(false);
    expect(session.beat).toBe(8);
    session.start();
    run(1.5); // the lead-in
    expect(session.beat).toBeGreaterThanOrEqual(8);
    expect(session.beat).toBeLessThan(9);
  });

  it('keeps the position inside the piece', () => {
    const { session } = setup();
    session.seek(-3);
    expect(session.beat).toBe(0);
    session.seek(1000);
    expect(session.beat).toBe(16);
    // Past the last step, wait mode waits on the last note instead of finishing the run.
    expect(session.wait.finished).toBe(false);
  });
});

describe('after a run (P5-09)', () => {
  /** Runs `seconds` of frames and returns the beat after each one. */
  const trace = (h: ReturnType<typeof setup>, seconds: number) => {
    const beats: number[] = [];
    const end = h.clock.t + seconds;
    while (h.clock.t < end) {
      h.run(1 / 60);
      beats.push(h.session.beat);
    }
    return beats;
  };

  it('glides back to the start as a drag would, keeping the result', () => {
    const h = setup();
    h.session.setMode('play-along');
    h.session.start();
    h.run(1.5 + 8 + 0.4); // lead-in, 16 beats, a moment after the last note
    expect(h.session.status().finished).toBe(true);
    const last = h.session.beat;
    expect(last).toBeGreaterThan(15);
    const beats = trace(h, 3);
    // It rests on the last note for a moment, then moves back without a jump and lands on the start.
    expect(beats.slice(0, 30).every((b) => b === last)).toBe(true);
    const steps = beats.slice(1).map((b, i) => b - (beats[i] as number));
    expect(steps.every((d) => d <= 1e-9)).toBe(true);
    expect(Math.max(...steps.map((d) => -d))).toBeLessThan(1);
    expect(steps.filter((d) => d < -1e-6).length).toBeGreaterThan(30);
    expect(beats.at(-1)).toBe(0);
    // The run's result stays on screen while the position goes home.
    expect(h.session.returning).toBe(true);
    expect(h.session.status().finished).toBe(true);
  });

  it('jumps straight back under Reduce motion', () => {
    const h = setup();
    h.session.glideHome = false;
    h.session.setMode('listen');
    h.session.start();
    h.run(1.5 + 8 + 0.4);
    const beats = trace(h, 2);
    const moved = beats.filter((b, i) => i > 0 && b !== beats[i - 1]);
    expect(moved).toEqual([0]);
  });

  it('glides back after a wait-mode run too', () => {
    const h = setup(scale(2));
    for (const p of [60, 62, 64, 65, 60, 62, 64, 65]) {
      h.press(p);
      h.run(0.3);
      h.session.release(p, h.clock.t);
    }
    expect(h.session.status().finished).toBe(true);
    const beats = trace(h, 3);
    const from = beats.findIndex((b, i) => i > 0 && b < (beats[i - 1] as number) - 1e-6);
    expect(from).toBeGreaterThan(0);
    const back = beats.slice(from - 1);
    expect(back.every((b, i) => i === 0 || b <= (back[i - 1] as number) + 1e-9)).toBe(true);
    expect(beats.at(-1)).toBe(0);
  });

  it('lets a drag take over from the glide', () => {
    const h = setup();
    h.session.setMode('listen');
    h.session.start();
    h.run(1.5 + 8 + 0.4);
    h.run(1.4); // the glide has begun
    expect(h.session.returning).toBe(true);
    h.session.seek(6);
    h.run(1);
    expect(h.session.beat).toBe(6);
    expect(h.session.returning).toBe(false);
  });
});

describe('key strikes (P5-09)', () => {
  it('marks every press, so a repeated note dips the key again', () => {
    const { session, clock, run, press } = setup();
    press(60);
    const first = clock.t;
    expect(session.strikes.get(60)).toBe(first);
    run(0.1);
    session.release(60, clock.t);
    run(0.05);
    press(60);
    expect(session.strikes.get(60)).toBeGreaterThan(first);
    expect(session.strikes.get(60)).toBe(clock.t);
  });

  it('strikes the keys of a listen run as their notes start, a repeated pitch included', () => {
    const song = scale(1);
    song.notes = song.notes.map((n, i) => ({ ...n, pitch: [64, 64, 65, 67][i] as number }));
    const { session, run } = setup(song);
    session.setMode('listen');
    session.start();
    run(1.5 + 0.1); // lead-in, then just into the first note
    expect(session.strikes.get(64)).toBeCloseTo(1.5, 6);
    run(0.5); // into the second E
    expect(session.strikes.get(64)).toBeCloseTo(2, 6);
    expect(session.strikes.has(65)).toBe(false);
  });
});

describe('MIDI keys on this device', () => {
  it('echoes MIDI notes on this device when asked, and stops them on release', () => {
    const { session, clock } = setup();
    const log: string[] = [];
    session.midiEcho = {
      volume: 1,
      noteOn: (p) => {
        log.push(`on ${p}`);
        return { stop: () => log.push(`off ${p}`) };
      },
      play: () => ({ stop: () => {} }),
      click: () => {},
    };
    session.input({ pitch: 60, time: clock.t, confidence: 1, source: 'midi' });
    session.input({ pitch: 64, time: clock.t, confidence: 1, source: 'touch' });
    session.release(60);
    expect(log).toEqual(['on 60', 'off 60']);
    session.midiEcho = null;
    session.input({ pitch: 62, time: clock.t, confidence: 1, source: 'midi' });
    expect(log).toHaveLength(2);
  });
});

describe('live stats (P5-07)', () => {
  it('count wait-mode notes: right at the first try is perfect, after a wrong key good', () => {
    const { session, press } = setup();
    press(60);
    press(63); // wrong: D expected
    press(62);
    press(64);
    expect(session.status().live).toEqual({
      perfect: 2,
      good: 1,
      missed: 0,
      wrong: 1,
      streak: 2,
      bestStreak: 2,
    });
    session.rebuild();
    expect(session.status().live.perfect).toBe(0);
  });

  it('count play-along notes: on time is perfect, early or late good, and misses', () => {
    const { session, run, press, clock } = setup();
    session.setMode('play-along');
    session.start();
    run(1.5 - clock.t);
    press(60); // on time
    run(2 + 0.12 - clock.t);
    press(62); // late
    run(1); // the third note goes by
    expect(session.status().live).toMatchObject({
      perfect: 1,
      good: 1,
      missed: expect.any(Number),
      streak: 0,
      bestStreak: 2,
    });
    expect(session.status().live.missed).toBeGreaterThanOrEqual(1);
    session.start();
    expect(session.status().live.bestStreak).toBe(0);
  });
});

describe('last input', () => {
  it('records when the learner last played a note, from any input (P5-02)', () => {
    const { session, clock, run, press } = setup();
    expect(session.lastInputAt).toBe(0);
    run(2);
    press(60, 'midi');
    expect(session.lastInputAt).toBe(clock.t);
    run(1);
    press(62, 'microphone');
    expect(session.lastInputAt).toBe(clock.t);
  });
});

describe('the clock switching to the audio clock', () => {
  it('keeps a wait-mode run right when sound starts mid-run', () => {
    const { session, clock, run, press } = setup(scale(1));
    let seconds = -1;
    session.onFinish = (_, s) => (seconds = s);
    // Played on the page's clock (a MIDI keyboard, before any tap).
    clock.t = 100;
    press(61);
    expect(session.keys.get(61)).toBe('wrong');
    press(60);
    // Sound starts: the audio clock begins near zero.
    clock.t = 0.2;
    run(0.5);
    expect(session.flashes).toEqual([]);
    expect(session.keys.get(61)).toBe('held');
    expect(session.strikes.get(60)).toBeCloseTo(0.2, 1);
    for (const p of [62, 64, 65]) {
      press(p);
      run(0.2);
    }
    expect(session.status().finished).toBe(true);
    // From the first key to the last: 0.5 s since the switch and 0.4 s of presses.
    expect(seconds).toBeGreaterThan(0.5);
    expect(seconds).toBeLessThan(1.5);
    expect(session.renderings()?.asPlayed.map((n) => n.pitch)).toEqual([61, 60, 62, 64, 65]);
  });
});

describe('playback through the shared scheduler (P6-03)', () => {
  function playing(lookAhead?: number) {
    const clock = { t: 0 };
    const played: { pitch: number; when: number; duration: number; at: number }[] = [];
    const synth: PianoSynth = {
      volume: 1,
      noteOn: () => ({ stop: () => {} }),
      play: (pitch, when, duration) => {
        played.push({ pitch, when, duration, at: clock.t });
        return { stop: () => {} };
      },
      click: () => {},
      ...(lookAhead === undefined ? {} : { lookAhead }),
    };
    const session = new PracticeSession(scale(1), () => clock.t, synth);
    const run = (seconds: number) => {
      const end = clock.t + seconds;
      while (clock.t < end) {
        clock.t += 1 / 60;
        session.frame();
      }
    };
    return { session, played, run, clock };
  }

  it('plays every note of a listen run once, on time, at the practice tempo', () => {
    const { session, played, run } = playing();
    session.setMode('listen');
    session.setTempo(0.5);
    session.start();
    run(1.5 + 4.5);
    // After the 1.5 s lead-in, a beat lasts a second at half speed.
    expect(played.map((p) => [p.pitch, p.when, p.duration])).toEqual(
      [
        [60, 1.5, 1],
        [62, 2.5, 1],
        [64, 3.5, 1],
        [65, 4.5, 1],
      ].map(([pitch, when, duration]) => [pitch, expect.closeTo(when ?? 0, 6), duration]),
    );
    // Handed over up to 0.3 s ahead.
    expect(Math.max(...played.map((p) => p.when - p.at))).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it('hands notes over less far ahead to an instrument that asks for it', () => {
    const { session, played, run } = playing(0.1);
    session.setMode('listen');
    session.start();
    run(1.5 + 2);
    expect(played).toHaveLength(4);
    expect(Math.max(...played.map((p) => p.when - p.at))).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('plays the other hand in play-along only when asked to', () => {
    const { session, played, run } = playing();
    session.setMode('play-along');
    session.setHands('left');
    session.accompany = false;
    session.start();
    run(1.5 + 2);
    expect(played).toEqual([]);
    session.accompany = true;
    session.start();
    run(1.5 + 2);
    expect(played.map((p) => p.pitch)).toEqual([60, 62, 64, 65]);
  });

  it('lets the other hand join or stop in the middle of a play-along run', () => {
    const { session, played, run } = playing();
    session.setMode('play-along');
    session.setHands('left');
    session.accompany = false;
    session.start();
    run(1.5 + 0.8);
    expect(played).toEqual([]);
    // Turned on halfway: the notes still to come play, on time.
    session.accompany = true;
    run(0.3);
    expect(played.map((p) => [p.pitch, p.when])).toEqual([[64, expect.closeTo(2.5, 6)]]);
    session.accompany = false;
    run(1);
    expect(played).toHaveLength(1);
  });

  it('plays the other hand in wait mode as each step is played, only when asked to', () => {
    const { session, played, clock } = playing();
    // A left hand under the scale: C3 for two beats, then G2 for two.
    const left = (id: string, pitch: number, startBeat: number): SongNote => ({
      id,
      pitch,
      startBeat,
      durationBeats: 2,
      hand: 'left',
      staff: 2,
      voice: 1,
      part: 0,
      measureIndex: 0,
      sourceRefs: [],
    });
    session.setSong({
      ...session.song,
      notes: [...session.song.notes, left('l0', 48, 0), left('l1', 43, 2)],
    });
    session.setHands('right');
    const press = (pitch: number) =>
      session.input({ pitch, time: clock.t, confidence: 1, source: 'midi' });
    clock.t = 1;
    press(60);
    expect(played).toEqual([{ pitch: 48, when: 1, duration: 1, at: 1 }]);
    clock.t = 2;
    press(62);
    expect(played).toHaveLength(1);
    clock.t = 4;
    press(64);
    expect(played.at(-1)).toEqual({ pitch: 43, when: 4, duration: 1, at: 4 });
    session.accompany = false;
    session.rebuild();
    press(60);
    expect(played).toHaveLength(2);
  });
});

describe('the count-in (P6-20)', () => {
  /** The scale in the right hand from beat 2, under a left-hand opening on beats 0 and 1. */
  function withOpening(): Song {
    const song = scale(1);
    const left = (id: string, pitch: number, startBeat: number): SongNote => ({
      id,
      pitch,
      startBeat,
      durationBeats: 1,
      hand: 'left',
      staff: 2,
      voice: 1,
      part: 0,
      measureIndex: 0,
      sourceRefs: [],
    });
    song.notes = [
      left('l0', 48, 0),
      left('l1', 50, 1),
      ...song.notes.filter((n) => n.startBeat >= 2),
    ];
    return song;
  }

  function counting(song = withOpening()) {
    const clock = { t: 10 };
    const played: { pitch: number; when: number }[] = [];
    const synth: PianoSynth = {
      volume: 1,
      noteOn: () => ({ stop: () => {} }),
      play: (pitch, when) => {
        played.push({ pitch, when });
        return { stop: () => {} };
      },
      click: () => {},
    };
    const session = new PracticeSession(song, () => clock.t, synth);
    session.countIn = true;
    const run = (seconds: number) => {
      const end = clock.t + seconds;
      while (clock.t < end - 1e-9) {
        clock.t += 1 / 60;
        session.frame();
      }
    };
    const press = (pitch: number) =>
      session.input({ pitch, time: clock.t, confidence: 1, source: 'midi' });
    return { session, clock, played, run, press };
  }

  it('counts 3, 2, 1, plays the other hand’s opening in time and waits at the first note', () => {
    const { session, played, run } = counting();
    session.setHands('right');
    expect(session.status().countdown).toBe(3);
    // The first note of the piece is three seconds away.
    expect(session.beat).toBeCloseTo(-6, 1);
    run(1.1);
    expect(session.status().countdown).toBe(2);
    run(1);
    expect(session.status().countdown).toBe(1);
    run(1);
    expect(session.status().countdown).toBeNull();
    run(1.5);
    expect(played.map((p) => [p.pitch, p.when])).toEqual([
      [48, expect.closeTo(13, 6)],
      [50, expect.closeTo(13.5, 6)],
    ]);
    // Waiting at the right hand's first note (beat 2; the picture's clock runs on real time here),
    // and nothing more plays.
    expect(session.beat).toBeGreaterThan(1.7);
    expect(session.beat).toBeLessThanOrEqual(2);
    run(2);
    expect(played).toHaveLength(2);
    expect(session.wait.index).toBe(0);
  });

  it('waits for a tap when the opening would play unheard', () => {
    const { session, played, run } = counting();
    let ready = false;
    session.soundReady = () => ready;
    session.setHands('right');
    expect(session.status()).toMatchObject({ countdown: null, tapToStart: true });
    run(4);
    expect(played).toEqual([]);
    ready = true;
    session.startCountIn();
    expect(session.status()).toMatchObject({ countdown: 3, tapToStart: false });
  });

  it('needs no sound when there is no opening to play', () => {
    const { session } = counting(scale(1));
    session.soundReady = () => false;
    session.rebuild();
    expect(session.status()).toMatchObject({ countdown: 3, tapToStart: false });
  });

  it('starts the run at once when the first note is played during the count-in', () => {
    const { session, played, run, press } = counting();
    session.setHands('right');
    run(1);
    press(64);
    expect(session.wait.index).toBe(1);
    expect(session.status().countdown).toBeNull();
    run(3);
    // No opening after the run began.
    expect(played.every((p) => p.pitch !== 48 && p.pitch !== 50)).toBe(true);
  });

  it('counts in again before each round of a loop', () => {
    const { session, run, press } = counting(scale(2));
    session.setLoop({ fromMeasure: 0, toMeasure: 0 });
    run(3.1);
    for (const p of [60, 62, 64, 65]) press(p);
    run(0.7);
    expect(session.status().countdown).toBe(3);
  });

  it('counts in for three seconds in play-along, from the other hand’s opening', () => {
    const { session, played, run } = counting();
    session.setMode('play-along');
    session.setHands('right');
    session.start();
    expect(session.status().countdown).toBe(3);
    run(3.3);
    expect(played[0]).toEqual({ pitch: 48, when: expect.closeTo(13, 6) });
  });

  it('leaves Listen with its short lead-in and no numbers', () => {
    const { session } = counting();
    session.setMode('listen');
    session.start();
    expect(session.status().countdown).toBeNull();
  });
});
