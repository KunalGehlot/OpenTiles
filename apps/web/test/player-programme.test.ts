// The Player's programme (P6-06): works instead of files, grouped by composer as a concert
// programme lists them.
import { describe, expect, it } from 'vitest';
import type { CollectionEntry } from '../src/player/collection';
import {
  TRADITIONAL,
  composerHeading,
  origin,
  programme,
  surname,
  worksOf,
} from '../src/player/programme';

const entry = (
  slug: string,
  title: string,
  composer?: string,
  extra: Partial<CollectionEntry> = {},
): CollectionEntry => ({
  key: `catalogue:${slug}`,
  source: 'catalogue',
  title,
  ...(composer ? { composer } : {}),
  hasSheet: false,
  playable: true,
  ...extra,
});

describe('the programme’s works (P6-06)', () => {
  it('lists the levels of one song once, playing its fullest version', () => {
    const works = worksOf([
      entry('grace-melody', 'Amazing Grace (melody)', 'Traditional (hymn)', {
        song: 'grace',
        variant: 'Melody',
      }),
      entry('minuet', 'Minuet in G', 'Christian Petzold'),
      entry('grace', 'Amazing Grace', 'Traditional (hymn)', {
        song: 'grace',
        variant: 'Two hands',
      }),
    ]);
    expect(works.map((w) => w.entry.title)).toEqual(['Amazing Grace', 'Minuet in G']);
    expect(works[0]?.versions.map((v) => v.variant)).toEqual(['Two hands', 'Melody']);
  });

  it('never folds library pieces together, even with the same title', () => {
    const library = (id: number): CollectionEntry => ({
      key: `library:${id}`,
      source: 'library',
      title: 'Study',
      hasSheet: false,
      playable: true,
    });
    expect(worksOf([library(1), library(2)])).toHaveLength(2);
  });

  it('plays a version that has notes when the fullest has none', () => {
    const works = worksOf([
      entry('full', 'Song', 'A B', { song: 's', variant: 'Full', playable: false }),
      entry('melody', 'Song (melody)', 'A B', { song: 's', variant: 'Melody' }),
    ]);
    expect(works[0]?.entry.variant).toBe('Melody');
  });
});

describe('the programme’s composers (P6-06)', () => {
  it('puts every folk tune under one heading, and says where each comes from', () => {
    expect(composerHeading('Traditional (Scottish)')).toBe(TRADITIONAL);
    expect(composerHeading('Johann Sebastian Bach')).toBe('Johann Sebastian Bach');
    expect(composerHeading('  ')).toBeNull();
    expect(origin('Traditional (German children’s song, 19th century)')).toBe(
      'German children’s song, 19th century',
    );
    expect(origin('Frédéric Chopin')).toBeNull();
  });

  it('orders composers by surname, then the folk tunes, then pieces without a composer', () => {
    const groups = programme(
      [
        entry('a', 'Ode to Joy', 'Ludwig van Beethoven'),
        entry('b', 'Auld Lang Syne', 'Traditional (Scottish)'),
        entry('c', 'Prelude in C', 'Johann Sebastian Bach'),
        entry('d', 'Untitled'),
        entry('e', 'Invention No. 13', 'Johann Sebastian Bach'),
        entry('f', 'Nocturne', 'Frédéric Chopin'),
      ],
      'en',
    );
    expect(groups.map((g) => g.composer)).toEqual([
      'Johann Sebastian Bach',
      'Ludwig van Beethoven',
      'Frédéric Chopin',
      TRADITIONAL,
      null,
    ]);
    expect(groups[0]?.works.map((w) => w.entry.title)).toEqual([
      'Invention No. 13',
      'Prelude in C',
    ]);
  });

  it('finds a surname', () => {
    expect(surname('Pyotr Ilyich Tchaikovsky')).toBe('Tchaikovsky');
    expect(surname('Bach')).toBe('Bach');
  });
});
