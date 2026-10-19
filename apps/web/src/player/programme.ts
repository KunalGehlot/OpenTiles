// The Player's programme (P6-06, docs/phase-6/player-piano.md §4.3): the music listed the way a
// concert programme lists it. Catalogue pieces that are levels of one song ("Amazing Grace" and
// "Amazing Grace (melody)") are one work, which plays in its fullest version; works are grouped
// under their composer, folk tunes together under "Traditional". Pure, so it is unit-tested in
// Node.
import type { CollectionEntry, CollectionKey } from './collection';

export interface Work {
  /** The version that plays: a catalogue song's fullest level, or the piece itself. */
  entry: CollectionEntry;
  /** Every version, fullest first; one for most pieces. */
  versions: CollectionEntry[];
}

export interface ComposerGroup {
  /** The composer's name, `TRADITIONAL` for folk tunes, or null for pieces without a composer. */
  composer: string | null;
  works: Work[];
}

/** The heading every "Traditional (…)" composer goes under. */
export const TRADITIONAL = 'Traditional';

/** Fullest first: both hands before one hand, and the melody alone last. */
const VARIANT_RANK: Record<string, number> = {
  Full: 0,
  'Two hands': 1,
  'Left hand': 2,
  'Right hand': 2,
  Melody: 3,
};
const rank = (e: CollectionEntry) => (e.variant ? (VARIANT_RANK[e.variant] ?? 1) : 0);

/** The entries as works, in the order their first version comes. */
export function worksOf(entries: readonly CollectionEntry[]): Work[] {
  const works: Work[] = [];
  const bySong = new Map<string, Work>();
  for (const entry of entries) {
    const song = entry.source === 'catalogue' ? entry.song : undefined;
    const known = song ? bySong.get(song) : undefined;
    if (known) {
      known.versions.push(entry);
      continue;
    }
    const work: Work = { entry, versions: [entry] };
    works.push(work);
    if (song) bySong.set(song, work);
  }
  for (const work of works) {
    if (work.versions.length < 2) continue;
    // Stable: versions of the same rank keep their order.
    work.versions.sort((a, b) => rank(a) - rank(b));
    work.entry = work.versions.find((v) => v.playable) ?? (work.versions[0] as CollectionEntry);
  }
  return works;
}

/** The heading a composer goes under: every folk tune under "Traditional". */
export function composerHeading(composer: string | undefined): string | null {
  if (!composer?.trim()) return null;
  return /^traditional\b/i.test(composer.trim()) ? TRADITIONAL : composer.trim();
}

/** Where a folk tune comes from, as the catalogue gives it: "Traditional (Scottish)" → "Scottish". */
export function origin(composer: string | undefined): string | null {
  const m = /^traditional\s*\((.+)\)\s*$/i.exec(composer?.trim() ?? '');
  return m ? (m[1] as string) : null;
}

/** A composer's surname, which orders the programme: "Johann Sebastian Bach" → "Bach". */
export function surname(name: string): string {
  const words = name.trim().split(/\s+/);
  return words[words.length - 1] ?? name;
}

/**
 * The works grouped by composer: composers by surname, then "Traditional", then pieces without a
 * composer; works by title within each.
 */
export function programme(entries: readonly CollectionEntry[], locale?: string): ComposerGroup[] {
  const text = (a: string, b: string) => a.localeCompare(b, locale, { sensitivity: 'base' });
  const groups = new Map<string | null, Work[]>();
  for (const work of worksOf(entries)) {
    const heading = composerHeading(work.entry.composer);
    const list = groups.get(heading);
    if (list) list.push(work);
    else groups.set(heading, [work]);
  }
  const place = (c: string | null) => (c === null ? 2 : c === TRADITIONAL ? 1 : 0);
  return [...groups.entries()]
    .map(([composer, works]) => ({
      composer,
      works: works.sort((a, b) => text(a.entry.title, b.entry.title)),
    }))
    .sort(
      (a, b) =>
        place(a.composer) - place(b.composer) ||
        text(surname(a.composer ?? ''), surname(b.composer ?? '')) ||
        text(a.composer ?? '', b.composer ?? ''),
    );
}

/**
 * What "Listen" plays (P6-07): the piece, then the works after its own in the programme, as a row
 * in the Player plays the list from there.
 */
export function listenQueue(works: readonly Work[], key: CollectionKey): CollectionKey[] {
  const at = works.findIndex((w) => w.versions.some((v) => v.key === key));
  const after = at < 0 ? [] : works.slice(at + 1).filter((w) => w.entry.playable);
  return [key, ...after.map((w) => w.entry.key)];
}
