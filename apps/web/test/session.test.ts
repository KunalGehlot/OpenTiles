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
    run(2 + 0.12 - clock.t); // 120 ms after the second
    press(62);
    expect(session.judged.get('n0')).toBe('early');
    expect(session.judged.get('n1')).toBe('late');
    expect(session.labels.map((l) => l.kind)).toEqual(['early', 'late']);
    expect(session.labels[0]?.offsetMs).toBeLessThan(-80);
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
