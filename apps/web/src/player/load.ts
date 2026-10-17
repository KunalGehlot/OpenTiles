// Reads the Player's collection (P6-04): the catalogue index, the library rows (never their files)
// and progress, all on this device or from the app's own origin.
import type { Song } from '@opentiles/song-model';
import { loadCatalogue, loadCatalogueSong } from '../catalogue/catalogue';
import { db, getSetting, setSetting } from '../storage/db';
import { libraryRows } from '../storage/library';
import { songWithPedals } from '../library/pedals';
import { t } from '../i18n';
import { buildCollection, songSeconds } from './collection';
import type { CollectionEntry, CollectionKey } from './collection';

/**
 * Catalogue lengths, remembered the first time each piece loads on this device. The index has no
 * lengths: working them out needs the full score reader, which runs here anyway. A `device.` key,
 * so it stays out of the backup and sync.
 */
const SECONDS_KEY = 'device.catalogueSeconds';

async function rememberSeconds(slug: string, song: Song): Promise<void> {
  const known = await getSetting<Record<string, number>>(SECONDS_KEY, {});
  const seconds = Math.round(songSeconds(song) * 10) / 10;
  if (known[slug] !== seconds) await setSetting(SECONDS_KEY, { ...known, [slug]: seconds });
}

/** Every piece the learner can play: the catalogue (verified only in production) and the library. */
export async function loadCollection(): Promise<CollectionEntry[]> {
  const [catalogue, library, progress, catalogueSeconds, listened] = await Promise.all([
    // Offline before the index was ever cached, the library still lists.
    loadCatalogue().catch(() => []),
    libraryRows(),
    db.progress.toArray(),
    getSetting<Record<string, number>>(SECONDS_KEY, {}),
    getSetting<Record<string, number>>('device.playerPlayed', {}),
  ]);
  return buildCollection({
    catalogue,
    library,
    progress,
    catalogueSeconds,
    listened,
    showUnverified: __SHOW_UNVERIFIED__,
  });
}

/** The song to play for an entry, with what the Player shows about it. */
export async function loadPlayable(
  key: CollectionKey,
): Promise<{ song: Song; title: string; composer?: string }> {
  if (key.startsWith('catalogue:')) {
    const slug = key.slice('catalogue:'.length);
    const { piece, song } = await loadCatalogueSong(slug);
    void rememberSeconds(slug, song).catch(() => {});
    return { song, title: piece.title, composer: piece.composer };
  }
  // The row holds the song; the file is read once, for pedals stored songs lack (P6-10).
  const id = Number(key.slice('library:'.length));
  const [row, song] = await Promise.all([db.library.get(id), songWithPedals(id)]);
  if (!row || !song) throw new Error(t('This piece is not in your library on this device.'));
  return {
    song,
    title: row.title,
    ...(row.song.composer ? { composer: row.song.composer } : {}),
  };
}
