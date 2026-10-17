// The Player's transport in the browser (P6-05, ADR 0019): one for the whole app, so the music
// goes on while the learner moves between pages (plan Q5). It keeps time on the page's clock and
// ticks from a worker, so it keeps playing in a hidden tab; this device's piano gets its times
// converted to the audio clock, the keyboard gets them as MIDI time stamps. Practice, drills and
// the Detector Lab take the sound over and stop it (`stopPlayer`).
import { unlockAudio } from '../audio/context';
import type { Instrument } from '../audio/instrument';
import { MidiOutInstrument, playbackInstrument } from '../audio/midi-out';
import { synthFor } from '../audio/synth';
import { midiOutputPort } from '../input/midi-input';
import { appSettings } from '../settings/store';
import { getSetting, setSetting } from '../storage/db';
import type { CollectionKey } from './collection';
import { loadPlayable } from './load';
import { onPageClock, pageNow } from './page-clock';
import { PlayerTransport } from './transport';

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
    if (on) void request();
    else {
      void held?.release().catch(() => {});
      held = null;
    }
  };
}

let transport: PlayerTransport | null = null;

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
      if (playback !== 'device') {
        const port = await midiOutputPort(output).catch(() => null);
        if (port) {
          keyboard = new MidiOutInstrument(port.sink, pageNow);
          unwatch = port.watch(() => t.outputLost());
        }
      }
      // With the keyboard chosen but out of reach, this device plays (plan Q2); "Plays on" says so.
      if (playback === 'keyboard' && keyboard) return keyboard;
      const ctx = await unlockAudio();
      const device = onPageClock(synthFor(ctx), ctx);
      return playbackInstrument(device, keyboard, keyboard ? playback : 'device');
    },
    hidden: () => document.visibilityState === 'hidden',
    played: (key) => void recordPlayed(key).catch(() => {}),
    awake,
  });
  // Leaving or reloading the page: nothing may keep sounding on the keyboard.
  window.addEventListener('pagehide', () => t.pause());
  transport = t;
  return t;
}

/** Practice, a drill or the Detector Lab takes the sound over: the Player stops, if it ever ran. */
export function stopPlayer(): void {
  transport?.stop();
}
