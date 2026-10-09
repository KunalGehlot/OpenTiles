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
