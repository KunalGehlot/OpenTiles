// Expressive playing (P6-16): the automatic sustain pedal and the shaped touch. Songs are generated
// here (CC0).
import type { PedalEvent, Song, SongNote } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import {
  autoPedal,
  expressivePedals,
  expressiveVelocities,
  harmonyChanges,
} from '../src/expression';
import { buildPlayback } from '../src/playback';
import type { PlaybackNote } from '../src/playback';
import { touchVelocities } from '../src/touch';

type Spec = [pitch: number, startBeat: number, durationBeats: number, hand: 'left' | 'right'];

function song(specs: Spec[], bars: number, bpm = 120, velocity?: number): Song {
  const notes: SongNote[] = specs
    .map(([pitch, startBeat, durationBeats, hand]) => ({
      id: '',
      pitch,
      startBeat,
      durationBeats,
      hand,
      staff: hand === 'right' ? 1 : 2,
      voice: 1,
      part: 0,
      measureIndex: Math.floor(startBeat / 4),
      sourceRefs: [],
      ...(velocity === undefined ? {} : { velocity }),
    }))
    .sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
    .map((n, i) => ({ ...n, id: `n${i}` }));
  return {
    title: 't',
    format: 'musicxml',
    notes,
    measures: Array.from({ length: bars }, (_, i) => ({
      index: i,
      number: String(i + 1),
      sourceIndex: i,
      startBeat: i * 4,
      lengthBeats: 4,
    })),
    tempos: [{ beat: 0, bpm }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [],
    parts: [],
    lengthBeats: bars * 4,
    warnings: [],
  };
}

/** Eighth notes cycling through `pitches` from `from` for `beats` beats, in the left hand. */
function alberti(pitches: number[], from: number, beats = 4): Spec[] {
  return Array.from({ length: beats * 2 }, (_, i): Spec => [
    pitches[i % pitches.length] as number,
    from + i / 2,
    0.5,
    'left',
  ]);
}

/** [down beat, up beat] spans of the sustain pedal. */
function spans(events: PedalEvent[]): [number, number][] {
  const out: [number, number][] = [];
  let down: number | null = null;
  for (const e of events) {
    if (e.pedal !== 'sustain') continue;
    if (e.value >= 64 && down === null) down = e.beat;
    else if (e.value < 64 && down !== null) {
      out.push([down, e.beat]);
      down = null;
    }
  }
  expect(down).toBeNull();
  return out;
}

const notesOf = (s: Song) =>
  buildPlayback(s, { expressive: true }).filter((e): e is PlaybackNote => e.kind === 'note');

describe('automatic sustain pedal (P6-16)', () => {
  // C major as an Alberti bass (C G E G) under a melody, then G7 (B G D G, with F).
  const cToG7 = song(
    [
      ...alberti([48, 55, 52, 55], 0),
      ...alberti([47, 55, 50, 53], 4),
      [72, 0, 2, 'right'],
      [76, 2, 2, 'right'],
      [74, 4, 2, 'right'],
      [77, 6, 2, 'right'],
    ],
    2,
  );

  it('hears one harmony per bar under an Alberti bass', () => {
    expect(harmonyChanges(cToG7)).toEqual([0, 4]);
  });

  it('changes the pedal with the harmony, just after the new bass, and lifts at the end', () => {
    const s = spans(autoPedal(cToG7));
    // 0.1 s after each change is 0.2 beats at 120 bpm.
    expect(s.map(([d, u]) => [d, u])).toEqual([
      [expect.closeTo(0.2, 6), 4],
      [expect.closeTo(4.2, 6), 8],
    ]);
  });

  it('holds the notes of a harmony on this device too, and not into the next one', () => {
    const notes = notesOf(cToG7);
    const c = notes.find((n) => n.pitch === 48);
    // The bass C (key up after an eighth) rings to the end of its bar: 2 s at 120 bpm.
    expect(c?.held).toBeCloseTo(2, 6);
    for (const n of notes) if (n.start < 2) expect(n.held).toBeLessThanOrEqual(2 + 1e-9);
  });

  it('sends the lift at the end, so the keyboard is not left with the pedal down', () => {
    const pedals = buildPlayback(cToG7, { expressive: true }).filter((e) => e.kind === 'pedal');
    expect(pedals.at(-1)).toMatchObject({ pedal: 'sustain', value: 0, start: 4 });
  });

  it('changes the pedal for each step of a slow scale over a held chord', () => {
    // A whole-bar C major chord, and C D E F G in the right hand, one a second (60 bpm).
    const scale = song(
      [
        [48, 0, 4, 'left'],
        [52, 0, 4, 'left'],
        [55, 0, 4, 'left'],
        ...[60, 62, 64, 65].map((p, i): Spec => [p, i, 1, 'right']),
        [67, 4, 4, 'right'],
      ],
      2,
      60,
    );
    const melody = notesOf(scale).filter((n) => n.pitch >= 60);
    for (let i = 1; i < melody.length; i++) {
      const before = melody[i - 1] as PlaybackNote;
      const now = melody[i] as PlaybackNote;
      // Nothing a step away keeps sounding once the next note starts.
      expect(before.held).toBeLessThanOrEqual(now.start + 1e-9);
    }
  });

  it('keeps the foot up in a fast run, where it could not change in time', () => {
    // Sixteenths up and down a C major scale in both hands, 120 bpm (an eighth of a second each).
    const run: Spec[] = [];
    const scale = [60, 62, 64, 65, 67, 69, 71, 72];
    for (let i = 0; i < 32; i++) {
      const p = scale[i % 16 < 8 ? i % 8 : 7 - (i % 8)] as number;
      run.push([p, i / 4, 0.25, 'right'], [p - 24, i / 4, 0.25, 'left']);
    }
    const s = spans(autoPedal(song(run, 2)));
    const down = s.reduce((sum, [d, u]) => sum + (u - d), 0);
    expect(down).toBeLessThan(1);
  });

  it('lifts in a rest of both hands', () => {
    const rest = song(
      [
        [48, 0, 2, 'left'],
        [64, 0, 2, 'right'],
        // Beats 2–4: nothing.
        [53, 4, 4, 'left'],
        [65, 4, 4, 'right'],
      ],
      2,
    );
    const s = spans(autoPedal(rest));
    expect(s).toHaveLength(2);
    // Up a little into the rest (a short ring), down again after the next notes.
    expect(s[0]?.[1]).toBeGreaterThan(2);
    expect(s[0]?.[1]).toBeLessThanOrEqual(2.25 + 1e-9);
    expect(s[1]?.[0]).toBeGreaterThan(4);
  });

  it("keeps a file's own sustain pedal, and adds the automatic one only where there is none", () => {
    const own: Song = {
      ...cToG7,
      pedals: [
        { beat: 0, pedal: 'sustain', value: 127 },
        { beat: 8, pedal: 'sustain', value: 0 },
      ],
    };
    expect(expressivePedals(own)).toBe(own.pedals);
    const softOnly: Song = { ...cToG7, pedals: [{ beat: 0, pedal: 'soft', value: 127 }] };
    const pedals = expressivePedals(softOnly);
    expect(pedals[0]).toEqual({ beat: 0, pedal: 'soft', value: 127 });
    expect(pedals.filter((e) => e.pedal === 'sustain').length).toBeGreaterThan(0);
  });

  it('leaves practice as it was: no automatic pedal without "expressive"', () => {
    expect(buildPlayback(cToG7).some((e) => e.kind === 'pedal')).toBe(false);
  });
});

describe('expressive touch (P6-16)', () => {
  // Four bars: a melody rising to its highest note in bar 3 and falling, over a bass and chords.
  const phrase = song(
    [
      ...[67, 69, 71, 72, 74, 76, 77, 79, 81, 79, 77, 76, 74, 72, 71, 67].map((p, i): Spec => [
        p,
        i,
        1,
        'right',
      ]),
      ...[0, 4, 8, 12].flatMap((b): Spec[] => [
        [43, b, 1, 'left'],
        [55, b + 1, 1, 'left'],
        [59, b + 1, 1, 'left'],
        [55, b + 3, 1, 'left'],
        [59, b + 3, 1, 'left'],
      ]),
    ],
    4,
  );
  const v = expressiveVelocities(phrase);
  const at = (pitch: number, beat: number) =>
    v.get(phrase.notes.find((n) => n.pitch === pitch && n.startBeat === beat)?.id ?? '') ?? 0;

  it('sings the melody clearly over the accompaniment', () => {
    const melody = phrase.notes.filter((n) => n.hand === 'right').map((n) => v.get(n.id) ?? 0);
    const chords = phrase.notes.filter((n) => n.pitch >= 55 && n.hand === 'left');
    const loudestChord = Math.max(...chords.map((n) => v.get(n.id) ?? 0));
    expect(Math.min(...melody)).toBeGreaterThanOrEqual(loudestChord - 4);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(melody) - mean(chords.map((n) => v.get(n.id) ?? 0))).toBeGreaterThan(18);
  });

  it('grows towards the phrase’s highest note and settles at its end', () => {
    // Downbeats, so the metre adds the same to each.
    expect(at(74, 4)).toBeGreaterThan(at(67, 0));
    expect(at(81, 8)).toBeGreaterThan(at(74, 4));
    expect(at(74, 12)).toBeLessThan(at(81, 8) - 6);
    expect(at(67, 15)).toBeLessThan(at(74, 12));
  });

  it('spans a much wider range than natural touch', () => {
    const range = (m: Map<string, number>) => Math.max(...m.values()) - Math.min(...m.values());
    expect(range(v)).toBeGreaterThan(range(touchVelocities(phrase)) + 15);
  });

  it("keeps a performance's own velocities, and reshapes a file that gives every note one", () => {
    const performed = song(
      [
        [60, 0, 1, 'right'],
        [64, 1, 1, 'right'],
      ],
      1,
    );
    performed.notes[0] = { ...(performed.notes[0] as SongNote), velocity: 40 };
    performed.notes[1] = { ...(performed.notes[1] as SongNote), velocity: 90 };
    expect(expressiveVelocities(performed).size).toBe(0);
    const typed = song(
      [
        [60, 0, 1, 'right'],
        [64, 1, 1, 'right'],
      ],
      1,
      120,
      100,
    );
    expect(expressiveVelocities(typed).size).toBe(2);
    expect(notesOf(typed).every((n) => n.velocity !== 100)).toBe(true);
  });
});
