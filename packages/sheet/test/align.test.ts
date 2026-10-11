// Alignment of a song's measures (playback order) with the written bars (ADR 0018).
import { describe, expect, it } from 'vitest';
import type { Measure, SongNote } from '@opentiles/song-model';
import {
  alignOrder,
  alignSong,
  ANALYSER_VERSION,
  buildSheetMap,
  detectLayout,
  expectedHeads,
  playbackCandidates,
} from '../src';
import type { SheetBar, SheetBarline, SheetLayout } from '../src';
import { scorePdf } from './fixtures';
import type { FixtureBar } from './fixtures';
import { drawingsOf } from './pdf';

interface WrittenBar {
  heads: number;
  start?: SheetBarline;
  end?: SheetBarline;
  ending?: number;
}

function layoutOf(written: readonly WrittenBar[]): SheetLayout {
  return {
    pages: [{ width: 595, height: 842 }],
    source: 'vector',
    bars: written.map((w, i): SheetBar => {
      const bar: SheetBar = {
        page: 0,
        system: Math.floor(i / 4),
        box: { x: 40 + (i % 4) * 120, y: 100 + Math.floor(i / 4) * 100, width: 120, height: 60 },
        start: w.start ?? 'single',
        end: w.end ?? 'single',
        heads: w.heads,
      };
      if (w.ending !== undefined) bar.ending = w.ending;
      return bar;
    }),
  };
}

/** A song whose measures hold `counts` quarter notes each, in 4/4 (or as long as needed). */
function songOf(counts: readonly number[], sources?: readonly number[]) {
  const measures: Measure[] = [];
  const notes: SongNote[] = [];
  let beat = 0;
  counts.forEach((count, index) => {
    const length = Math.max(4, count);
    measures.push({
      index,
      number: String(index + 1),
      sourceIndex: sources?.[index] ?? index,
      startBeat: beat,
      lengthBeats: length,
    });
    for (let k = 0; k < count; k++) {
      notes.push({
        id: `n${notes.length}`,
        pitch: 60 + (k % 12),
        startBeat: beat + (k * length) / Math.max(1, count),
        durationBeats: length / Math.max(1, count) / 2,
        hand: 'right',
        staff: 1,
        voice: 1,
        part: 0,
        measureIndex: index,
        sourceRefs: [],
      });
    }
    beat += length;
  });
  return { measures, notes };
}

describe('expectedHeads', () => {
  it('counts the notes that start in a measure and those held into it', () => {
    const song = songOf([2, 0, 1]);
    // The second note of measure 1 lasts into measure 2: written again there, tied.
    const held = song.notes[1];
    if (held) held.durationBeats = 4;
    expect(expectedHeads(song)).toEqual([2, 1, 1]);
  });
});

describe('playbackCandidates', () => {
  it('unrolls repeats and endings, and keeps the written order as another choice', () => {
    const layout = layoutOf([
      { heads: 1, start: 'repeat-start' },
      { heads: 2 },
      { heads: 3, ending: 1, end: 'repeat-end' },
      { heads: 4, ending: 2 },
      { heads: 5 },
    ]);
    const candidates = playbackCandidates(layout.bars);
    expect(candidates.map((c) => c.name)).toEqual(['repeats', 'written']);
    expect(candidates[0]?.order).toEqual([0, 1, 2, 0, 1, 3, 4]);
    expect(candidates[1]?.order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('alignSong', () => {
  it('follows a repeat that the MIDI file plays out', () => {
    // A |: B C :| D, played A B C B C D.
    const layout = layoutOf([
      { heads: 2 },
      { heads: 5, start: 'repeat-start' },
      { heads: 3, end: 'repeat-end' },
      { heads: 7, end: 'final' },
    ]);
    const result = alignSong(layout, songOf([2, 5, 3, 5, 3, 7]));
    expect(result.candidate).toBe('repeats');
    expect(result.barOfMeasure).toEqual([0, 1, 2, 1, 2, 3]);
  });

  it('follows first and second endings', () => {
    // |: A B [1. C :| [2. D | E, played A B C A B D E.
    const layout = layoutOf([
      { heads: 4, start: 'repeat-start' },
      { heads: 6 },
      { heads: 3, ending: 1, end: 'repeat-end' },
      { heads: 8, ending: 2 },
      { heads: 2, end: 'final' },
    ]);
    const result = alignSong(layout, songOf([4, 6, 3, 4, 6, 8, 2]));
    expect(result.barOfMeasure).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });

  it('keeps the written order when the MIDI file was made without its repeats', () => {
    const layout = layoutOf([
      { heads: 2 },
      { heads: 5, start: 'repeat-start' },
      { heads: 3, end: 'repeat-end' },
      { heads: 7 },
    ]);
    const result = alignSong(layout, songOf([2, 5, 3, 7]));
    expect(result.candidate).toBe('written');
    expect(result.barOfMeasure).toEqual([0, 1, 2, 3]);
  });

  it('matches a pickup bar written on the sheet and played as a short first measure', () => {
    const layout = layoutOf([{ heads: 1 }, { heads: 4 }, { heads: 6 }, { heads: 4 }]);
    expect(alignSong(layout, songOf([1, 4, 6, 4])).barOfMeasure).toEqual([0, 1, 2, 3]);
  });

  it('skips a pickup bar the song does not play', () => {
    const layout = layoutOf([{ heads: 1 }, { heads: 4 }, { heads: 6 }, { heads: 3 }, { heads: 5 }]);
    expect(alignSong(layout, songOf([4, 6, 3, 5])).barOfMeasure).toEqual([1, 2, 3, 4]);
  });

  it('puts two measures on one bar when a barline was missed', () => {
    const layout = layoutOf([{ heads: 4 }, { heads: 9 }, { heads: 3 }]);
    expect(alignSong(layout, songOf([4, 5, 4, 3])).barOfMeasure).toEqual([0, 1, 1, 2]);
  });

  it('spreads one measure over two bars when an extra barline was found', () => {
    const layout = layoutOf([{ heads: 4 }, { heads: 3 }, { heads: 3 }, { heads: 5 }]);
    expect(alignSong(layout, songOf([4, 6, 5])).barOfMeasure).toEqual([0, 1, 3]);
  });

  it('keeps an empty trailing measure of the MIDI file on the last bar', () => {
    const layout = layoutOf([{ heads: 4 }, { heads: 6 }, { heads: 5 }]);
    expect(alignSong(layout, songOf([4, 6, 5, 0])).barOfMeasure).toEqual([0, 1, 2, 2]);
  });

  it('uses the playback order of a song read from a score, which knows its own repeats', () => {
    // Bars written once, repeats the song read from its score: every bar alike, so only the
    // song's own order can say which is which.
    const layout = layoutOf([{ heads: 4 }, { heads: 4 }, { heads: 4 }]);
    const result = alignSong(layout, songOf([4, 4, 4, 4, 4], [0, 1, 0, 1, 2]));
    expect(result.candidate).toBe('source');
    expect(result.barOfMeasure).toEqual([0, 1, 0, 1, 2]);
  });

  it('aligns by order alone when the bars have no countable heads (a scan)', () => {
    const layout = layoutOf([{ heads: 0 }, { heads: 0 }, { heads: 0 }]);
    for (const bar of layout.bars) delete bar.heads;
    expect(alignSong(layout, songOf([3, 7, 2])).barOfMeasure).toEqual([0, 1, 2]);
  });

  it('gives no bars for a song without measures, and nulls without bars', () => {
    expect(alignOrder([0, 1], [1, 2], []).barOfMeasure).toEqual([]);
    expect(alignOrder([], [], [3, 4]).barOfMeasure).toEqual([null, null]);
  });

  it('aligns a long piece quickly', () => {
    const counts = Array.from({ length: 600 }, (_, i) => 3 + ((i * 7) % 9));
    const layout = layoutOf(counts.map((heads) => ({ heads })));
    const started = performance.now();
    const result = alignSong(layout, songOf(counts));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result.barOfMeasure.every((b, i) => b === i)).toBe(true);
  });
});

describe('from a PDF to a map', () => {
  it('maps a MIDI-style song with a repeat onto bars found in a generated PDF', async () => {
    const heads = [3, 5, 6, 4, 7, 2, 5, 6];
    const bars: FixtureBar[] = heads.map((h) => ({ width: 120, heads: h }));
    bars[2] = { ...bars[2]!, start: 'repeat-start' };
    bars[4] = { ...bars[4]!, end: 'repeat-end' };
    bars[7] = { ...bars[7]!, end: 'final' };
    const pdf = scorePdf([{ systems: [{ bars: bars.slice(0, 4) }, { bars: bars.slice(4) }] }]);
    const layout = detectLayout(await drawingsOf(pdf));
    // Played: 0 1 2 3 4, back to 2, 2 3 4, then 5 6 7.
    const played = [0, 1, 2, 3, 4, 2, 3, 4, 5, 6, 7];
    const map = buildSheetMap(layout, songOf(played.map((b) => heads[b] ?? 0)));
    expect(map.barOfMeasure).toEqual(played);
    expect(map.edited).toBe(false);
    expect(map.analyser).toBe(ANALYSER_VERSION);
  });
});
