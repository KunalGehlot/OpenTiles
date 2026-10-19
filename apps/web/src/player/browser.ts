// The Player's transport in the browser (P6-05, ADR 0019): one for the whole app, so the music
// goes on while the learner moves between pages (plan Q5). It keeps time on the page's clock and
// ticks from a worker, so it keeps playing in a hidden tab; this device's piano gets its times
// converted to the audio clock, the keyboard gets them as MIDI time stamps. Practice, drills and
// the Detector Lab take the sound over and stop it (`stopPlayer`).
import { unlockAudio } from '../audio/context';
import type { Instrument } from '../audio/instrument';
import { MidiOutInstrument, playbackInstrument } from '../audio/midi-out';
import { synthFor } from '../audio/synth';
import { midiAllowed, midiOutputPort } from '../input/midi-input';
import { keepScreenAwake, nativeMidiAvailable } from '../input/native-midi-input';
import { appSettings } from '../settings/store';
import { getSetting, setSetting } from '../storage/db';
import type { CollectionKey } from './collection';
import { loadPlayable } from './load';
import { onPageClock, pageNow } from './page-clock';
import { readQueue } from './queue';
import type { Queue } from './queue';
import { PlayerTransport } from './transport';
import type { Song } from '@opentiles/song-model';
import { coverIndex, coverNotes, drawCover } from './art';
import { parseColour } from '../views/colour';
import type { Rgb } from '../views/colour';

/** The Player's queue, kept on this device so it is still there after a reload (P6-08). */
const QUEUE_KEY = 'device.playerQueue';

/** The queue kept from an earlier visit, if there is one. */
export async function savedQueue(): Promise<Queue | null> {
  return readQueue(await getSetting<unknown>(QUEUE_KEY, null).catch(() => null));
}

/** The Player's own "recently played", on this device only: listening is not practising. */
const PLAYED_KEY = 'device.playerPlayed';

async function recordPlayed(key: CollectionKey): Promise<void> {
  const played = await getSetting<Record<string, number>>(PLAYED_KEY, {});
  await setSetting(PLAYED_KEY, { ...played, [key]: Date.now() });
}

export async function playerPlayed(): Promise<Record<string, number>> {
  return getSetting<Record<string, number>>(PLAYED_KEY, {});
}

/** The screen stays on while the Player plays (P5-02's Wake Lock, without its idle rule). */
function wakeLock() {
  type Sentinel = { release(): Promise<void> };
  let wanted = false;
  let held: Sentinel | null = null;
  const request = async () => {
    const api = (
      navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } }
    ).wakeLock;
    if (!api || held) return;
    try {
      held = await api.request('screen');
      // The lock may have been let go while it was being granted.
      if (!wanted) void held.release().catch(() => {});
    } catch {
      // Not allowed now (a hidden tab, low battery): the screen sleeps as usual.
    }
  };
  document.addEventListener('visibilitychange', () => {
    // A hidden page loses its lock; ask again when it is back.
    held = null;
    if (wanted && document.visibilityState === 'visible') void request();
  });
  return (on: boolean) => {
    wanted = on;
    // The iPad app's web view may have no Wake Lock: the app keeps the screen on itself (P6-12).
    void keepScreenAwake(on).catch(() => {});
    if (on) void request();
    else {
      void held?.release().catch(() => {});
      held = null;
    }
  };
}

let transport: PlayerTransport | null = null;
const madeListeners = new Set<() => void>();

/** Tells `listener` when the Player's transport is made (the mini player waits for it). */
export function watchPlayer(listener: () => void): () => void {
  madeListeners.add(listener);
  return () => {
    madeListeners.delete(listener);
  };
}

/** The app's one Player transport, made on first use. */
export function playerTransport(): PlayerTransport {
  if (transport) return transport;
  let worker: Worker | null = null;
  let unwatch: (() => void) | null = null;
  const awake = wakeLock();
  const t = new PlayerTransport({
    now: pageNow,
    ticker(tick) {
      worker ??= new Worker(new URL('./clock.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = () => tick();
      worker.postMessage('start');
      return () => worker?.postMessage('stop');
    },
    load: loadPlayable,
    async instrument() {
      const { playback, output } = appSettings().midi;
      unwatch?.();
      unwatch = null;
      let keyboard: Instrument | null = null;
      // "Automatic" never asks for MIDI by itself: the browser's question comes from Connect.
      const look =
        playback === 'keyboard' ||
        playback === 'both' ||
        (playback === 'auto' && (nativeMidiAvailable() || (await midiAllowed())));
      if (look) {
        const port = await midiOutputPort(output).catch(() => null);
        if (port) {
          keyboard = new MidiOutInstrument(port.sink, pageNow);
          unwatch = port.watch(() => t.outputLost());
        }
      }
      // The keyboard's own sound when it is there ("Automatic" or "My keyboard"); with it out of
      // reach this device plays (plan Q2), and "Plays on" says so when it was chosen.
      if ((playback === 'keyboard' || playback === 'auto') && keyboard) return keyboard;
      const ctx = await unlockAudio();
      const device = onPageClock(synthFor(ctx), ctx);
      return playbackInstrument(
        device,
        keyboard,
        keyboard && playback === 'both' ? 'both' : 'device',
      );
    },
    hidden: () => document.visibilityState === 'hidden',
    touch: () => appSettings().touch,
    expressive: () => appSettings().player.expressive,
    played: (key) => void recordPlayed(key).catch(() => {}),
    awake,
  });
  // The queue as it changes, so a reload finds it again.
  let kept: Queue | null = null;
  t.subscribe(({ queue }) => {
    if (queue === kept || queue.keys.length === 0) return;
    kept = queue;
    void setSetting(QUEUE_KEY, queue).catch(() => {});
  });
  // Leaving or reloading the page: nothing may keep sounding on the keyboard.
  window.addEventListener('pagehide', () => t.pause());
  mediaSession(t);
  transport = t;
  for (const listener of madeListeners) listener();
  return t;
}

/** Practice, a drill or the Detector Lab takes the sound over: the Player stops, if it ever ran. */
export function stopPlayer(): void {
  transport?.stop('practice');
}

/** The Player's transport if one was made on this page, without making one (the mini player). */
export function existingPlayer(): PlayerTransport | null {
  return transport;
}

/**
 * The piece playing for the device's own media controls (Media Session, P6-09): title, composer,
 * the generated cover, and play, pause, previous, next and seek. Browsers show these controls only
 * for some kinds of sound; where they do not, nothing happens. The title goes to this device's own
 * controls only.
 */
function mediaSession(t: PlayerTransport): void {
  const session = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
  if (!session || typeof MediaMetadata === 'undefined') return;
  const handle = (action: MediaSessionAction, run: (d: MediaSessionActionDetails) => void) => {
    try {
      session.setActionHandler(action, run);
    } catch {
      // An action this browser does not know.
    }
  };
  // Where the piece is, so the controls can show and move it: song seconds go by at the tempo.
  const position = () => {
    const { duration, tempo } = t.state;
    if (!session.setPositionState || duration <= 0 || tempo <= 0) return;
    try {
      session.setPositionState({
        duration,
        playbackRate: tempo,
        position: Math.min(duration, t.positionNow()),
      });
    } catch {
      // A position the browser will not take: the controls show none.
    }
  };
  // A play from the lock screen may not count as a gesture: if the sound cannot start, nothing
  // plays and nothing breaks (unlockAudio waits only a moment).
  handle('play', () => void t.play());
  handle('pause', () => t.pause());
  handle('previoustrack', () => void t.previous());
  handle('nexttrack', () => void t.next());
  handle('seekto', (d) => {
    if (d.seekTime === undefined) return;
    t.seek(d.seekTime);
    position();
  });
  let shown: Song | null = null;
  t.subscribe((state) => {
    session.playbackState =
      state.status === 'playing' || state.status === 'between' ? 'playing' : 'paused';
    position();
    const piece = state.piece;
    if (!piece || piece.song === shown) return;
    shown = piece.song;
    session.metadata = new MediaMetadata({
      title: piece.title,
      artist: piece.composer ?? '',
      artwork: coverArtwork(piece),
    });
  });
}

/** The generated cover as a picture for the media controls; none where a canvas is not there. */
function coverArtwork(piece: { song: Song; title: string; composer?: string }): MediaImage[] {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    const css = getComputedStyle(document.documentElement);
    const name = piece.composer ?? piece.title;
    const read = (token: string, fallback: Rgb) =>
      parseColour(css.getPropertyValue(token).trim())?.rgb ?? fallback;
    drawCover(
      ctx,
      256,
      coverNotes(piece.song),
      read(`--cover-${coverIndex(name)}`, [45, 91, 138]),
      read('--on-cover', [255, 255, 255]),
      0,
    );
    return [{ src: canvas.toDataURL('image/png'), sizes: '256x256', type: 'image/png' }];
  } catch {
    return [];
  }
}
