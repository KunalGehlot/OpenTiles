// The Player (P6-06, P6-07, ADR 0019, docs/phase-6/player-piano.md): a self-playing grand piano.
// The programme lists all the learner's music, the catalogue and the library, as a concert
// programme does; the music room shows the piece playing as a player piano, its paper roll moving
// down onto keys that go down by themselves. It plays through the app's one transport (P6-05), so
// the music goes on while the learner moves to other pages; practice stops it. Stand mode shows
// the music room alone, for a laptop or iPad on the music rest.
//
// Everything that moves is drawn on canvases from one requestAnimationFrame loop that reads the
// transport's position through refs (docs/architecture.md); React lays out the page and the
// controls only.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  ChevronDown,
  GraduationCap,
  GripVertical,
  ListMusic,
  Maximize2,
  Minimize2,
  Pause,
  Piano,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { buildPlayback } from '@opentiles/practice';
import type { HandFilter } from '@opentiles/practice';
import { TempoMap } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import { playsOn, playsOnUnavailableHint } from '../audio/plays-on';
import {
  midiAccess,
  midiAllowed,
  midiSupported,
  midiUnavailableReason,
  pickOutput,
  webMidiSupported,
} from '../input/midi-input';
import { nativeMidiAvailable } from '../input/native-midi-input';
import { locale, t } from '../i18n';
import { href } from '../lib/router';
import { coverIndex, initials } from '../player/art';
import { playerTransport, savedQueue } from '../player/browser';
import { practiceRoute, searchCollection, sortCollection } from '../player/collection';
import type { CollectionEntry, CollectionSort } from '../player/collection';
import { loadCollection } from '../player/load';
import { createHdrLayer, hdrPossible } from '../player/hdr';
import type { HdrLayer } from '../player/hdr';
import {
  LEADER_SECONDS,
  drawRoom,
  readRoomColours,
  roomGeometry,
  roomLights,
  rollData,
} from '../player/piano';
import type { RollData, RoomColours, RoomGeometry } from '../player/piano';
import { origin, programme, TRADITIONAL, worksOf } from '../player/programme';
import type { ComposerGroup, Work } from '../player/programme';
import { clearUpNext, keepKnown, moveUpNext, removeUpNext, upNext } from '../player/queue';
import type { Repeat as RepeatMode } from '../player/queue';
import type { PlayerTransport, TransportState } from '../player/transport';
import { PlaysOnControl } from '../practice/PlaysOnControl';
import type { MidiPlayback } from '../settings/model';
import { updateAppSettings, useAppSettings, useEffectiveAccessibility } from '../settings/store';
import { Popover } from '../ui/Popover';
import { SearchBox } from '../ui/SearchBox';

type Filter = 'all' | 'library' | 'catalogue';

/** What every canvas needs each frame: where the music is. */
interface Frame {
  song: Song;
  beat: number;
  /** 0..1 of the piece. */
  fraction: number;
  seconds: number;
  total: number;
  /** Where the roll is: the position, and past the end while the next piece's leader passes. */
  roll: number;
}

type Draw = (frame: Frame) => void;

/** Canvases register a draw function; the page's one loop calls them every frame. */
const FrameContext = createContext<(draw: Draw) => () => void>(() => () => {});

function useFrame(draw: Draw): void {
  const register = useContext(FrameContext);
  const ref = useRef(draw);
  ref.current = draw;
  useEffect(() => register((f) => ref.current(f)), [register]);
}

/** Sizes a canvas to its box at the device's pixel ratio; returns the box in CSS px. */
function fit(
  canvas: HTMLCanvasElement,
  settings?: CanvasRenderingContext2DSettings,
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d', settings);
  if (!ctx) return null;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** A wide-gamut screen: the music room is drawn in Display P3, so its gold can be richer. */
function wideScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(color-gamut: p3)').matches;
}

/** Calls `onChange` when the colours may have changed: light or dark, a theme or high contrast. */
function useThemeChange(onChange: () => void): void {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    const call = () => ref.current();
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', call);
    const observer = new MutationObserver(call);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-high-contrast'],
    });
    return () => {
      scheme.removeEventListener('change', call);
      observer.disconnect();
    };
  }, []);
}

const formatTime = (s: number) => {
  const whole = Math.max(0, Math.round(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const coverName = (e: Pick<CollectionEntry, 'composer' | 'title'>) => e.composer ?? e.title;

/** The app's Player transport as React state; the canvases read its position every frame. */
function useTransport(): { transport: PlayerTransport; state: TransportState } {
  const transport = useMemo(() => playerTransport(), []);
  const state = useSyncExternalStore(
    (onChange) => transport.subscribe(() => onChange()),
    () => transport.state,
  );
  return { transport, state };
}

/**
 * What "Plays on" needs to know about MIDI here: asked of the page's one MIDI access once the
 * site may use MIDI (never prompting by itself), and again when keyboards come and go.
 */
function useMidiState(): {
  connected: boolean;
  inputs: string[];
  outputs: string[];
  connect: () => Promise<void>;
} {
  const [state, setState] = useState({
    connected: false,
    inputs: [] as string[],
    outputs: [] as string[],
  });
  const accessRef = useRef<MIDIAccess | null>(null);
  const read = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    const names = (ports: MIDIInputMap | MIDIOutputMap) =>
      [...ports.values()].map((p) => p.name ?? 'MIDI device');
    setState({ connected: true, inputs: names(access.inputs), outputs: names(access.outputs) });
  }, []);
  const attach = useCallback(async () => {
    const access = await midiAccess();
    if (accessRef.current !== access) {
      accessRef.current?.removeEventListener('statechange', read);
      accessRef.current = access;
      access.addEventListener('statechange', read);
    }
    read();
  }, [read]);
  useEffect(() => {
    let cancelled = false;
    void midiAllowed().then((ok) => {
      if (ok && !cancelled) void attach().catch(() => {});
    });
    return () => {
      cancelled = true;
      accessRef.current?.removeEventListener('statechange', read);
    };
  }, [attach, read]);
  return { ...state, connect: attach };
}

/** The element in full screen, with Safari's prefixed API where the plain one is missing. */
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

function requestFullscreen(el: HTMLElement): void {
  const target = el as FullscreenElement;
  try {
    if (target.requestFullscreen) void target.requestFullscreen().catch(() => {});
    else void target.webkitRequestFullscreen?.();
  } catch {
    // Not offered here (an iPhone, an embedded view): stand mode still fills the window.
  }
}

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function exitFullscreen(): void {
  const doc = document as FullscreenDocument;
  if (!fullscreenElement()) return;
  try {
    if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => {});
    else void doc.webkitExitFullscreen?.();
  } catch {
    // Already left.
  }
}

/** Stand mode's controls fade after this long without a tap, a mouse move or a key. */
const STAND_IDLE_MS = 3000;

const REPEAT_NEXT: Record<RepeatMode, RepeatMode> = { off: 'all', all: 'one', one: 'off' };

export function Player() {
  const settings = useAppSettings();
  const { reducedMotion } = useEffectiveAccessibility();
  const { transport, state } = useTransport();
  const midi = useMidiState();
  const [entries, setEntries] = useState<CollectionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<CollectionSort>('composer');
  const { showHands, expressive } = settings.player;
  /** Lights brighter than white on an HDR screen; offered only where the screen can show them. */
  const [hdr, setHdr] = useState(true);
  const [queueOpen, setQueueOpen] = useState(false);
  /** On a narrow screen, the music room open over the programme. */
  const [roomOpen, setRoomOpen] = useState(false);
  const [stand, setStand] = useState(false);
  const [idle, setIdle] = useState(false);
  const roomRef = useRef<HTMLElement>(null);

  useEffect(() => {
    loadCollection().then(setEntries, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const byKey = useMemo(() => new Map((entries ?? []).map((e) => [e.key, e])), [entries]);
  const current = state.key ? (byKey.get(state.key) ?? null) : null;
  const song = state.piece?.song ?? null;
  const playing = state.status === 'playing' || state.status === 'between';

  const scoped = useMemo(
    () =>
      searchCollection(
        (entries ?? []).filter((e) => filter === 'all' || e.source === filter),
        query,
      ),
    [entries, filter, query],
  );
  /** The programme grouped by composer, or a plain list in the order the learner sorts by. */
  const groups = useMemo<ComposerGroup[]>(
    () =>
      sort === 'composer'
        ? programme(scoped, locale())
        : [{ composer: null, works: worksOf(sortCollection(scoped, sort, locale())) }],
    [scoped, sort],
  );
  const shownWorks = useMemo(() => groups.flatMap((g) => g.works), [groups]);
  /** What comes after this piece, each with its place in the queue's Up next. */
  const upNextItems = useMemo(
    () =>
      upNext(state.queue).flatMap((k, place) => {
        const entry = byKey.get(k);
        return entry ? [{ place, entry }] : [];
      }),
    [state.queue, byKey],
  );

  // Something to show from the start, without playing: the queue kept from the last visit (P6-08),
  // or else the programme, at Ode to Joy if it is there. A queue the Player already has on this
  // page stays.
  useEffect(() => {
    if (!entries || transport.state.key) return;
    let cancelled = false;
    void savedQueue().then((saved) => {
      if (cancelled || transport.state.key) return;
      const playable = new Set(entries.filter((e) => e.playable).map((e) => e.key));
      const kept = saved && keepKnown(saved, (k) => playable.has(k));
      if (kept && kept.keys.length > 0) {
        void transport.restore(kept);
        return;
      }
      const works = programme(entries, locale())
        .flatMap((g) => g.works)
        .filter((w) => w.entry.playable);
      const start = works.findIndex((w) =>
        w.versions.some((v) => v.key === 'catalogue:ode-to-joy'),
      );
      void transport.cue(
        works.map((w) => w.entry.key),
        Math.max(0, start),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [entries, transport]);

  const playableKeys = (works: readonly Work[]) =>
    works.filter((w) => w.entry.playable).map((w) => w.entry.key);

  /** Plays the works as shown, from `work` on. */
  const playFrom = (work: Work) => {
    const keys = playableKeys(shownWorks);
    void transport.playQueue(keys, Math.max(0, keys.indexOf(work.entry.key)));
  };

  /** Everything shown, shuffled, round and round until stopped: the piano in a hotel lobby. */
  const letItPlay = () => {
    const keys = playableKeys(shownWorks);
    if (keys.length === 0) return;
    transport.setShuffle(true);
    transport.setRepeat('all');
    void transport.playQueue(keys, Math.floor(Math.random() * keys.length));
  };

  // One loop for every canvas on the page, reading the transport's position.
  const draws = useRef(new Set<Draw>());
  const register = useMemo(
    () => (draw: Draw) => {
      draws.current.add(draw);
      return () => void draws.current.delete(draw);
    },
    [],
  );
  useEffect(() => {
    if (!song) return;
    const map = new TempoMap(song.tempos);
    let raf = 0;
    const loop = () => {
      const st = transport.state;
      const total = Math.max(0.1, st.duration);
      const s = Math.min(total, transport.positionNow());
      // Between two pieces the roll turns on at the speed it played, for the leader to pass.
      const roll = st.status === 'between' ? total + (st.gap - transport.gapLeft()) * st.tempo : s;
      const frame = {
        song,
        beat: map.secondsToBeat(s),
        fraction: s / total,
        seconds: s,
        total,
        roll,
      };
      for (const draw of draws.current) draw(frame);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [song, transport]);

  const enterStand = () => {
    setStand(true);
    setIdle(false);
    if (roomRef.current) requestFullscreen(roomRef.current);
  };
  const leaveStand = useCallback(() => {
    setStand(false);
    exitFullscreen();
  }, []);

  // Leaving full screen with the browser's own Escape leaves stand mode too.
  useEffect(() => {
    if (!stand) return;
    let wasFull = false;
    const onChange = () => {
      if (fullscreenElement()) wasFull = true;
      else if (wasFull) setStand(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [stand]);

  // In stand mode the controls fade when nothing moves for a while, and come back on any touch.
  useEffect(() => {
    if (!stand) return;
    let timer = window.setTimeout(() => setIdle(true), STAND_IDLE_MS);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), STAND_IDLE_MS);
    };
    const events = ['pointermove', 'pointerdown', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, wake);
    return () => {
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, wake);
    };
  }, [stand]);

  // Space plays and pauses, ← and → move 5 s, Shift with them goes to the piece before or after,
  // F switches stand mode and Escape leaves it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, select, textarea, [role="slider"]')) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        void transport.toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const forward = e.key === 'ArrowRight';
        e.preventDefault();
        if (e.shiftKey) void (forward ? transport.next() : transport.previous());
        else transport.seek(transport.positionNow() + (forward ? 5 : -5));
      } else if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (stand) leaveStand();
        else enterStand();
      } else if (e.key === 'Escape' && stand) {
        leaveStand();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const supported = midiSupported();
  const choice = settings.midi.playback;
  // In the iPad app the keyboard is reached through CoreMIDI when Play is pressed.
  const route = nativeMidiAvailable()
    ? playsOn(choice, {
        supported: true,
        connected: true,
        inputs: [],
        outputs: ['keyboard'],
        name: '',
      })
    : playsOn(choice, {
        supported,
        connected: midi.connected,
        inputs: midi.inputs,
        outputs: midi.outputs,
        name: settings.midi.output,
      });
  // A keyboard connected or chosen while the Player plays takes the notes over at once.
  const target = `${route.effective}/${route.output ?? ''}`;
  useEffect(() => {
    void transport.changeInstrument();
  }, [target, transport]);
  const connectPiano = () => void midi.connect().catch(() => {});
  const choosePlayback = (playback: MidiPlayback) => {
    void updateAppSettings({ midi: { ...settings.midi, playback } }).then(() =>
      transport.changeInstrument(),
    );
    if (playback !== 'device' && !midi.connected && webMidiSupported()) {
      void midi.connect().catch(() => {});
    }
  };
  const playsOnControl = (
    <PlaysOnControl
      choice={choice}
      route={route}
      supported={supported}
      keyboardName={
        nativeMidiAvailable() ? null : pickOutput(midi.outputs, midi.inputs, settings.midi.output)
      }
      outputs={midi.outputs}
      outputName={settings.midi.output}
      unavailableHint={playsOnUnavailableHint(
        midiUnavailableReason({
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          secure: window.isSecureContext,
        }),
      )}
      onChoose={choosePlayback}
      onOutput={(output) =>
        void updateAppSettings({ midi: { ...settings.midi, output } }).then(() =>
          transport.changeInstrument(),
        )
      }
    />
  );

  const { repeat, shuffle } = state.queue;
  const transportButtons = (
    <div className="np-transport" role="group" aria-label={t('Playback')}>
      <button
        className="np-icon"
        aria-label={t('Shuffle')}
        aria-pressed={shuffle}
        onClick={() => transport.setShuffle(!shuffle)}
      >
        <Shuffle />
      </button>
      <button
        className="np-icon"
        aria-label={t('Previous piece')}
        onClick={() => void transport.previous()}
      >
        <SkipBack />
      </button>
      <button
        className="np-play primary"
        aria-label={playing ? t('Pause') : t('Play')}
        onClick={() => void transport.toggle()}
        disabled={!song}
        aria-busy={state.status === 'loading'}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <button
        className="np-icon"
        aria-label={t('Next piece')}
        onClick={() => void transport.next()}
      >
        <SkipForward />
      </button>
      <button
        className="np-icon"
        aria-label={repeat === 'one' ? t('Repeat this piece') : t('Repeat')}
        aria-pressed={repeat !== 'off'}
        onClick={() => transport.setRepeat(REPEAT_NEXT[repeat])}
      >
        {repeat === 'one' ? <Repeat1 /> : <Repeat />}
      </button>
    </div>
  );

  const options = (
    <Popover
      label={t('Playback options')}
      icon={<SlidersHorizontal />}
      className="np-icon room__options"
      title={t('Playback options')}
    >
      <label className="tempo" title={t('Tempo')}>
        <span className="tempo__label">{t('Tempo')}</span>
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={Math.round(state.tempo * 100)}
          onChange={(e) => transport.setTempo(Number(e.target.value) / 100)}
        />
        <span className="tempo__value">{Math.round(state.tempo * 100)} %</span>
      </label>
      <div className="segmented" role="group" aria-label={t('Hands')}>
        {(
          [
            ['left', t('Left')],
            ['both', t('Both')],
            ['right', t('Right')],
          ] as const
        ).map(([h, label]) => (
          <button key={h} aria-pressed={state.hands === h} onClick={() => transport.setHands(h)}>
            {label}
          </button>
        ))}
      </div>
      <label
        className="check"
        title={t('Shape each phrase, and use the sustain pedal where the piece has none')}
      >
        <input
          type="checkbox"
          checked={expressive}
          onChange={(e) => {
            const on = e.target.checked;
            void updateAppSettings({ player: { ...settings.player, expressive: on } }).then(() =>
              transport.reshape(),
            );
          }}
        />
        {t('Play expressively')}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={showHands}
          onChange={(e) =>
            void updateAppSettings({ player: { ...settings.player, showHands: e.target.checked } })
          }
        />
        {t('Show hands')}
      </label>
      {hdrPossible() && (
        <label className="check">
          <input type="checkbox" checked={hdr} onChange={(e) => setHdr(e.target.checked)} />
          {t('HDR highlights')}
        </label>
      )}
      {state.key && (
        <a className="button quiet" href={href(practiceRoute(state.key))}>
          <GraduationCap /> {t('Practise this')}
        </a>
      )}
    </Popover>
  );

  const message =
    state.message === 'disconnected' ? (
      <p className="notice notice--warn player__message" role="status" data-testid="player-message">
        {t('Your keyboard was disconnected.')}{' '}
        <button
          onClick={() => {
            void updateAppSettings({ midi: { ...settings.midi, playback: 'device' } }).then(() =>
              transport.play(),
            );
          }}
        >
          {t('Play on this device')}
        </button>
      </p>
    ) : state.message === 'failed' ? (
      <p className="error" role="status">
        {t('This piece could not be loaded.')}
      </p>
    ) : state.message === 'practice' ? (
      <p className="muted player__message" role="status" data-testid="player-message">
        {t('Stopped while you practise.')}
      </p>
    ) : null;

  const nextEntry = upNextItems[0]?.entry;
  const room = current && (
    <section
      ref={roomRef}
      className={`room${stand ? ' room--stand' : ''}${stand && idle ? ' room--idle' : ''}`}
      aria-label={t('Now playing')}
    >
      <header className="room__head">
        <button
          className="np-icon room__close"
          aria-label={t('Close')}
          onClick={() => setRoomOpen(false)}
        >
          <ChevronDown />
        </button>
        <RoomTitle entry={current} />
        <div className="room__actions">
          {route.connect && (
            <button className="room__connect" onClick={connectPiano}>
              <Piano /> {t('Play on your piano')}
            </button>
          )}
          {playsOnControl}
          {options}
          <button
            className="np-icon"
            aria-label={t('Up next')}
            aria-expanded={queueOpen}
            onClick={() => setQueueOpen((v) => !v)}
          >
            <ListMusic />
          </button>
          <button
            className="np-icon"
            aria-label={stand ? t('Leave the music stand view') : t('Music stand view')}
            aria-pressed={stand}
            onClick={() => (stand ? leaveStand() : enterStand())}
          >
            {stand ? <Minimize2 /> : <Maximize2 />}
          </button>
        </div>
      </header>
      {song && (
        <MusicRoom
          transport={transport}
          hands={state.hands}
          touch={settings.touch}
          expressive={expressive}
          showHands={showHands}
          still={reducedMotion}
          active={state.status === 'playing'}
          hdr={hdr}
          nextTitle={nextEntry ? { title: nextEntry.title, composer: nextEntry.composer } : null}
        />
      )}
      {stand && nextEntry && (
        <p className="room__next">{t('Next: {title}', { title: nextEntry.title })}</p>
      )}
      <div className="room__deck">
        <Progress onSeek={(s) => transport.seek(s)} />
        {transportButtons}
      </div>
      {message}
    </section>
  );

  return (
    <FrameContext.Provider value={register}>
      <div
        className={`player${roomOpen ? ' player--room-open' : ''}${stand ? ' player--stand' : ''}${
          queueOpen ? ' player--queue' : ''
        }`}
      >
        <header className="player__head visually-hidden">
          <h1>{t('Player')}</h1>
          <p className="muted">
            {t(
              'Everything you can play, the catalogue and your library, played on this device or your keyboard.',
            )}
          </p>
        </header>
        {error && <p className="error">{error}</p>}
        <div className="player__body">
          <section className="collection" aria-label={t('All music')}>
            <button
              className="primary programme__play"
              onClick={letItPlay}
              disabled={shownWorks.length === 0}
            >
              <Play /> {t('Let it play')}
            </button>
            <SearchBox
              value={query}
              onChange={setQuery}
              label={t('Search all music')}
              placeholder={t('Search all music')}
            />
            <div className="collection__tools">
              <div className="segmented" role="group" aria-label={t('Show')}>
                {(
                  [
                    ['all', t('All')],
                    ['library', t('My library')],
                    ['catalogue', t('Catalogue')],
                  ] as const
                ).map(([f, label]) => (
                  <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {label}
                  </button>
                ))}
              </div>
              <label className="collection__sort">
                <span className="visually-hidden">{t('Sort by')}</span>
                <select
                  aria-label={t('Sort by')}
                  value={sort}
                  onChange={(e) => setSort(e.target.value as CollectionSort)}
                >
                  <option value="composer">{t('Composer')}</option>
                  <option value="title">{t('Title')}</option>
                  <option value="added">{t('Recently added')}</option>
                  <option value="played">{t('Recently played')}</option>
                  <option value="length">{t('Length')}</option>
                </select>
              </label>
            </div>
            {entries === null ? (
              <p className="muted">{t('Loading…')}</p>
            ) : shownWorks.length === 0 ? (
              <p className="muted">
                {t('Nothing matches.')}{' '}
                <a href={href({ name: 'library' })}>{t('Import a piece')}</a>
              </p>
            ) : (
              <div className="collection__list">
                {groups.map((group) => (
                  <ProgrammeGroup
                    key={group.composer ?? ''}
                    group={group}
                    grouped={sort === 'composer'}
                    currentKey={current?.key ?? null}
                    playing={playing}
                    onPlay={playFrom}
                    onPlayAll={() => {
                      const keys = playableKeys(group.works);
                      if (keys.length) void transport.playQueue(keys, 0);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
          {room}
          <UpNext
            items={upNextItems}
            onPlay={(place) => void transport.playUpNext(place)}
            onMove={(from, to) => transport.editUpNext((q) => moveUpNext(q, from, to))}
            onRemove={(place) => transport.editUpNext((q) => removeUpNext(q, place))}
            onClear={() => transport.editUpNext(clearUpNext)}
          />
        </div>
        {current && (
          <MiniBar
            entry={current}
            playing={playing}
            onToggle={() => void transport.toggle()}
            onNext={() => void transport.next()}
            onOpen={() => setRoomOpen(true)}
          />
        )}
      </div>
    </FrameContext.Provider>
  );
}

interface UpNextItem {
  /** Its place in the queue's Up next (0 plays next). */
  place: number;
  entry: CollectionEntry;
}

/**
 * Up next (P6-08): what plays after this piece. A tap plays one now; its handle moves it, by
 * dragging or with ↑ and ↓ (Alt with them anywhere on its row); × takes it out.
 */
function UpNext({
  items,
  onPlay,
  onMove,
  onRemove,
  onClear,
}: {
  items: readonly UpNextItem[];
  onPlay(place: number): void;
  onMove(from: number, to: number): void;
  onRemove(place: number): void;
  onClear(): void;
}) {
  const list = useRef<HTMLOListElement>(null);
  /** A drag in progress: the row's place and the slot it would land in. */
  const [drag, setDrag] = useState<{ from: number; slot: number } | null>(null);
  // The latest rows and handler, for a drag's window listeners.
  const latest = useRef({ items, onMove });
  latest.current = { items, onMove };
  const [said, setSaid] = useState('');
  /** After a move with the keys, the moved piece's handle keeps the focus. */
  const focusSlot = useRef<number | null>(null);
  useEffect(() => {
    if (focusSlot.current === null) return;
    const rows = list.current?.querySelectorAll<HTMLElement>('.upnext__handle');
    rows?.[focusSlot.current]?.focus();
    focusSlot.current = null;
  });

  // While dragging, the rows show the order it would make.
  const fromIndex = drag ? items.findIndex((it) => it.place === drag.from) : -1;
  const shown = [...items];
  if (drag && fromIndex >= 0) {
    const [moving] = shown.splice(fromIndex, 1);
    if (moving) shown.splice(drag.slot, 0, moving);
  }
  /** The slot under the pointer: how many of the other rows have their middle above it. */
  const slotAt = (y: number) =>
    [...(list.current?.children ?? [])]
      .filter((row) => !row.classList.contains('upnext__item--moving'))
      .filter((row) => {
        const r = row.getBoundingClientRect();
        return y > r.top + r.height / 2;
      }).length;
  /**
   * A drag by a row's handle. The rows show the new order as it goes, which moves the row in the
   * page and loses the pointer's capture, so the window follows the pointer instead.
   */
  const startDrag = (e: ReactPointerEvent, from: number, slot: number) => {
    e.preventDefault();
    setDrag({ from, slot });
    const follow = (ev: PointerEvent) => setDrag({ from, slot: slotAt(ev.clientY) });
    const stop = () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', stop);
      setDrag(null);
    };
    const drop = (ev: PointerEvent) => {
      const target = latest.current.items[slotAt(ev.clientY)];
      if (target && target.place !== from) latest.current.onMove(from, target.place);
      stop();
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', stop);
  };

  const move = (index: number, by: number) => {
    const item = items[index];
    const target = items[index + by];
    if (!item || !target) return;
    onMove(item.place, target.place);
    focusSlot.current = index + by;
    setSaid(t('{title}: place {n} in Up next', { title: item.entry.title, n: index + by + 1 }));
  };

  return (
    <aside className="upnext" aria-label={t('Up next')}>
      <div className="upnext__head">
        <h2>
          <ListMusic /> {t('Up next')}
        </h2>
        {items.length > 0 && (
          <button className="quiet" onClick={onClear}>
            {t('Clear')}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="muted upnext__empty">{t('Nothing more to play.')}</p>
      ) : (
        <ol ref={list}>
          {shown.map(({ place, entry }, slot) => (
            <li
              key={`${place}:${entry.key}`}
              className={
                drag?.from === place ? 'upnext__item upnext__item--moving' : 'upnext__item'
              }
              onKeyDown={(e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                move(slot, e.key === 'ArrowUp' ? -1 : 1);
              }}
            >
              <button
                className="np-icon quiet upnext__handle"
                aria-label={t('Move {title}', { title: entry.title })}
                title={t('Drag, or use ↑ and ↓')}
                onPointerDown={(e) => startDrag(e, place, slot)}
                onKeyDown={(e) => {
                  if (e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                  e.preventDefault();
                  move(slot, e.key === 'ArrowUp' ? -1 : 1);
                }}
              >
                <GripVertical />
              </button>
              <button
                className="collection__row"
                onClick={() => onPlay(place)}
                title={t('Play now')}
              >
                <InitialsTile entry={entry} />
                <span className="collection__text">
                  <span className="collection__title">{entry.title}</span>
                  <span className="collection__meta">{entry.composer}</span>
                </span>
              </button>
              <button
                className="np-icon quiet"
                aria-label={t('Remove {title} from Up next', { title: entry.title })}
                onClick={() => onRemove(place)}
              >
                <X />
              </button>
            </li>
          ))}
        </ol>
      )}
      <span className="visually-hidden" aria-live="polite">
        {said}
      </span>
    </aside>
  );
}

function InitialsTile({ entry }: { entry: CollectionEntry }) {
  return (
    <span className={`tile cover-${coverIndex(coverName(entry))}`} aria-hidden="true">
      {initials(coverName(entry))}
    </span>
  );
}

/** One composer's works, under their name, as a concert programme lists them. */
function ProgrammeGroup({
  group,
  grouped,
  currentKey,
  playing,
  onPlay,
  onPlayAll,
}: {
  group: ComposerGroup;
  grouped: boolean;
  currentKey: string | null;
  playing: boolean;
  onPlay: (work: Work) => void;
  onPlayAll: () => void;
}) {
  const heading =
    group.composer === TRADITIONAL ? t('Traditional') : (group.composer ?? t('Other pieces'));
  return (
    <section className="programme__group" aria-label={grouped ? heading : undefined}>
      {grouped && (
        <div className="programme__heading">
          <h3>{heading}</h3>
          {group.works.length > 1 && (
            <button className="programme__all" onClick={onPlayAll}>
              {t('Play all')}
            </button>
          )}
        </div>
      )}
      <ul>
        {group.works.map((work) => {
          const e = work.entry;
          const isCurrent = work.versions.some((v) => v.key === currentKey);
          const meta = grouped
            ? group.composer === TRADITIONAL
              ? origin(e.composer)
              : null
            : (e.composer ?? null);
          return (
            <li key={e.key}>
              <button
                className="collection__row"
                aria-current={isCurrent ? 'true' : undefined}
                disabled={!e.playable}
                onClick={() => onPlay(work)}
              >
                {!grouped && <InitialsTile entry={e} />}
                <span className="collection__text">
                  <span className="collection__title">{e.title}</span>
                  {(meta || e.source === 'library') && (
                    <span className="collection__meta">
                      {[meta, e.source === 'library' ? t('My library') : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </span>
                {isCurrent && playing && <span className="programme__playing" aria-hidden="true" />}
                <span className="collection__length">
                  {e.seconds !== undefined ? formatTime(e.seconds) : ''}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The title as a printed programme gives it: the piece, then the composer in small capitals. */
function RoomTitle({ entry }: { entry: CollectionEntry }) {
  const composer = entry.composer && origin(entry.composer) ? t('Traditional') : entry.composer;
  const from = origin(entry.composer);
  return (
    <div className="np-text room__title">
      <h2 aria-live="polite">{entry.title}</h2>
      <p className="room__composer">
        {[composer, from, entry.source === 'library' ? t('My library') : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

/** A piece's roll, kept while its song, hands and way of playing stay the same. */
function useRollCache(): (
  song: Song,
  hands: HandFilter,
  touch: 'natural' | 'even',
  expressive: boolean,
) => RollData {
  const cache = useRef(new Map<Song, { key: string; data: RollData }>());
  return useCallback((song, hands, touch, expressive) => {
    const key = `${hands}/${touch}/${expressive}`;
    const known = cache.current.get(song);
    if (known?.key === key) return known.data;
    // The same events the transport plays, so the keys and the pedal light follow the sound.
    const data = rollData(buildPlayback(song, { hands, touch, expressive }));
    // Two songs at most: the one playing and the one after the gap.
    if (cache.current.size > 2) cache.current.clear();
    cache.current.set(song, { key, data });
    return data;
  }, []);
}

/** The player piano: the roll, the tracker bar, the keys and the pedals, drawn every frame. */
function MusicRoom({
  transport,
  hands,
  touch,
  expressive,
  showHands,
  still,
  active,
  hdr,
  nextTitle,
}: {
  transport: PlayerTransport;
  hands: HandFilter;
  touch: 'natural' | 'even';
  expressive: boolean;
  showHands: boolean;
  still: boolean;
  active: boolean;
  /** Draw the lights again, brighter than white, where the screen and browser can show it. */
  hdr: boolean;
  nextTitle: { title: string; composer?: string } | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hdrCanvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HdrLayer | null>(null);
  const wide = useMemo(wideScreen, []);
  const colours = useRef<RoomColours | null>(null);
  const geometry = useRef<{ key: string; g: RoomGeometry } | null>(null);
  const roll = useRollCache();
  useThemeChange(() => {
    colours.current = null;
  });
  // The HDR layer, made again when the window moves between an HDR screen and another.
  const [hdrScreen, setHdrScreen] = useState(hdrPossible);
  useEffect(() => {
    const media = matchMedia('(dynamic-range: high)');
    const update = () => setHdrScreen(hdrPossible());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const el = hdrCanvas.current;
    if (!hdr || !hdrScreen || !el) return;
    let cancelled = false;
    void createHdrLayer(el).then((made) => {
      if (cancelled) made?.destroy();
      else layer.current = made;
    });
    return () => {
      cancelled = true;
      layer.current?.destroy();
      layer.current = null;
    };
  }, [hdr, hdrScreen]);
  useFrame(({ roll: seconds }) => {
    const el = canvas.current;
    const st = transport.state;
    if (!el || !st.piece) return;
    const f = fit(el, wide ? { colorSpace: 'display-p3' } : undefined);
    if (!f || f.w < 1 || f.h < 1) return;
    colours.current ??= readRoomColours(el, wide);
    const data = roll(st.piece.song, hands, touch, expressive);
    const key = `${f.w}x${f.h}/${data.low}-${data.high}`;
    if (geometry.current?.key !== key) {
      geometry.current = { key, g: roomGeometry(f.w, f.h, data) };
    }
    let next = null;
    let leader = null;
    if (st.status === 'between') {
      // The next piece's roll follows this one: its leader, then its first holes, arriving at
      // the tracker bar as the gap ends.
      const end = st.duration + st.gap * st.tempo;
      const upcoming = transport.upcoming;
      if (upcoming) next = { data: roll(upcoming.song, hands, touch, expressive), offset: end };
      const label = upcoming ?? nextTitle;
      if (label) {
        leader = {
          title: label.title,
          ...(label.composer ? { composer: label.composer } : {}),
          at: end - LEADER_SECONDS - 0.1,
        };
      }
    }
    const frame = { data, seconds, active, next, leader, hands: showHands, still };
    drawRoom(f.ctx, geometry.current.g, frame, colours.current);
    const light = layer.current;
    const top = hdrCanvas.current;
    if (light && top) {
      const dpr = window.devicePixelRatio || 1;
      if (top.width !== Math.round(f.w * dpr) || top.height !== Math.round(f.h * dpr)) {
        top.width = Math.round(f.w * dpr);
        top.height = Math.round(f.h * dpr);
      }
      light.draw(roomLights(geometry.current.g, frame, colours.current), f.w, f.h);
    }
  });
  return (
    <div className="room__piano">
      <canvas ref={canvas} aria-hidden="true" />
      {hdr && hdrScreen && <canvas ref={hdrCanvas} className="room__hdr" aria-hidden="true" />}
    </div>
  );
}

/**
 * Where the piece is, as a hairline with the part played in gold and the times either side: tap or
 * drag to move, and the arrow keys move 5 s (a slider to assistive technology, "1:23 of 4:56").
 */
function Progress({ onSeek }: { onSeek: (seconds: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const remaining = useRef<HTMLSpanElement>(null);
  const last = useRef({ seconds: -1, total: 0 });
  useFrame(({ fraction, seconds, total }) => {
    if (fill.current)
      fill.current.style.transform = `scaleX(${Math.min(1, Math.max(0, fraction))})`;
    const el = track.current;
    if (!el) return;
    if (Math.round(seconds) === Math.round(last.current.seconds) && total === last.current.total) {
      return;
    }
    last.current = { seconds, total };
    if (elapsed.current) elapsed.current.textContent = formatTime(seconds);
    if (remaining.current) remaining.current.textContent = `−${formatTime(total - seconds)}`;
    el.setAttribute('aria-valuemax', String(Math.round(total)));
    el.setAttribute('aria-valuenow', String(Math.round(seconds)));
    el.setAttribute(
      'aria-valuetext',
      t('{at} of {total}', { at: formatTime(seconds), total: formatTime(total) }),
    );
  });
  const seekTo = (clientX: number) => {
    const el = track.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)));
    onSeek(fraction * last.current.total);
  };
  return (
    <div className="np-seek">
      <span className="np-seek__time" ref={elapsed}>
        0:00
      </span>
      <div
        ref={track}
        className="np-seek__track"
        role="slider"
        aria-label={t('Position')}
        aria-valuemin={0}
        tabIndex={0}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) seekTo(e.clientX);
        }}
        onKeyDown={(e) => {
          const { seconds, total } = last.current;
          const to =
            e.key === 'ArrowRight' || e.key === 'ArrowUp'
              ? seconds + 5
              : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
                ? seconds - 5
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? total
                    : null;
          if (to === null) return;
          e.preventDefault();
          onSeek(to);
        }}
      >
        <div className="np-seek__fill" ref={fill} />
      </div>
      <span className="np-seek__time" ref={remaining}>
        −0:00
      </span>
    </div>
  );
}

/** On a narrow screen, the piece playing as a bar along the bottom (P6-07, ⅓ iPad and phones). */
function MiniBar({
  entry,
  playing,
  onToggle,
  onNext,
  onOpen,
}: {
  entry: CollectionEntry;
  playing: boolean;
  onToggle: () => void;
  onNext: () => void;
  onOpen: () => void;
}) {
  const progress = useRef<HTMLDivElement>(null);
  useFrame(({ fraction }) => {
    if (progress.current) progress.current.style.transform = `scaleX(${fraction})`;
  });
  return (
    <div className="minibar" role="region" aria-label={t('Now playing')}>
      <div className="minibar__progress" ref={progress} />
      <button className="minibar__open" onClick={onOpen} aria-label={t('Open the music room')}>
        <InitialsTile entry={entry} />
        <span className="collection__text">
          <span className="collection__title">{entry.title}</span>
          <span className="collection__meta">{entry.composer}</span>
        </span>
      </button>
      <button className="np-icon" aria-label={playing ? t('Pause') : t('Play')} onClick={onToggle}>
        {playing ? <Pause /> : <Play />}
      </button>
      <button className="np-icon" aria-label={t('Next piece')} onClick={onNext}>
        <SkipForward />
      </button>
    </div>
  );
}
