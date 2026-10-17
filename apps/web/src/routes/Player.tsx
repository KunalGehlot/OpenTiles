// The Player (P6-07, ADR 0019): all the learner's music in one list, the piece playing, and what
// comes next. It plays through the app's one transport (P6-05), so the music goes on while the
// learner moves to other pages; practice stops it. Two designs of "Now playing" sit behind a
// switch until the maintainer chooses one (P6-06): A, a record sleeve (a large generated cover, the
// piece's picture as the seek bar, a slim keyboard below), and B, a stage (the notes rising from a
// wide keyboard behind frosted glass).
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
import {
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
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
import { coverIndex, coverNotes, drawCover, initials } from '../player/art';
import { playerTransport } from '../player/browser';
import { searchCollection, sortCollection } from '../player/collection';
import type { CollectionEntry, CollectionSort } from '../player/collection';
import { loadCollection } from '../player/load';
import { upNext } from '../player/queue';
import type { Repeat as RepeatMode } from '../player/queue';
import { drawKeys, drawSeekPicture, drawStage, soundingAt, stageLayout } from '../player/stage';
import type { PlayerTransport, TransportState } from '../player/transport';
import { PlaysOnControl } from '../practice/PlaysOnControl';
import type { MidiPlayback } from '../settings/model';
import { updateAppSettings, useAppSettings, useEffectiveAccessibility } from '../settings/store';
import { SearchBox } from '../ui/SearchBox';
import { parseColour } from '../views/colour';
import type { Rgb } from '../views/colour';
import { readPalette } from '../views/renderer';
import type { Palette } from '../views/renderer';

type Variant = 'a' | 'b';
type Filter = 'all' | 'library' | 'catalogue';

/** What every canvas needs each frame: where the music is. */
interface Frame {
  song: Song;
  beat: number;
  /** 0..1 of the piece. */
  fraction: number;
  seconds: number;
  total: number;
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
): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const ctx = canvas.getContext('2d');
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

const formatTime = (s: number) => {
  const whole = Math.max(0, Math.round(s));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

function coverColours(el: Element, name: string): { colour: Rgb; ink: Rgb } {
  const css = getComputedStyle(el);
  const read = (token: string, fallback: Rgb) =>
    parseColour(css.getPropertyValue(token).trim())?.rgb ?? fallback;
  return {
    colour: read(`--cover-${coverIndex(name)}`, [45, 91, 138]),
    ink: read('--on-cover', [255, 255, 255]),
  };
}

const coverName = (e: Pick<CollectionEntry, 'composer' | 'title'>) => e.composer ?? e.title;

/** The prototype's design choice, kept in the address so a screenshot link opens the same one. */
function readVariant(): Variant {
  return /[?&]design=b\b/.test(window.location.hash) ? 'b' : 'a';
}

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
  const [sort, setSort] = useState<CollectionSort>('title');
  const [variant, setVariant] = useState<Variant>(readVariant);

  useEffect(() => {
    loadCollection().then(setEntries, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const byKey = useMemo(() => new Map((entries ?? []).map((e) => [e.key, e])), [entries]);
  const current = state.key ? (byKey.get(state.key) ?? null) : null;
  const song = state.piece?.song ?? null;
  const playing = state.status === 'playing' || state.status === 'between';

  // Something to show from the start, without playing: the list as first shown, at Ode to Joy
  // if it is there. A queue the Player already has (from another visit) stays.
  useEffect(() => {
    if (!entries || transport.state.key) return;
    const keys = sortCollection(entries, 'title', locale())
      .filter((e) => e.playable)
      .map((e) => e.key);
    void transport.cue(keys, Math.max(0, keys.indexOf('catalogue:ode-to-joy')));
  }, [entries, transport]);

  const shown = useMemo(() => {
    const scoped = (entries ?? []).filter((e) => filter === 'all' || e.source === filter);
    return sortCollection(searchCollection(scoped, query), sort, locale());
  }, [entries, filter, query, sort]);
  const upNextEntries = useMemo(
    () =>
      upNext(state.queue).flatMap((k) => (byKey.get(k) ? [byKey.get(k) as CollectionEntry] : [])),
    [state.queue, byKey],
  );

  /** Plays the list as shown, from `entry` on. */
  const playFrom = (entry: CollectionEntry) => {
    const keys = shown.filter((e) => e.playable).map((e) => e.key);
    void transport.playQueue(keys, Math.max(0, keys.indexOf(entry.key)));
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
      const total = Math.max(0.1, transport.state.duration);
      const s = Math.min(total, transport.positionNow());
      const frame = { song, beat: map.secondsToBeat(s), fraction: s / total, seconds: s, total };
      for (const draw of draws.current) draw(frame);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [song, transport]);

  // Space plays and pauses, ← and → move 5 s, Shift with them goes to the piece before or after.
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [transport]);

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

  const controls = (
    <div className="np-controls">
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
      {playsOnControl}
    </div>
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

  const nowPlaying = current && (
    <section
      className={`np np--${variant === 'a' ? 'sleeve' : 'stage'}`}
      aria-label={t('Now playing')}
    >
      {variant === 'a' ? (
        <>
          <Cover entry={current} song={song} pulse={playing && !reducedMotion} />
          <NowPlayingText entry={current} />
          <Seek onSeek={(s) => transport.seek(s)} />
          {transportButtons}
          {controls}
          {song && <KeyboardStrip />}
        </>
      ) : (
        <>
          <Stage entry={current} transport={transportButtons} />
          <Seek onSeek={(s) => transport.seek(s)} />
          {controls}
        </>
      )}
      {message}
    </section>
  );

  return (
    <FrameContext.Provider value={register}>
      <div className="player">
        <header className="player__head">
          <h1>{t('Player')}</h1>
          <p className="muted">
            {t(
              'Everything you can play, the catalogue and your library, played on this device or your keyboard.',
            )}
          </p>
          {/* Prototype only: the two designs to choose from (P6-06). */}
          <div className="segmented player__design" role="group" aria-label="Design">
            {(
              [
                ['a', 'A · Record sleeve'],
                ['b', 'B · Stage'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                aria-pressed={variant === v}
                onClick={() => {
                  setVariant(v);
                  window.history.replaceState(
                    null,
                    '',
                    v === 'b' ? '#/player?design=b' : '#/player',
                  );
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        {error && <p className="error">{error}</p>}
        <div className="player__body">
          <section className="collection" aria-label={t('All music')}>
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
                  <option value="title">{t('Title')}</option>
                  <option value="composer">{t('Composer')}</option>
                  <option value="added">{t('Recently added')}</option>
                  <option value="played">{t('Recently played')}</option>
                  <option value="length">{t('Length')}</option>
                </select>
              </label>
            </div>
            {entries === null ? (
              <p className="muted">{t('Loading…')}</p>
            ) : shown.length === 0 ? (
              <p className="muted">
                {t('Nothing matches.')}{' '}
                <a href={href({ name: 'library' })}>{t('Import a piece')}</a>
              </p>
            ) : (
              <ul className="collection__list">
                {shown.map((e) => (
                  <li key={e.key}>
                    <button
                      className="collection__row"
                      aria-current={e.key === current?.key ? 'true' : undefined}
                      disabled={!e.playable}
                      onClick={() => playFrom(e)}
                    >
                      <InitialsTile entry={e} />
                      <span className="collection__text">
                        <span className="collection__title">{e.title}</span>
                        <span className="collection__meta">
                          {[e.composer, e.source === 'library' ? t('My library') : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <span className="collection__length">
                        {e.seconds !== undefined ? formatTime(e.seconds) : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {nowPlaying}
          <aside className="upnext" aria-label={t('Up next')}>
            <h2>
              <ListMusic /> {t('Up next')}
            </h2>
            <ol>
              {upNextEntries.slice(0, 8).map((e) => (
                <li key={e.key}>
                  <InitialsTile entry={e} />
                  <span className="collection__text">
                    <span className="collection__title">{e.title}</span>
                    <span className="collection__meta">{e.composer}</span>
                  </span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
        {current && (
          <MiniBar
            entry={current}
            playing={playing}
            onToggle={() => void transport.toggle()}
            onNext={() => void transport.next()}
          />
        )}
      </div>
    </FrameContext.Provider>
  );
}

function InitialsTile({ entry }: { entry: CollectionEntry }) {
  return (
    <span className={`tile cover-${coverIndex(coverName(entry))}`} aria-hidden="true">
      {initials(coverName(entry))}
    </span>
  );
}

function NowPlayingText({ entry }: { entry: CollectionEntry }) {
  return (
    <div className="np-text">
      <h2 aria-live="polite">{entry.title}</h2>
      <p className="muted">
        {[entry.composer, entry.source === 'library' ? t('My library') : t('Catalogue')]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  );
}

/** The generated cover, drawn once per piece; it glows softly with each new chord while playing. */
function Cover({
  entry,
  song,
  pulse,
}: {
  entry: CollectionEntry;
  song: Song | null;
  pulse: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c || !song) return;
    const draw = () => {
      const f = fit(c);
      if (!f) return;
      const { colour, ink } = coverColours(c, coverName(entry));
      f.ctx.clearRect(0, 0, f.w, f.h);
      drawCover(f.ctx, Math.min(f.w, f.h), coverNotes(song), colour, ink);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', draw);
    return () => {
      ro.disconnect();
      scheme.removeEventListener('change', draw);
    };
  }, [entry, song]);
  const lastOnset = useRef(-1);
  useFrame(({ song: s, beat }) => {
    const el = glow.current;
    if (!el) return;
    if (!pulse) {
      el.style.opacity = '0';
      return;
    }
    // The latest onset at or before the position: a new chord brightens the glow, which fades.
    let onset = -1;
    for (const n of s.notes) {
      if (n.startBeat > beat) break;
      onset = n.startBeat;
    }
    if (onset !== lastOnset.current) {
      lastOnset.current = onset;
      el.style.transition = 'none';
      el.style.opacity = '0.75';
      void el.offsetWidth;
      el.style.transition = 'opacity 600ms ease-out';
      el.style.opacity = '0.25';
    }
  });
  return (
    <div className={`np-cover cover-${coverIndex(coverName(entry))}`}>
      <div className="np-cover__glow" ref={glow} aria-hidden="true" />
      <canvas ref={canvas} role="img" aria-label={t('Cover of {title}', { title: entry.title })} />
    </div>
  );
}

/**
 * The piece's picture as the seek bar, with the time played and the time left: tap or drag to
 * move, and the arrow keys move 5 s (a slider to assistive technology, "1:23 of 4:56").
 */
function Seek({ onSeek }: { onSeek: (seconds: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const remaining = useRef<HTMLSpanElement>(null);
  const palette = useRef<{ p: Palette; unplayed: string } | null>(null);
  const last = useRef({ seconds: 0, total: 0 });
  useFrame(({ song, fraction, seconds, total }) => {
    const c = canvas.current;
    if (!c) return;
    const f = fit(c);
    if (!f) return;
    palette.current ??= {
      p: readPalette(c),
      unplayed: getComputedStyle(c).getPropertyValue('--line-strong').trim() || '#888',
    };
    drawSeekPicture(f.ctx, song, f.w, f.h, fraction, palette.current.p, palette.current.unplayed);
    if (Math.round(seconds) === Math.round(last.current.seconds) && total === last.current.total) {
      return;
    }
    last.current = { seconds, total };
    if (elapsed.current) elapsed.current.textContent = formatTime(seconds);
    if (remaining.current) remaining.current.textContent = `−${formatTime(total - seconds)}`;
    c.setAttribute('aria-valuemax', String(Math.round(total)));
    c.setAttribute('aria-valuenow', String(Math.round(seconds)));
    c.setAttribute(
      'aria-valuetext',
      t('{at} of {total}', { at: formatTime(seconds), total: formatTime(total) }),
    );
  });
  useEffect(() => {
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const reset = () => (palette.current = null);
    scheme.addEventListener('change', reset);
    return () => scheme.removeEventListener('change', reset);
  }, []);
  const seekTo = (clientX: number) => {
    const c = canvas.current;
    if (!c) return;
    const box = c.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)));
    onSeek(fraction * last.current.total);
  };
  return (
    <div className="np-seek">
      <canvas
        ref={canvas}
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
      />
      <div className="np-seek__times">
        <span ref={elapsed}>0:00</span>
        <span ref={remaining}>−0:00</span>
      </div>
    </div>
  );
}

/** Design B: the notes rising from a wide keyboard, the title and transport on frosted glass. */
function Stage({ entry, transport }: { entry: CollectionEntry; transport: React.ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const palette = useRef<Palette | null>(null);
  useFrame(({ song, beat }) => {
    const c = canvas.current;
    if (!c) return;
    const f = fit(c);
    if (!f) return;
    palette.current ??= readPalette(c);
    const layout = stageLayout(song, f.w);
    const keysHeight = Math.min(f.h * 0.34, layout.whiteWidth * 4.6);
    drawStage(f.ctx, song, layout, f.w, f.h, keysHeight, beat, palette.current);
  });
  return (
    <div className="stage">
      <canvas ref={canvas} aria-hidden="true" />
      <div className="stage__glass">
        <div className="stage__title">
          <InitialsTile entry={entry} />
          <NowPlayingText entry={entry} />
        </div>
        {transport}
      </div>
    </div>
  );
}

/** Design A: a slim keyboard under the page with the sounding keys lit. */
function KeyboardStrip() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const palette = useRef<Palette | null>(null);
  useFrame(({ song, beat }) => {
    const c = canvas.current;
    if (!c) return;
    const f = fit(c);
    if (!f) return;
    palette.current ??= readPalette(c);
    f.ctx.clearRect(0, 0, f.w, f.h);
    drawKeys(f.ctx, stageLayout(song, f.w), 0, f.h, soundingAt(song, beat), palette.current);
  });
  return (
    <div className="keystrip">
      <canvas ref={canvas} aria-hidden="true" />
    </div>
  );
}

/** On a narrow screen, the piece playing as a bar along the bottom (P6-07, ⅓ iPad and phones). */
function MiniBar({
  entry,
  playing,
  onToggle,
  onNext,
}: {
  entry: CollectionEntry;
  playing: boolean;
  onToggle: () => void;
  onNext: () => void;
}) {
  const progress = useRef<HTMLDivElement>(null);
  useFrame(({ fraction }) => {
    if (progress.current) progress.current.style.transform = `scaleX(${fraction})`;
  });
  return (
    <div className="minibar" role="region" aria-label={t('Now playing')}>
      <div className="minibar__progress" ref={progress} />
      <InitialsTile entry={entry} />
      <span className="collection__text">
        <span className="collection__title">{entry.title}</span>
        <span className="collection__meta">{entry.composer}</span>
      </span>
      <button className="np-icon" aria-label={playing ? t('Pause') : t('Play')} onClick={onToggle}>
        {playing ? <Pause /> : <Play />}
      </button>
      <button className="np-icon" aria-label={t('Next piece')} onClick={onNext}>
        <SkipForward />
      </button>
    </div>
  );
}
