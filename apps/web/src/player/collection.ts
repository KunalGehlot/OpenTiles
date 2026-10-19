// All the learner's music in one list for the Player (P6-04, ADR 0019): the catalogue and the
// library together. Pure, so it is unit-tested in Node; `load.ts` reads the parts from the
// catalogue index and IndexedDB. Library entries come from rows without file bytes, so a library
// full of PDFs lists as fast as an empty one.
import { TempoMap } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { CataloguePiece } from '../catalogue/catalogue';
import { matchesQuery } from '../catalogue/search';
import type { Route } from '../lib/router';
import type { LibraryRow, Progress } from '../storage/db';

export type CollectionKey = `catalogue:${string}` | `library:${number}`;

export interface CollectionEntry {
  /** The same key progress records use. */
  key: CollectionKey;
  source: 'catalogue' | 'library';
  title: string;
  composer?: string;
  /** The composer's years of birth and death, for the catalogue's named composers. */
  composerYears?: readonly [number, number];
  /** Catalogue level, 1–5. */
  difficulty?: number;
  /** Length at 100 % tempo; unknown for a catalogue piece not yet opened on this device. */
  seconds?: number;
  addedAt?: number;
  lastPlayedAt?: number;
  hasSheet: boolean;
  /** False for a sheet-only library piece, which has no notes to play. */
  playable: boolean;
  /** Catalogue pieces that are levels of one song share `song`; `variant` names the level. */
  song?: string;
  variant?: string;
  tags?: string[];
}

/** A song's length at 100 % tempo, in seconds. */
export function songSeconds(song: Song): number {
  return new TempoMap(song.tempos).beatToSeconds(song.lengthBeats);
}

export interface CollectionParts {
  catalogue: readonly CataloguePiece[];
  library: readonly LibraryRow[];
  progress: readonly Progress[];
  /** When the Player last played each piece, on this device (not a practice run). */
  listened?: Readonly<Record<string, number>>;
  /** Catalogue lengths remembered on this device, by slug. */
  catalogueSeconds: Readonly<Record<string, number>>;
  /** Development and preview builds also list catalogue pieces awaiting review. */
  showUnverified: boolean;
}

/** The catalogue, then the library, each in its own order; the Player sorts as the learner asks. */
export function buildCollection(parts: CollectionParts): CollectionEntry[] {
  const played = new Map(parts.progress.map((p) => [p.key, p.lastPlayedAt]));
  for (const [key, at] of Object.entries(parts.listened ?? {})) {
    played.set(key, Math.max(played.get(key) ?? 0, at));
  }
  const catalogue = parts.catalogue
    .filter((p) => p.verified || parts.showUnverified)
    .map((p): CollectionEntry => {
      const key: CollectionKey = `catalogue:${p.slug}`;
      const seconds = parts.catalogueSeconds[p.slug];
      const last = played.get(key);
      return {
        key,
        source: 'catalogue',
        title: p.title,
        composer: p.composer,
        ...(p.composer_years ? { composerYears: p.composer_years } : {}),
        difficulty: p.difficulty,
        hasSheet: false,
        playable: true,
        ...(seconds !== undefined ? { seconds } : {}),
        ...(last ? { lastPlayedAt: last } : {}),
        ...(p.song ? { song: p.song } : {}),
        ...(p.variant ? { variant: p.variant } : {}),
      };
    });
  const library = parts.library.flatMap((row): CollectionEntry[] => {
    if (row.id === undefined) return [];
    const key: CollectionKey = `library:${row.id}`;
    const playable = row.format !== 'pdf' && row.song.notes.length > 0;
    const last = played.get(key);
    return [
      {
        key,
        source: 'library',
        title: row.title,
        ...(row.song.composer ? { composer: row.song.composer } : {}),
        ...(playable ? { seconds: songSeconds(row.song) } : {}),
        addedAt: row.addedAt,
        hasSheet: row.sheet !== undefined,
        playable,
        tags: row.tags,
        ...(last ? { lastPlayedAt: last } : {}),
      },
    ];
  });
  return [...catalogue, ...library];
}

/** Entries matching a search, by title, composer, level or tag. */
export function searchCollection(
  entries: readonly CollectionEntry[],
  query: string,
): CollectionEntry[] {
  return entries.filter((e) => matchesQuery(e, query));
}

export type CollectionSort = 'title' | 'composer' | 'added' | 'played' | 'length';

/**
 * Sorted for the Player's list: titles and composers alphabetically, recently added or played
 * first, shortest first. Entries without the value go last, by title.
 */
export function sortCollection(
  entries: readonly CollectionEntry[],
  by: CollectionSort,
  locale?: string,
): CollectionEntry[] {
  const text = (a = '', b = '') => a.localeCompare(b, locale, { sensitivity: 'base' });
  const byTitle = (a: CollectionEntry, b: CollectionEntry) => text(a.title, b.title);
  const missingLast =
    (value: (e: CollectionEntry) => number | undefined, descending: boolean) =>
    (a: CollectionEntry, b: CollectionEntry) => {
      const va = value(a);
      const vb = value(b);
      if (va === undefined || vb === undefined) {
        return va === vb ? byTitle(a, b) : va === undefined ? 1 : -1;
      }
      return (descending ? vb - va : va - vb) || byTitle(a, b);
    };
  const compare = {
    title: byTitle,
    composer: (a: CollectionEntry, b: CollectionEntry) => {
      if (!a.composer !== !b.composer) return a.composer ? -1 : 1;
      return text(a.composer, b.composer) || byTitle(a, b);
    },
    added: missingLast((e) => e.addedAt, true),
    played: missingLast((e) => e.lastPlayedAt, true),
    length: missingLast((e) => e.seconds, false),
  }[by];
  return [...entries].sort(compare);
}

/** Practice for a piece in the Player's collection ("Practise this", P6-07). */
export function practiceRoute(key: CollectionKey): Route {
  return key.startsWith('library:')
    ? { name: 'practice', source: 'library', id: key.slice('library:'.length) }
    : { name: 'practice', source: 'catalogue', id: key.slice('catalogue:'.length) };
}
