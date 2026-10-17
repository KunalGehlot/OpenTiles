// The Score tab engraving a MIDI piece as the learner's sheet-music PDF writes it (P5-18), and
// the hints surviving (or not) a backup. Songs are generated here (CC0).
import { describe, expect, it } from 'vitest';
import type { Song } from '@opentiles/song-model';
import { asSheetAttachment } from '../src/backup/backup';
import { scoreFor } from '../src/views/score/notation';

const song: Song = {
  title: 'Hinted',
  format: 'midi',
  notes: [
    {
      id: 'n0',
      pitch: 70,
      startBeat: 0,
      durationBeats: 4,
      hand: 'right',
      staff: 1,
      voice: 1,
      part: 0,
      measureIndex: 0,
      sourceRefs: [],
    },
  ],
  measures: [{ index: 0, number: '1', sourceIndex: 0, startBeat: 0, lengthBeats: 4 }],
  tempos: [{ beat: 0, bpm: 100 }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  keySignatures: [{ beat: 0, fifths: 0 }],
  parts: [{ name: 'Piano' }],
  lengthBeats: 4,
  warnings: [],
};

const textOf = (n: ReturnType<typeof scoreFor>['notation']) =>
  n.kind === 'musicxml' ? n.text : '';

describe('the Score tab follows the sheet (P5-18)', () => {
  it('writes a note as the PDF does', () => {
    const plain = textOf(scoreFor('midi', undefined, song).notation);
    const hinted = textOf(
      scoreFor('midi', undefined, song, 0, {
        notes: { n0: { staff: 2, step: 'A', alter: 1 } },
        clefs: { 0: { 2: 'G' } },
      }).notation,
    );
    expect(plain).not.toContain('<step>A</step><alter>1</alter>');
    expect(hinted).toContain('<step>A</step><alter>1</alter><octave>4</octave>');
    expect(hinted).toMatch(/<staff>2<\/staff>/);
    expect(hinted).toContain('<clef number="2"><sign>G</sign>');
  });

  it('keeps sound hints through a backup and drops damaged ones, keeping the map', () => {
    const map = {
      layout: { pages: [{ width: 595, height: 842 }], bars: [], source: 'vector' },
      barOfMeasure: [],
      edited: false,
      analyser: 2,
    };
    const sheet = (score: unknown) =>
      asSheetAttachment({
        fileName: 'Hinted.pdf',
        bytes: new Uint8Array([1]),
        addedAt: 1,
        map: { ...map, score },
      });
    const good = { notes: { n0: { staff: 2 } }, clefs: {} };
    expect(sheet(good)?.map?.score).toEqual(good);
    const damaged = sheet('<clef/>');
    expect(damaged?.map).toBeDefined();
    expect(damaged?.map && 'score' in damaged.map).toBe(false);
  });
});
