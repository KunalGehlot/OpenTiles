// A scale drill in the practice session (P7-18, P7-20): whole scales judged in wait mode and at a
// tempo, evenness, the tonic-only key hint, and "Show me" for the whole scale. The drill is
// generated here (CC0).
import { DOMParser } from '@xmldom/xmldom';
import {
  generateScaleDrill,
  normaliseScaleDrillOptions,
  pitchClassOf,
  scaleSteps,
} from '@opentiles/practice';
import type { NoteEvent, ScaleDrillOptions } from '@opentiles/practice';
import { parseMusicXml } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import type { PianoSynth } from '../src/audio/synth';
import { PracticeSession } from '../src/views/session';

type DomParser = NonNullable<Parameters<typeof parseMusicXml>[1]>['domParser'];

function setup(o: Partial<ScaleDrillOptions> = {}) {
  const drill = generateScaleDrill(
    normaliseScaleDrillOptions({
      level: 'custom',
      set: { tonics: [0, 7], kinds: ['major'] },
      count: 2,
      seed: 4,
      ...o,
    }),
  );
  const song = parseMusicXml(drill.musicxml, {
    domParser: new DOMParser() as unknown as DomParser,
  });
  const clock = { t: 0 };
  const synth: PianoSynth = {
    volume: 1,
    noteOn: () => ({ stop: () => {} }),
    play: () => ({ stop: () => {} }),
    click: () => {},
  };
  const session = new PracticeSession(song, () => clock.t, synth);
  const steps = scaleSteps(drill);
  session.scaleDrill = {
    steps,
    tonics: steps.map((s) => pitchClassOf(drill.scales[s.scale]!.scale.tonic)),
    spread: 0.12,
  };
  session.judgeHolds = false;
  session.rebuild();
  const run = (seconds: number) => {
    const end = clock.t + seconds;
    while (clock.t < end) {
      clock.t += 1 / 60;
      session.frame();
    }
  };
  const press = (pitch: number, source: NoteEvent['source'] = 'midi') =>
    session.input({ pitch, time: clock.t, confidence: 1, source });
  return { drill, steps, session, clock, run, press };
}

describe('a scale drill in wait mode', () => {
  it('judges each scale as a run, with the cause of a wrong key and its evenness', () => {
    const { session, steps, clock, press } = setup();
    let finished = -1;
    session.onFinish = () => {
      finished = session.scales.attempts.length;
    };
    steps.forEach((s, i) => {
      clock.t = 1 + i * 0.5;
      // A natural for the key's sharp in the second scale (G major's F♯).
      if (s.scale === 1 && s.degree === 6 && s.direction === 'up') press(s.pitches[0]! - 1);
      for (const p of s.pitches) press(p);
    });
    expect(finished).toBe(2);
    const [first, second] = session.scales.attempts;
    expect(first).toMatchObject({ index: 0, firstTry: true, causes: [] });
    expect(first?.evenness).toBeCloseTo(0, 5);
    expect(second).toMatchObject({ index: 1, firstTry: false, causes: ['key'] });
    expect(session.status().scales).toMatchObject({ judged: 2, firstTry: 1, perMinute: 120 });
    session.rebuild();
    expect(session.status().scales).toMatchObject({ judged: 0 });
  });

  it('shows the whole scale asked for and counts it as a miss', () => {
    const { session, steps, press } = setup();
    session.hideAhead = true;
    for (const p of steps[0]!.pitches) press(p);
    session.revealScale();
    expect(session.status().revealed).toBe(true);
    expect(session.revealed).toBe(1);
    expect(steps[session.revealedTo]?.scale).toBe(0);
    expect(steps[session.revealedTo + 1]?.scale).toBe(1);
    for (const s of steps.filter((x) => x.scale === 0).slice(1))
      for (const p of s.pitches) press(p);
    expect(session.scales.attempts[0]).toMatchObject({ firstTry: false, causes: ['shown'] });
    expect(session.status().revealed).toBe(false);
  });

  it('lights every note, only the tonic, or none', () => {
    const { session, drill } = setup({ hands: 'together' });
    expect(session.litNotes().length).toBe(2);
    session.keyHint = 'root';
    expect(session.litNotes().length).toBe(2); // the tonic in each hand
    session.input({
      pitch: drill.scales[0]!.lower[0]!.midi,
      time: 0,
      confidence: 1,
      source: 'midi',
    });
    session.input({
      pitch: drill.scales[0]!.upper[0]!.midi,
      time: 0,
      confidence: 1,
      source: 'midi',
    });
    expect(session.litNotes()).toEqual([]);
    session.keyHint = 'all';
    expect(session.litNotes().length).toBe(2);
  });
});

describe('a scale drill at a tempo', () => {
  it('judges a scale clean when every note comes on time, and misses the one not finished', () => {
    const { session, steps, clock, run, press } = setup({ tempo: 120 });
    session.setMode('play-along');
    session.start();
    // 120 crotchets a minute: a note every half second after the lead-in.
    const lead = 1.5;
    const first = steps.filter((s) => s.scale === 0);
    first.forEach((s, i) => {
      run(lead + i * 0.5 - clock.t);
      for (const p of s.pitches) press(p);
    });
    run(30);
    const attempts = [...session.scales.attempts].sort((a, b) => a.index - b.index);
    expect(attempts.map((a) => a.firstTry)).toEqual([true, false]);
    expect(attempts[1]?.causes).toContain('missing');
    expect(attempts[0]?.evenness).toBeLessThan(0.12);
  });
});
