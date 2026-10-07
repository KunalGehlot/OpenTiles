import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { applySettings, handCounts } from '../src/lib/import-settings';
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
