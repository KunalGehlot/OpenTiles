// Pedals for library pieces imported before the importers read them (P6-10, ADR 0020). Their
// stored songs have no `pedals`; the first time such a piece is opened or played, the pedals are
// read from its kept file and stored with the song (an empty list when it has none, so a file is
// read only once). Only the pedals are taken: the notes stay as the learner reviewed them.
import { importScore, trimMeasures } from '@opentiles/song-model';
import type { PedalEvent, Song } from '@opentiles/song-model';
import { db } from '../storage/db';
import { getLibraryFiles } from '../storage/library';

/** Formats whose files can carry pedals. */
const PEDALLED = new Set(['midi', 'musicxml', 'mxl']);

/**
 * The pedals in a piece's file, for the bars the learner kept (P1-07); none for a file that cannot
 * be read.
 */
export function readPedals(
  fileName: string,
  bytes: Uint8Array,
  trim?: { from: number; to: number },
): PedalEvent[] {
  try {
    const song = importScore(fileName, bytes);
    return (trim ? trimMeasures(song, trim.from, trim.to) : song).pedals ?? [];
  } catch {
    return [];
  }
}

/** A library piece's song with its pedals, reading and storing them the first time. */
export async function songWithPedals(id: number): Promise<Song | undefined> {
  const row = await db.library.get(id);
  if (!row) return undefined;
  if (row.song.pedals !== undefined) return row.song;
  const files = PEDALLED.has(row.format) ? await getLibraryFiles(id) : undefined;
  const pedals = files ? readPedals(row.fileName, files.bytes, row.settings.trim) : [];
  const song: Song = { ...row.song, pedals };
  // Only the song changes; the row's sheet, map and files stay as they are.
  await db.library.update(id, { song });
  return song;
}
