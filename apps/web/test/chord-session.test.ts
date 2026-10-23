// A chord drill in the practice session (P7-03, P7-05, P7-06): whole chords judged in wait mode
// and at a tempo, the root-only key hint, and "Show me". The drill is generated here (CC0).
import { DOMParser } from '@xmldom/xmldom';
import { generateChordDrill, CHORD_DRILL_DEFAULTS, pitchClassOf } from '@opentiles/practice';
import type { ChordDrillOptions, NoteEvent } from '@opentiles/practice';
import { parseMusicXml } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import type { PianoSynth } from '../src/audio/synth';
import { PracticeSession } from '../src/views/session';

type DomParser = NonNullable<Parameters<typeof parseMusicXml>[1]>['domParser'];

function setup(o: Partial<ChordDrillOptions> = {}) {
  const drill = generateChordDrill({ ...CHORD_DRILL_DEFAULTS, level: 3, count: 4, seed: 9, ...o });
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
  session.chordDrill = {
    kinds: drill.chords.map((c) => `${pitchClassOf(c.chord.root)}.${c.chord.quality}`),
    roots: drill.chords.map((c) => pitchClassOf(c.chord.root)),
    spread: 0.12,
  };
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
  const pitches = (i: number) =>
    [...(drill.chords[i]?.lower ?? []), ...(drill.chords[i]?.upper ?? [])].map((n) => n.midi);
  return { drill, session, clock, run, press, pitches };
}

describe('a chord drill in wait mode', () => {
  it('judges whole chords: right at the first try, timed, and the cause of a miss', () => {
    const { session, clock, press, pitches } = setup();
    clock.t = 1;
    for (const p of pitches(0)) press(p);
    clock.t = 3;
    press(pitches(1)[0]! + 1); // a semitone off
    for (const p of pitches(1)) press(p);
    expect(session.status().chords).toMatchObject({ judged: 2, firstTry: 1 });
    const [first, second] = session.chords.attempts;
    expect(first).toMatchObject({ index: 0, firstTry: true, seconds: 0 });
    expect(second).toMatchObject({ index: 1, firstTry: false, seconds: 2 });
    expect(second?.causes.length).toBe(1);
    session.rebuild();
    expect(session.status().chords).toMatchObject({ judged: 0 });
  });

  it('has judged every chord when the run ends', () => {
    const { session, press, pitches } = setup();
    let judged = -1;
    session.onFinish = () => {
      judged = session.chords.attempts.length;
    };
    for (let i = 0; i < 4; i++) for (const p of pitches(i)) press(p);
    expect(judged).toBe(4);
  });

  it('shows the chord asked for and counts it as a miss', () => {
    const { session, press, pitches } = setup();
    session.hideAhead = true;
    session.revealChord();
    expect(session.status().revealed).toBe(true);
    for (const p of pitches(0)) press(p);
    expect(session.chords.attempts[0]).toMatchObject({ firstTry: false, causes: ['missing'] });
    expect(session.status().revealed).toBe(false);
  });

  it('lights all keys, only the root, or none', () => {
    const { session, drill } = setup({ hands: 'both' });
    const root = pitchClassOf(drill.chords[0]!.chord.root);
    expect(session.litNotes().length).toBe(drill.chords[0]!.upper.length + 1);
    session.keyHint = 'root';
    const lit = session.litNotes();
    expect(lit.length).toBe(2); // the root in each hand
    expect(lit.every((n) => n.pitch % 12 === root)).toBe(true);
    session.keyHint = 'none';
    expect(session.litNotes()).toEqual([]);
    session.keyHint = 'all';
    session.guide = 'none';
    expect(session.litNotes()).toEqual([]);
  });
});

describe('a chord drill at a tempo', () => {
  it('counts a chord right when its notes land together and on time', () => {
    const { session, clock, run, press, pitches } = setup({ tempo: 60 });
    session.setMode('play-along');
    session.start();
    // 60 beats a minute: a chord every four seconds after the lead-in.
    const lead = 1.5;
    run(lead - 0.01);
    for (const p of pitches(0)) press(p);
    run(4);
    // The second chord spread over 140 ms, each note in its window: complete but not together.
    pitches(1).forEach((p, i) => {
      clock.t = lead + 4 + i * 0.07;
      press(p);
    });
    // The third chord with an extra key.
    clock.t = lead + 8;
    press(pitches(2)[0]! - 2);
    for (const p of pitches(2)) press(p);
    // The fourth chord is not played.
    run(8);
    const attempts = [...session.chords.attempts].sort((a, b) => a.index - b.index);
    expect(attempts.map((a) => a.firstTry)).toEqual([true, false, false, false]);
    expect(attempts[3]?.causes).toEqual(['missing']);
    expect(attempts[1]?.causes).toEqual([]);
    expect(attempts[2]?.causes.length).toBe(1);
  });
});
