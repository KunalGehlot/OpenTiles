import { describe, expect, it } from 'vitest';
import { matchesQuery, normaliseText } from '../src/catalogue/search';

const elise = { title: 'Für Elise (opening)', composer: 'Ludwig van Beethoven', variant: 'Melody' };

describe('piece search', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normaliseText('  Für  Elise!  ')).toBe('fur elise');
    expect(matchesQuery(elise, 'FUR ELISE')).toBe(true);
    expect(matchesQuery({ title: 'Hänschen klein' }, 'hanschen')).toBe(true);
    expect(matchesQuery({ title: 'Straße' }, 'strasse')).toBe(true);
  });

  it('needs every word, in any order, across title, composer and level', () => {
    expect(matchesQuery(elise, 'beethoven elise')).toBe(true);
    expect(matchesQuery(elise, 'melody')).toBe(true);
    expect(matchesQuery(elise, 'elise mozart')).toBe(false);
  });

  it('matches tags and an empty query matches everything', () => {
    expect(matchesQuery({ title: 'My piece', tags: ['étude'] }, 'etude')).toBe(true);
    expect(matchesQuery(elise, '   ')).toBe(true);
  });

  it('does not throw on odd input', () => {
    expect(matchesQuery(elise, '(*[\\')).toBe(true);
    expect(matchesQuery(elise, '💥')).toBe(true);
  });
});
