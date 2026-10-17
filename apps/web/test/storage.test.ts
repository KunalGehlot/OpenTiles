import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applySettings, handCounts, parseTags, trimFor } from '../src/lib/import-settings';
import { db, getSetting, localDay, recordRun, setSetting, streak } from '../src/storage/db';
import type { Song } from '@opentiles/song-model';

const song: Song = {
  title: 't',
  format: 'midi',
  notes: [
    {
      id: 'n0',
      pitch: 50,
      startBeat: 0,
      durationBeats: 1,
      hand: 'left',
      staff: 2,
      voice: 1,
      part: 0,
      measureIndex: 0,
      sourceRefs: [],
    },
    {
      id: 'n1',
      pitch: 70,
      startBeat: 0,
      durationBeats: 1,
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
  timeSignatures: [],
  keySignatures: [],
  parts: [{ name: 'Piano' }],
  lengthBeats: 4,
  warnings: [],
};

describe('import settings', () => {
  it('applies transpose, swap and tempo', () => {
    const s = applySettings(song, { transpose: 2, swapHands: true, baseBpm: 80 });
    expect(s.notes.map((n) => [n.pitch, n.hand])).toEqual([
      [52, 'right'],
      [72, 'left'],
    ]);
    expect(s.tempos[0]?.bpm).toBe(80);
    expect(handCounts(s)).toEqual({ left: 1, right: 1 });
  });
});

describe('bars kept and tags (P1-07)', () => {
  // Four one-beat bars, a note at each beat.
  const four: Song = {
    ...song,
    notes: [0, 1, 2, 3].map((b) => ({
      ...song.notes[1]!,
      id: `n${b}`,
      startBeat: b,
      measureIndex: b,
    })),
    measures: [0, 1, 2, 3].map((i) => ({
      index: i,
      number: String(i + 1),
      sourceIndex: i,
      startBeat: i,
      lengthBeats: 1,
    })),
    lengthBeats: 4,
  };

  it('keeps the bars chosen, after the other settings', () => {
    const s = applySettings(four, { transpose: 1, swapHands: false, trim: { from: 1, to: 2 } });
    expect(s.measures.map((m) => m.number)).toEqual(['2', '3']);
    expect(s.notes.map((n) => [n.startBeat, n.pitch])).toEqual([
      [0, 71],
      [1, 71],
    ]);
  });

  it('keeps no range when every bar is kept, and keeps the range inside the piece', () => {
    expect(trimFor(0, 3, 4)).toBeUndefined();
    expect(trimFor(1, 3, 4)).toEqual({ from: 1, to: 3 });
    expect(trimFor(-2, 9, 4)).toBeUndefined();
    expect(trimFor(3, 1, 4)).toEqual({ from: 3, to: 3 });
  });

  it('reads tags typed with commas: trimmed, each once, at most ten', () => {
    expect(parseTags(' exam,  warm-up ,Exam,, Grade   2 ')).toEqual(['exam', 'warm-up', 'Grade 2']);
    expect(parseTags(Array.from({ length: 12 }, (_, i) => `t${i}`).join(','))).toHaveLength(10);
    expect(parseTags('x'.repeat(50))[0]).toHaveLength(40);
  });
});

describe('storage', () => {
  it('keeps settings and progress', async () => {
    expect(await getSetting('rightsConfirmed', false)).toBe(false);
    await setSetting('rightsConfirmed', true);
    expect(await getSetting('rightsConfirmed', false)).toBe(true);
    await recordRun('catalogue:x', 0.8, 60);
    const p = await recordRun('catalogue:x', 0.6, 30);
    expect(p).toMatchObject({ bestAccuracy: 0.8, runs: 2, secondsPractised: 90 });
    expect((await db.days.get(localDay()))?.seconds).toBe(90);
  });

  it('counts a practice streak ending today or yesterday', () => {
    const today = new Date(2026, 9, 7);
    const d = (offset: number) => {
      const x = new Date(today);
      x.setDate(x.getDate() - offset);
      return { day: localDay(x), seconds: 60 };
    };
    expect(streak([d(0), d(1), d(2), d(4)], today)).toBe(3);
    expect(streak([d(1), d(2)], today)).toBe(2);
    expect(streak([d(3)], today)).toBe(0);
  });
});
