// The Player's collection (P6-04): the catalogue and the library in one list. Titles and
// composers here are made up or public domain.
import { describe, expect, it } from 'vitest';
import type { Song } from '@opentiles/song-model';
import type { CataloguePiece } from '../src/catalogue/catalogue';
import {
  buildCollection,
  searchCollection,
  songSeconds,
  sortCollection,
} from '../src/player/collection';
import type { LibraryRow } from '../src/storage/db';

const song = (beats: number, bpm = 120, composer?: string): Song => ({
  title: 'x',
  ...(composer ? { composer } : {}),
  format: 'midi',
  notes:
    beats > 0
      ? [
          {
            id: 'a',
            pitch: 60,
            startBeat: 0,
            durationBeats: 1,
            hand: 'right',
            staff: 1,
            voice: 1,
            part: 0,
            measureIndex: 0,
            sourceRefs: [],
          },
        ]
      : [],
  measures: [],
  tempos: [{ beat: 0, bpm }],
  timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
  keySignatures: [],
  parts: [{ name: 'Piano' }],
  lengthBeats: beats,
  warnings: [],
});

const piece = (
  slug: string,
  title: string,
  extra: Partial<CataloguePiece> = {},
): CataloguePiece => ({
  slug,
  title,
  composer: 'Ludwig van Beethoven',
  difficulty: 2,
  licence: 'CC0-1.0',
  verified: true,
  score: `pieces/${slug}/score.musicxml`,
  ...extra,
});

const row = (id: number, title: string, extra: Partial<LibraryRow> = {}): LibraryRow => ({
  id,
  title,
  fileName: `${title}.mid`,
  format: 'midi',
  song: song(8),
  settings: { transpose: 0, swapHands: false },
  tags: [],
  addedAt: id * 1000,
  size: 100,
  ...extra,
});

describe('the Player’s collection (P6-04)', () => {
  const parts = {
    catalogue: [
      piece('ode-to-joy', 'Ode to Joy', { song: 'ode', variant: 'melody' }),
      piece('minuet-in-g', 'Minuet in G', { composer: 'Christian Petzold', difficulty: 3 }),
      piece('new-piece', 'Awaiting Review', { verified: false }),
    ],
    library: [
      row(1, 'My Study', { song: song(16, 60, 'A. Person'), tags: ['etude'] }),
      row(2, 'Sheet Only', {
        format: 'pdf',
        song: song(0),
        sheet: { fileName: 'Sheet Only.pdf', addedAt: 2000, size: 5 },
      }),
    ],
    progress: [
      {
        key: 'catalogue:minuet-in-g',
        bestAccuracy: 1,
        runs: 1,
        lastPlayedAt: 50,
        secondsPractised: 1,
      },
      { key: 'library:1', bestAccuracy: 1, runs: 1, lastPlayedAt: 70, secondsPractised: 1 },
    ],
    catalogueSeconds: { 'ode-to-joy': 31.5 },
    showUnverified: false,
  };

  it('lists the verified catalogue and the library with what the Player shows', () => {
    const entries = buildCollection(parts);
    expect(entries.map((e) => e.key)).toEqual([
      'catalogue:ode-to-joy',
      'catalogue:minuet-in-g',
      'library:1',
      'library:2',
    ]);
    expect(entries[0]).toMatchObject({
      seconds: 31.5,
      song: 'ode',
      variant: 'melody',
      playable: true,
    });
    expect(entries[1]).toMatchObject({ lastPlayedAt: 50, difficulty: 3 });
    expect(entries[1]?.seconds).toBeUndefined();
    // 16 beats at 60 bpm.
    expect(entries[2]).toMatchObject({
      composer: 'A. Person',
      seconds: 16,
      addedAt: 1000,
      lastPlayedAt: 70,
      hasSheet: false,
      playable: true,
    });
    expect(entries[3]).toMatchObject({ hasSheet: true, playable: false });
    expect(entries[3]?.seconds).toBeUndefined();
    expect(buildCollection({ ...parts, showUnverified: true })).toHaveLength(5);
  });

  it('searches titles, composers, levels and tags', () => {
    const entries = buildCollection(parts);
    expect(searchCollection(entries, 'petzold').map((e) => e.title)).toEqual(['Minuet in G']);
    expect(searchCollection(entries, 'etude').map((e) => e.title)).toEqual(['My Study']);
    expect(searchCollection(entries, 'melody').map((e) => e.title)).toEqual(['Ode to Joy']);
  });

  it('sorts by title, composer, date added, last played and length', () => {
    const entries = buildCollection(parts);
    const titles = (by: Parameters<typeof sortCollection>[1]) =>
      sortCollection(entries, by, 'en').map((e) => e.title);
    expect(titles('title')).toEqual(['Minuet in G', 'My Study', 'Ode to Joy', 'Sheet Only']);
    expect(titles('composer')).toEqual(['My Study', 'Minuet in G', 'Ode to Joy', 'Sheet Only']);
    expect(titles('added')).toEqual(['Sheet Only', 'My Study', 'Minuet in G', 'Ode to Joy']);
    expect(titles('played')).toEqual(['My Study', 'Minuet in G', 'Ode to Joy', 'Sheet Only']);
    expect(titles('length')).toEqual(['My Study', 'Ode to Joy', 'Minuet in G', 'Sheet Only']);
  });

  it('measures a song at 100 % tempo, tempo changes included', () => {
    expect(songSeconds(song(8))).toBe(4);
    expect(
      songSeconds({
        ...song(8),
        tempos: [
          { beat: 0, bpm: 120 },
          { beat: 4, bpm: 60 },
        ],
      }),
    ).toBe(6);
  });
});
