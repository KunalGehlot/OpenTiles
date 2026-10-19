// The way into the Player from elsewhere (P6-07): "Listen" on the Home and Library cards and in
// practice plays that piece in the Player and then the programme after it, as a row there does.
import { unlockAudio } from '../audio/context';
import { locale } from '../i18n';
import { href } from '../lib/router';
import { playerTransport } from './browser';
import type { CollectionKey } from './collection';
import { loadCollection } from './load';
import { listenQueue, programme } from './programme';

/**
 * Opens the Player playing `key`. Call it from a click: the sound may start on this device, which
 * Safari allows only inside a user gesture (spec §5), so the audio is unlocked here first.
 */
export async function listenInPlayer(key: CollectionKey): Promise<void> {
  void unlockAudio().catch(() => {});
  const transport = playerTransport();
  window.location.hash = href({ name: 'player' });
  const entries = await loadCollection().catch(() => []);
  const works = programme(entries, locale()).flatMap((g) => g.works);
  await transport.playQueue(listenQueue(works, key));
}
