// Chord drills (P7-01 to P7-03, P7-07, P7-08): the vocabulary, the generator and the MusicXML it
// writes read back by song-model's parser, the chord tally, the progress and the tempo ladder.
import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXml } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import {
  addRound,
  buildSteps,
  CHORD_DRILL_DEFAULTS,
  CHORD_LEVELS,
  CHORD_QUALITIES,
  ChordTally,
  chordDrillId,
  chordKind,
  chordNotes,
  chordOn,
  chordPitchClasses,
  chordSymbol,
  drillChords,
  generateChordDrill,
  hardestChords,
  invert,
  inversionsOf,
  isChordDrillId,
  judgeTogether,
  levelEntries,
  MAX_ROUNDS,
  missCause,
  mostNotesAtOnce,
  nextChordTempo,
  NO_CHORD_STATS,
  normaliseChordDrillOptions,
  normaliseChordStats,
  parseChordDrillId,
  parseDrillId,
  pitchClassOf,
  rootFor,
  roundOf,
  stepPitch,
  voicing,
  weakChords,
  WaitMode,
} from '../src';
import type { ChordDrillOptions, ChordQuality, NoteResult, PitchName, SpelledPitch } from '../src';

type DomParser = NonNullable<Parameters<typeof parseMusicXml>[1]>['domParser'];
const read = (xml: string): Song =>
  parseMusicXml(xml, { domParser: new DOMParser() as unknown as DomParser });
const opts = (o: Partial<ChordDrillOptions>): ChordDrillOptions => ({
  ...CHORD_DRILL_DEFAULTS,
  ...o,
});

const LETTERS = 'CDEFGAB';
const name = (p: PitchName) => `${LETTERS[p.letter]}${p.alter < 0 ? 'b' : p.alter > 0 ? '#' : ''}`;
const names = (notes: readonly SpelledPitch[]) => notes.map(name).join(' ');
const SEMITONES: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  maj7: [0, 4, 7, 11],
  dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 4, 7, 14],
  six: [0, 4, 7, 9],
  min6: [0, 3, 7, 9],
};

describe('chord vocabulary', () => {
  it('builds every quality on all twelve roots with the right intervals and no double accidentals', () => {
    for (const quality of CHORD_QUALITIES) {
      for (let pc = 0; pc < 12; pc++) {
        const notes = chordNotes(chordOn(pc, quality), 4);
        const root = notes[0]?.midi ?? 0;
        expect(pitchClassOf(chordOn(pc, quality).root)).toBe(pc);
        expect(notes.map((n) => n.midi - root)).toEqual(SEMITONES[quality]);
        for (const n of notes) {
          expect(Math.abs(n.alter)).toBeLessThanOrEqual(1);
          // The spelling sounds the MIDI pitch it claims.
          expect((n.octave + 1) * 12 + [0, 2, 4, 5, 7, 9, 11][n.letter]! + n.alter).toBe(n.midi);
        }
      }
    }
  });

  it('spells chords as musicians write them', () => {
    const spelled = (pc: number, q: ChordQuality) => names(chordNotes(chordOn(pc, q)));
    expect(spelled(3, 'maj')).toBe('Eb G Bb');
    expect(spelled(1, 'maj')).toBe('Db F Ab');
    expect(spelled(1, 'min')).toBe('C# E G#');
    expect(spelled(6, 'maj')).toBe('F# A# C#');
    expect(spelled(3, 'min')).toBe('Eb Gb Bb');
    expect(spelled(8, 'aug')).toBe('Ab C E');
    expect(spelled(10, 'min')).toBe('Bb Db F');
    expect(spelled(8, 'min')).toBe('G# B D#');
    expect(spelled(7, 'dom7')).toBe('G B D F');
    expect(spelled(11, 'm7b5')).toBe('B D F A');
    expect(spelled(4, 'aug')).toBe('E G# B#');
    // The double flat of C dim7 (B𝄫) is written as the A it sounds as.
    expect(spelled(0, 'dim7')).toBe('C Eb Gb A');
    expect(spelled(11, 'dim7')).toBe('B D F Ab');
    expect(rootFor(6, 'maj7')).toEqual({ letter: 4, alter: -1 }); // G♭maj7 has fewer accidentals
  });

  it('agrees with the sight-reading drills about white-key pitches', () => {
    // stepPitch counts staff steps from C0 (octave × 7 + letter).
    const c = chordNotes(chordOn(0, 'maj'), 4);
    expect(c.map((n) => n.midi)).toEqual([28, 30, 32].map((s) => stepPitch(s, 0)));
    const am = chordNotes(chordOn(9, 'min'), 3);
    expect(am.map((n) => n.midi)).toEqual([26, 28, 30].map((s) => stepPitch(s, 0)));
  });

  it('keeps the pitch classes through inversions and names the bass', () => {
    for (const quality of CHORD_QUALITIES) {
      for (let inv = 0; inv < inversionsOf(quality); inv++) {
        const chord = chordOn(2, quality, inv);
        const notes = chordNotes(chord);
        expect(new Set(notes.map((n) => n.midi % 12))).toEqual(new Set(chordPitchClasses(chord)));
        for (let i = 1; i < notes.length; i++) {
          expect(notes[i]!.midi).toBeGreaterThan(notes[i - 1]!.midi);
        }
      }
    }
    expect(chordSymbol(chordOn(0, 'maj', 1))).toEqual({
      root: { letter: 0, alter: 0 },
      suffix: '',
      bass: { letter: 2, alter: 0 },
    });
    expect(chordSymbol(chordOn(10, 'maj7'))).toEqual({
      root: { letter: 6, alter: -1 },
      suffix: 'maj7',
    });
    expect(invert(chordNotes(chordOn(0, 'maj')), 2).map((n) => n.midi)).toEqual([67, 72, 76]);
    expect(inversionsOf('add9')).toBe(1);
    expect(chordOn(0, 'maj', 9).inversion).toBe(2);
  });

  it('places a chord by octaves near the middle it is asked for', () => {
    expect(voicing(chordOn(0, 'maj'), 66, 60).map((n) => n.midi)).toEqual([60, 64, 67]);
    expect(voicing(chordOn(11, 'maj'), 66, 60).map((n) => n.midi)).toEqual([71, 75, 78]);
    expect(voicing(chordOn(0, 'maj'), 50, 40).map((n) => n.midi)).toEqual([48, 52, 55]);
  });
});

describe('chord drill generator', () => {
  it('repeats a drill exactly from its seed, and changes with another seed', () => {
    const xml = (seed: number) => generateChordDrill(opts({ level: 5, seed })).musicxml;
    expect(xml(7)).toBe(xml(7));
    expect(xml(7)).not.toBe(xml(8));
  });

  it('only uses each level’s chords, and each kind once before any repeats', () => {
    for (const level of CHORD_LEVELS) {
      const allowed = new Map(
        levelEntries(level).map((e) => [`${e.pitchClass}.${e.quality}`, e.inversions]),
      );
      for (const seed of [1, 2, 3]) {
        const chords = drillChords(opts({ level, count: 32, seed, hands: 'right' }));
        expect(chords).toHaveLength(32);
        for (const c of chords) {
          const inversions = allowed.get(chordKind(c.chord));
          expect(inversions, chordKind(c.chord)).toBeDefined();
          expect(inversions).toContain(c.chord.inversion);
        }
        const kinds = chords.map((c) => chordKind(c.chord));
        const first = kinds.slice(0, Math.min(32, allowed.size));
        expect(new Set(first).size).toBe(first.length);
      }
    }
    const level1 = new Set(
      drillChords(opts({ level: 1, count: 6 })).map((c) => chordKind(c.chord)),
    );
    expect(level1).toEqual(new Set(['0.maj', '5.maj', '7.maj', '9.min', '2.min', '4.min']));
  });

  it('never plays a chord twice running nor three of a quality running', () => {
    for (const seed of [1, 5, 9, 13]) {
      const chords = drillChords(opts({ level: 6, count: 64, seed }));
      for (let i = 1; i < chords.length; i++) {
        expect(chordKind(chords[i]!.chord)).not.toBe(chordKind(chords[i - 1]!.chord));
        if (i >= 2) {
          const q = [i - 2, i - 1, i].map((j) => chords[j]!.chord.quality);
          expect(q[0] === q[1] && q[1] === q[2]).toBe(false);
        }
      }
    }
  });

  it('relaxes its rules for a set too small to keep them, rather than stopping', () => {
    const one = opts({
      level: 'custom',
      set: { roots: [2], qualities: ['min'], inversions: false, left: 'root' },
      count: 8,
    });
    expect(drillChords(one).map((c) => chordKind(c.chord))).toEqual(Array(8).fill('2.min'));
    const oneQuality = opts({
      level: 'custom',
      set: { roots: [0, 7], qualities: ['maj'], inversions: false, left: 'root' },
      count: 8,
    });
    const kinds = drillChords(oneQuality).map((c) => chordKind(c.chord));
    expect(new Set(kinds)).toEqual(new Set(['0.maj', '7.maj']));
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
  });

  it('keeps hands inside C2 to C7 and the right hand within a tenth', () => {
    for (const level of CHORD_LEVELS) {
      for (const hands of ['right', 'left', 'both'] as const) {
        for (const c of drillChords(opts({ level, hands, count: 64, seed: level * 3 }))) {
          const all = [...c.upper, ...c.lower].map((n) => n.midi);
          expect(Math.min(...all)).toBeGreaterThanOrEqual(36);
          expect(Math.max(...all)).toBeLessThanOrEqual(96);
          const span = c.upper[c.upper.length - 1]!.midi - c.upper[0]!.midi;
          expect(span).toBeLessThanOrEqual(16);
          if (c.lower.length > 0) {
            expect(c.lower[c.lower.length - 1]!.midi).toBeLessThan(c.upper[0]!.midi);
          }
        }
      }
    }
  });

  it('puts the root, the root and fifth, or the chord in the left hand when both hands play', () => {
    const at = (o: Partial<ChordDrillOptions>) => drillChords(opts({ count: 4, ...o }));
    for (const c of at({ level: 3, hands: 'both' })) {
      expect(c.lower).toHaveLength(1);
      expect(c.lower[0]!.midi % 12).toBe(pitchClassOf(c.chord.root));
    }
    for (const c of at({ level: 8, hands: 'both' })) {
      expect(c.lower).toHaveLength(2);
      expect(c.lower[1]!.midi - c.lower[0]!.midi).toBeGreaterThanOrEqual(6);
    }
    const chordsBoth = at({
      level: 'custom',
      set: { roots: [0, 5], qualities: ['maj'], inversions: false, left: 'chord' },
      hands: 'both',
    });
    for (const c of chordsBoth) expect(c.lower).toHaveLength(3);
    expect(mostNotesAtOnce(chordsBoth)).toBe(6);
    expect(mostNotesAtOnce(at({ level: 3 }))).toBe(3);
  });

  it('reads back as one step a bar with the chord’s pitches and hands', () => {
    for (const hands of ['right', 'left', 'both'] as const) {
      const drill = generateChordDrill(opts({ level: 7, hands, count: 12, seed: 4 }));
      const song = read(drill.musicxml);
      const steps = buildSteps(song);
      expect(steps).toHaveLength(12);
      for (const [i, step] of steps.entries()) {
        const c = drill.chords[i]!;
        expect(step.beat).toBeCloseTo(c.beat, 6);
        expect(step.measureIndex).toBe(i);
        expect(step.pitches).toEqual(
          [...c.lower, ...c.upper].map((n) => n.midi).sort((a, b) => a - b),
        );
        for (const n of step.notes) {
          const left = c.lower.some((l) => l.midi === n.pitch) || hands === 'left';
          expect(n.hand).toBe(left ? 'left' : 'right');
        }
      }
    }
  });

  it('writes accidentals and names, and a natural after an altered letter', () => {
    const drill = generateChordDrill(
      opts({
        level: 'custom',
        set: { roots: [3], qualities: ['maj'], inversions: false, left: 'root' },
        count: 1,
      }),
      (c) => `<${pitchClassOf(c.root)}&>`,
    );
    expect(drill.musicxml).toContain('<accidental>flat</accidental>');
    expect(drill.musicxml).toContain('<words font-weight="bold">&lt;3&amp;&gt;</words>');
    const d2 = generateChordDrill(
      opts({
        level: 'custom',
        set: { roots: [3, 4], qualities: ['min'], inversions: false, left: 'root' },
        count: 2,
        seed: 2,
      }),
    );
    // E♭m then Em (or the other way): the G♭ or G natural, and the B♭ or B, are marked.
    expect(d2.musicxml.match(/<accidental>natural<\/accidental>/g)?.length ?? 0).toBeGreaterThan(0);
    expect(read(d2.musicxml).tempos[0]?.bpm ?? 60).toBe(60);
  });

  it('writes the tempo it is given', () => {
    const song = read(generateChordDrill(opts({ tempo: 90 })).musicxml);
    expect(song.tempos[0]?.bpm).toBe(90);
  });

  it('round-trips its options through a link id, and keeps sight-reading ids apart', () => {
    const cases: ChordDrillOptions[] = [
      opts({ level: 3, seed: 12345 }),
      opts({ level: 8, hands: 'both', count: 32, tempo: 85, near: true, seed: 7 }),
      opts({
        level: 'custom',
        set: {
          roots: [0, 3, 11],
          qualities: ['min', 'dim7', 'six'],
          inversions: true,
          left: 'chord',
        },
        hands: 'both',
        focus: ['3.min', '0.dim7'],
        seed: 99,
      }),
    ];
    for (const o of cases) {
      const id = chordDrillId(o);
      expect(isChordDrillId(id)).toBe(true);
      expect(parseChordDrillId(id)).toEqual(normaliseChordDrillOptions(o));
    }
    expect(chordDrillId(opts({ level: 3, seed: 12345 }))).toBe('chords.l3.hr.n16.t60.s12345');
    expect(isChordDrillId('treble.0.1.notes.8.12345')).toBe(false);
    expect(parseDrillId('treble.0.1.notes.8.12345').clef).toBe('treble');
    // Unknown or broken ids fall back to defaults.
    expect(parseChordDrillId('chords.lx.h?.n999.tabc')).toEqual({
      ...normaliseChordDrillOptions({}),
      count: 64,
    });
    expect(normaliseChordDrillOptions({ level: 8 }).hands).toBe('both');
    expect(normaliseChordDrillOptions({ tempo: 63 }).tempo).toBe(65);
  });

  it('draws weak chords more often without starving the others', () => {
    const base = drillChords(opts({ level: 3, count: 64, seed: 3 }));
    const focused = drillChords(opts({ level: 3, count: 64, seed: 3, focus: ['3.min', '8.maj'] }));
    const count = (cs: typeof base, k: string) => cs.filter((c) => chordKind(c.chord) === k).length;
    expect(count(focused, '3.min') + count(focused, '8.maj')).toBeGreaterThan(
      count(base, '3.min') + count(base, '8.maj'),
    );
    expect(new Set(focused.map((c) => chordKind(c.chord))).size).toBe(24);
  });

  it('keeps the hand near the last chord in the voice-leading mode', () => {
    const jumps = (near: boolean) => {
      const cs = drillChords(opts({ level: 4, count: 32, seed: 11, near }));
      let sum = 0;
      for (let i = 1; i < cs.length; i++) {
        const mean = (c: (typeof cs)[number]) =>
          c.upper.reduce((s, n) => s + n.midi, 0) / c.upper.length;
        sum += Math.abs(mean(cs[i]!) - mean(cs[i - 1]!));
      }
      return sum / (cs.length - 1);
    };
    expect(jumps(true)).toBeLessThan(jumps(false));
  });
});

const result = (pitch: number, offset: number | undefined): NoteResult => ({
  note: { id: `n${pitch}`, pitch, time: 0, measureIndex: 0 },
  judgement:
    offset === undefined
      ? 'missed'
      : Math.abs(offset) <= 0.075
        ? 'hit'
        : offset < 0
          ? 'early'
          : 'late',
  ...(offset === undefined ? {} : { offset }),
});

describe('chord tally', () => {
  const cMajor = [60, 64, 67];

  it('names the cause of a wrong key', () => {
    expect(missCause(63, cMajor, 60)).toBe('quality'); // E♭ for E: minor for major
    expect(missCause(66, cMajor, 60)).toBe('quality'); // a diminished fifth
    expect(missCause(52, cMajor, 60)).toBe('inversion'); // E in another octave
    expect(missCause(62, cMajor, 60)).toBe('extra'); // D
    expect(missCause(61, cMajor, 60)).toBe('extra'); // next to the root, not a quality
  });

  it('counts a chord right at the first try only with no wrong key before it is complete', () => {
    const tally = new ChordTally();
    tally.start(0, '0.maj', cMajor, 10, 60);
    expect(tally.complete(12.5)).toMatchObject({ firstTry: true, seconds: 2.5, causes: [] });
    tally.start(1, '9.min', [57, 60, 64], 12.5, 57);
    tally.wrong(61); // C♯: major for minor
    tally.wrong(62);
    expect(tally.complete(16)).toMatchObject({ firstTry: false, causes: ['quality', 'extra'] });
    tally.start(2, '7.maj', [55, 59, 62], 16, 55);
    tally.reveal();
    expect(tally.complete(20)).toMatchObject({ firstTry: false, causes: ['missing'] });
    const s = tally.summary();
    expect(s).toMatchObject({ chords: 3, firstTry: 1, medianSeconds: 3.5 });
    expect(s.share).toBeCloseTo(1 / 3);
    expect(s.perMinute).toBe(Math.round((3 * 60) / 10));
    expect(hardestChords(s).map((k) => k.kind)).toEqual(['9.min', '7.maj']);
  });

  it('replays a recorded event list to the same tally through wait mode', () => {
    const song = read(generateChordDrill(opts({ level: 2, count: 4, seed: 5 })).musicxml);
    const steps = buildSteps(song);
    const run = () => {
      const wait = new WaitMode(steps);
      const tally = new ChordTally();
      let t = 0;
      tally.start(0, 'k0', steps[0]!.pitches, t);
      for (const [i, step] of steps.entries()) {
        if (i === 1)
          wait.handle({ pitch: step.pitches[0]! + 1, time: t, confidence: 1, source: 'midi' });
        for (const pitch of step.pitches) {
          t += 0.3;
          const o = wait.handle({ pitch, time: t, confidence: 1, source: 'midi' });
          if (o.kind === 'wrong') tally.wrong(o.pitch);
          if (o.kind === 'correct' && o.completed) {
            tally.complete(t);
            const next = steps[i + 1];
            if (next) tally.start(i + 1, `k${i + 1}`, next.pitches, t);
          }
        }
        if (i === 1) tally.wrong(step.pitches[0]! + 1);
      }
      return tally.summary();
    };
    expect(run()).toEqual(run());
    expect(run()).toMatchObject({ chords: 4, firstTry: 3 });
  });

  it('judges a chord at a tempo by its spread and its median offset', () => {
    expect(judgeTogether([result(60, -0.02), result(64, 0.04), result(67, 0.09)])).toEqual({
      complete: true,
      together: true,
      offset: 0.04,
    });
    expect(judgeTogether([result(60, 0), result(64, 0.12)]).together).toBe(true);
    expect(judgeTogether([result(60, 0), result(64, 0.13)]).together).toBe(false);
    expect(judgeTogether([result(60, 0), result(64, 0.07)], 0.06).together).toBe(false);
    expect(judgeTogether([result(60, 0), result(64, undefined)])).toMatchObject({
      complete: false,
      offset: 0,
    });
    const tally = new ChordTally();
    expect(
      tally.judged(0, 'a', [result(60, 0), result(64, 0.05), result(67, 0.02)], []),
    ).toMatchObject({
      firstTry: true,
      causes: [],
    });
    expect(
      tally.judged(
        1,
        'b',
        [result(60, 0), result(64, undefined), result(67, 0.02)],
        [63],
        0.12,
        60,
      ),
    ).toMatchObject({
      firstTry: false,
      causes: ['missing', 'quality'],
    });
    expect(tally.judged(2, 'c', [result(60, 0), result(64, 0.3)], []).firstTry).toBe(false);
  });
});

describe('chord progress and the tempo ladder', () => {
  const summary = (kinds: [string, number, number][]) => {
    const tally = new ChordTally();
    let t = 0;
    let i = 0;
    for (const [kind, attempts, firstTry] of kinds) {
      for (let a = 0; a < attempts; a++) {
        tally.start(i++, kind, [60], t);
        if (a >= firstTry) tally.wrong(70);
        t += 2;
        tally.complete(t);
      }
    }
    return tally.summary();
  };

  it('keeps rounds, caps them, and finds weak chords', () => {
    const s = summary([
      ['0.maj', 4, 4],
      ['10.dim7', 5, 1],
      ['9.min', 2, 0],
    ]);
    const round = roundOf(s, new Map([['0.maj', 8]]), 1000);
    expect(round.kinds['0.maj']).toEqual([4, 4, 8]);
    expect(round.causes?.['10.dim7']).toBe('extra');
    let stats = addRound(NO_CHORD_STATS, round);
    expect(weakChords(stats).map((k) => k.kind)).toEqual(['10.dim7']);
    expect(weakChords(stats, new Set(['0.maj']))).toEqual([]);
    for (let i = 0; i < MAX_ROUNDS + 10; i++) stats = addRound(stats, { ...round, at: i });
    expect(stats.rounds).toHaveLength(MAX_ROUNDS);
    expect(stats.rounds[0]?.at).toBe(10);
    expect(addRound(stats, { ...round, chords: 0 })).toBe(stats);
  });

  it('reads back only well-formed stats', () => {
    const round = { at: 1, chords: 2, firstTry: 1, perMinute: 10, kinds: { '0.maj': [2, 1, 3] } };
    expect(
      normaliseChordStats({ rounds: [round, { at: 'x' }, null, { ...round, kinds: { a: [1] } }] }),
    ).toEqual({
      version: 1,
      rounds: [round, { ...round, kinds: {} }],
    });
    expect(normaliseChordStats('nonsense')).toEqual(NO_CHORD_STATS);
  });

  it('raises the tempo after three clean rounds and lowers it after a poor one', () => {
    expect(nextChordTempo([0.95, 0.9, 1], 60)).toBe(65);
    expect(nextChordTempo([0.95, 0.9], 60)).toBe(60);
    expect(nextChordTempo([0.95, 0.8, 1], 60)).toBe(60);
    expect(nextChordTempo([1, 1, 0.5], 60)).toBe(55);
    expect(nextChordTempo([], 60)).toBe(60);
    expect(nextChordTempo([1, 1, 1], 120)).toBe(120);
    expect(nextChordTempo([0.1], 40)).toBe(40);
  });
});
