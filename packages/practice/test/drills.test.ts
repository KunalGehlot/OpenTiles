// Sight-reading drills (P5-05): the generator, and the MusicXML it writes read back by song-model's
// parser, which is how the app turns a drill into a Song for the same score Verovio draws.
import { DOMParser } from '@xmldom/xmldom';
import { parseMusicXml } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import { describe, expect, it } from 'vitest';
import {
  DRILL_DEFAULTS,
  drillId,
  generateDrill,
  normaliseDrillOptions,
  parseDrillId,
  seededRandom,
  stepPitch,
  stepXml,
} from '../src';
import type { DrillOptions } from '../src';

const opts = (o: Partial<DrillOptions>): DrillOptions => ({ ...DRILL_DEFAULTS, ...o });
type DomParser = NonNullable<Parameters<typeof parseMusicXml>[1]>['domParser'];
const read = (xml: string): Song =>
  parseMusicXml(xml, { domParser: new DOMParser() as unknown as DomParser });

describe('drill generator', () => {
  it('repeats a drill exactly from its seed, and changes with another seed', () => {
    const xml = (seed: number) => generateDrill(opts({ seed })).musicxml;
    expect(xml(7)).toBe(xml(7));
    expect(xml(7)).not.toBe(xml(8));
    const r = seededRandom(1);
    for (let i = 0; i < 100; i++) {
      const x = r();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('writes staff steps as MusicXML pitches and as MIDI pitches in the key', () => {
    expect(stepXml(28, 0)).toEqual({ step: 'C', octave: 4, alter: 0 }); // middle C
    expect(stepXml(27, 0)).toEqual({ step: 'B', octave: 3, alter: 0 });
    expect(stepXml(31, 1)).toEqual({ step: 'F', octave: 4, alter: 1 });
    expect(stepXml(34, -2)).toEqual({ step: 'B', octave: 4, alter: -1 });
    expect(stepPitch(28, 0)).toBe(60);
    expect(stepPitch(31, 1)).toBe(66); // F in G major is F♯
    expect(stepPitch(34, -1)).toBe(70); // B in F major is B♭
    expect(stepPitch(30, -3)).toBe(63); // E in E♭ major is E♭
  });

  it('keeps every note in the range of its clef and level, a quarter each', () => {
    for (const clef of ['treble', 'bass'] as const) {
      for (const level of [1, 2, 3] as const) {
        for (const kind of ['notes', 'phrases'] as const) {
          const d = generateDrill(opts({ clef, level, kind, seed: level * 31 }));
          expect(d.notes).toHaveLength(32);
          const steps = d.notes.map((n) => n.step);
          const [lo, hi] = {
            treble: { 1: [28, 32], 2: [28, 39], 3: [26, 42] },
            bass: { 1: [24, 28], 2: [16, 28], 3: [14, 30] },
          }[clef][level];
          expect(Math.min(...steps)).toBeGreaterThanOrEqual(lo ?? 0);
          expect(Math.max(...steps)).toBeLessThanOrEqual(hi ?? 99);
        }
      }
    }
  });

  it('never plays the same single note twice in a row, and moves mostly by step in phrases', () => {
    const single = generateDrill(opts({ level: 2, seed: 5 })).notes;
    for (let i = 1; i < single.length; i++) expect(single[i]?.step).not.toBe(single[i - 1]?.step);
    const phrase = generateDrill(opts({ level: 2, kind: 'phrases', seed: 5 })).notes;
    const moves = phrase.slice(1).map((n, i) => Math.abs(n.step - (phrase[i]?.step ?? 0)));
    const small = moves.filter((m) => m <= 2).length;
    expect(small / moves.length).toBeGreaterThan(0.7);
  });

  it('reads back as the same pitches, in the right hand for treble and the left for bass', () => {
    for (const fifths of [-3, -2, -1, 0, 1, 2, 3]) {
      for (const clef of ['treble', 'bass', 'both'] as const) {
        const d = generateDrill(opts({ clef, fifths, level: 3, seed: 100 + fifths }));
        const song = read(d.musicxml);
        const notes = [...song.notes].sort((a, b) => a.startBeat - b.startBeat);
        expect(notes.map((n) => n.pitch)).toEqual(d.notes.map((n) => n.pitch));
        expect(notes.map((n) => n.hand)).toEqual(
          d.notes.map((n) => (n.clef === 'bass' ? 'left' : 'right')),
        );
        expect(notes.map((n) => n.startBeat)).toEqual(d.notes.map((_, i) => i));
        expect(song.keySignatures[0]?.fifths ?? 0).toBe(fifths);
        expect(song.measures).toHaveLength(8);
      }
    }
  });

  it('writes a name under each note when asked, and hides the rests of the other staff', () => {
    const d = generateDrill(opts({ clef: 'both', seed: 3 }), (p) => `n${p}<&>`);
    const names = [...d.musicxml.matchAll(/<text>([^<]*)<\/text>/g)].map((m) => m[1]);
    // Written staff by staff within each bar, so compare them in order of pitch.
    expect(names.sort()).toEqual(d.notes.map((n) => `n${n.pitch}&lt;&amp;&gt;`).sort());
    expect(generateDrill(opts({ seed: 3 })).musicxml).not.toContain('<lyric');
    expect(d.musicxml.match(/<note print-object="no"><rest\/>/g)).toHaveLength(32);
    // The names never break the file: the notes read back the same.
    expect(read(d.musicxml).notes).toHaveLength(32);
  });

  it('turns options into a short id and back, and keeps bad values in bounds', () => {
    const o = opts({ clef: 'both', fifths: -2, level: 3, kind: 'phrases', bars: 4, seed: 99 });
    expect(drillId(o)).toBe('both.-2.3.phrases.4.99');
    expect(parseDrillId(drillId(o))).toEqual(o);
    expect(parseDrillId('x.9.7.y.0.-5')).toEqual({
      clef: 'treble',
      fifths: 3,
      level: 3,
      kind: 'notes',
      bars: 1,
      seed: 0,
    });
    expect(normaliseDrillOptions({})).toEqual(DRILL_DEFAULTS);
  });
});
