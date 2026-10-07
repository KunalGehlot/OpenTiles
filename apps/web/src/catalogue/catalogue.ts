// The public-domain catalogue: a static index plus score files served next to the app.
import { importScore } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';

export interface CataloguePiece {
  slug: string;
  title: string;
  composer: string;
  difficulty: number;
  licence: string;
  verified: boolean;
  score: string;
  attribution?: string;
}

const base = new URL('catalogue/', document.baseURI);
let indexPromise: Promise<CataloguePiece[]> | null = null;

export function loadCatalogue(): Promise<CataloguePiece[]> {
  indexPromise ??= fetch(new URL('index.json', base))
    .then((r) => {
      if (!r.ok) throw new Error(`Could not load the catalogue (${r.status}).`);
      return r.json() as Promise<{ pieces: CataloguePiece[] }>;
    })
    .then((i) => i.pieces)
    .catch((e: unknown) => {
      indexPromise = null;
      throw e;
    });
  return indexPromise;
}

export async function loadCatalogueSong(
  slug: string,
): Promise<{ piece: CataloguePiece; song: Song }> {
  const pieces = await loadCatalogue();
  const piece = pieces.find((p) => p.slug === slug);
  if (!piece) throw new Error('This piece is not in the catalogue.');
  const res = await fetch(new URL(piece.score, base));
  if (!res.ok) throw new Error(`Could not load the score (${res.status}).`);
  const song = importScore(piece.score, new Uint8Array(await res.arrayBuffer()));
  return { piece, song };
}

export const DIFFICULTY_LABELS = [
  '',
  'First steps',
  'Beginner',
  'Elementary',
  'Intermediate',
  'Advanced',
];
