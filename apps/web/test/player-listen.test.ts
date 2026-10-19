// Ways into and out of the Player (P6-07): the queue a "Listen" button plays, and practice for the
// piece playing.
import { describe, expect, it } from 'vitest';
import { practiceRoute } from '../src/player/collection';
import type { CollectionEntry, CollectionKey } from '../src/player/collection';
import { listenQueue } from '../src/player/programme';
import type { Work } from '../src/player/programme';

const entry = (key: CollectionKey, playable = true): CollectionEntry =>
  ({ key, title: key, source: 'catalogue', playable }) as unknown as CollectionEntry;
const work = (...keys: CollectionKey[]): Work => ({
  entry: entry(keys[0] as CollectionKey),
  versions: keys.map((k) => entry(k)),
});

describe('listening in the Player (P6-07)', () => {
  const works = [
    work('catalogue:a'),
    work('catalogue:ode-full', 'catalogue:ode', 'catalogue:ode-melody'),
    work('library:3'),
    { entry: entry('library:4', false), versions: [entry('library:4', false)] },
    work('catalogue:z'),
  ];

  it('plays the piece asked for, then the works after it', () => {
    expect(listenQueue(works, 'catalogue:a')).toEqual([
      'catalogue:a',
      'catalogue:ode-full',
      'library:3',
      'catalogue:z',
    ]);
  });

  it('plays the level asked for, not the fullest one, and goes on after its song', () => {
    expect(listenQueue(works, 'catalogue:ode-melody')).toEqual([
      'catalogue:ode-melody',
      'library:3',
      'catalogue:z',
    ]);
  });

  it('plays just the piece when the programme does not list it', () => {
    expect(listenQueue(works, 'library:9')).toEqual(['library:9']);
  });

  it('opens the piece playing in practice', () => {
    expect(practiceRoute('catalogue:ode')).toEqual({
      name: 'practice',
      source: 'catalogue',
      id: 'ode',
    });
    expect(practiceRoute('library:12')).toEqual({ name: 'practice', source: 'library', id: '12' });
  });
});
