// The difficulty path on the Home page (P3-05): catalogue pieces grouped by level, from first steps
// upwards, with progress per level taken from the best score of each piece. Pure, for unit tests.

export interface PathPiece {
  slug: string;
  title: string;
  difficulty: number;
}

/** A best score at or above this counts as mastered (the same bar as step practice, P3-04). */
export const MASTERY = 0.9;

export type LevelStatus = 'done' | 'current' | 'upcoming';

export interface PathLevel<P extends PathPiece> {
  level: number;
  pieces: P[];
  /** Pieces with at least one finished run. */
  played: number;
  /** Pieces with a best score of at least `MASTERY`. */
  mastered: number;
  /** Mean of the best scores, unplayed pieces counted as 0 (0–1). */
  progress: number;
  status: LevelStatus;
}

export function catalogueKey(slug: string): string {
  return `catalogue:${slug}`;
}

/**
 * Groups pieces by level (1 upwards, levels without pieces left out). The first level that is not
 * fully mastered is `current`; the ones before it are `done`, the ones after `upcoming`.
 */
export function difficultyPath<P extends PathPiece>(
  pieces: readonly P[],
  best: ReadonlyMap<string, number>,
): PathLevel<P>[] {
  const byLevel = new Map<number, P[]>();
  for (const p of pieces) {
    const level = Math.min(5, Math.max(1, Math.round(p.difficulty) || 1));
    const list = byLevel.get(level) ?? [];
    list.push(p);
    byLevel.set(level, list);
  }
  let foundCurrent = false;
  return [...byLevel.keys()]
    .sort((a, b) => a - b)
    .map((level) => {
      const list = (byLevel.get(level) ?? []).sort((a, b) => a.title.localeCompare(b.title));
      const scores = list.map((p) => best.get(catalogueKey(p.slug)));
      const played = scores.filter((s) => s !== undefined).length;
      const mastered = scores.filter((s) => s !== undefined && s >= MASTERY).length;
      const progress =
        list.length === 0 ? 0 : scores.reduce<number>((sum, s) => sum + (s ?? 0), 0) / list.length;
      let status: LevelStatus;
      if (!foundCurrent && mastered < list.length) {
        status = 'current';
        foundCurrent = true;
      } else {
        status = foundCurrent ? 'upcoming' : 'done';
      }
      return { level, pieces: list, played, mastered, progress, status };
    });
}

/** The piece to suggest next: in the current level, the best-started unmastered piece, else the first unplayed one. */
export function nextPiece<P extends PathPiece>(
  path: readonly PathLevel<P>[],
  best: ReadonlyMap<string, number>,
): P | null {
  const current = path.find((l) => l.status === 'current');
  if (!current) return null;
  const open = current.pieces.filter((p) => (best.get(catalogueKey(p.slug)) ?? 0) < MASTERY);
  const started = open
    .filter((p) => best.has(catalogueKey(p.slug)))
    .sort((a, b) => (best.get(catalogueKey(b.slug)) ?? 0) - (best.get(catalogueKey(a.slug)) ?? 0));
  return started[0] ?? open[0] ?? null;
}
