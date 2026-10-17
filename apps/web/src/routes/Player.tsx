// The Player (P6-06 design prototype for P6-07, ADR 0019): all the learner's music in one list,
// and the piece playing. Two designs of "Now playing" sit side by side behind a switch until the
// maintainer chooses: A, a record sleeve (a large generated cover, the piece's picture as the seek
// bar, a slim keyboard below), and B, a stage (the notes rising from a wide keyboard behind frosted
// glass). Until the transport exists (P6-05) the position is a stand-in clock, so the motion can be
// judged; nothing sounds yet.
//
// Everything that moves is drawn on canvases from one requestAnimationFrame loop that reads the
// position through refs (docs/architecture.md); React lays out the page and the controls only.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ListMusic, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import { TempoMap } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { HandFilter } from '@opentiles/practice';
import { playsOn, playsOnUnavailableHint } from '../audio/plays-on';
import { midiSupported, midiUnavailableReason } from '../input/midi-input';
import { locale, t } from '../i18n';
import { href } from '../lib/router';
import { coverIndex, coverNotes, drawCover, initials } from '../player/art';
import { searchCollection, sortCollection } from '../player/collection';
import type { CollectionEntry, CollectionSort } from '../player/collection';
import { loadCollection, loadPlayable } from '../player/load';
import { drawKeys, drawSeekPicture, drawStage, soundingAt, stageLayout } from '../player/stage';
import { PlaysOnControl } from '../practice/PlaysOnControl';
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

export function Player() {
  const settings = useAppSettings();
  const { reducedMotion } = useEffectiveAccessibility();
  const [entries, setEntries] = useState<CollectionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<CollectionSort>('title');
  const [current, setCurrent] = useState<CollectionEntry | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [playing, setPlaying] = useState(false);
  const [tempo, setTempo] = useState(1);
  const [hands, setHands] = useState<HandFilter>('both');
  const [variant, setVariant] = useState<Variant>(readVariant);
  const seconds = useRef(0);

  useEffect(() => {
    loadCollection().then(setEntries, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const pick = (entry: CollectionEntry) => {
    setCurrent(entry);
    setSong(null);
    seconds.current = 0;
    loadPlayable(entry.key).then(
      (p) => setSong(p.song),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };

  // Something to show from the start: Ode to Joy if it is there, else the first piece.
  useEffect(() => {
    if (current || !entries) return;
    const first =
      entries.find((e) => e.key === 'catalogue:ode-to-joy') ?? entries.find((e) => e.playable);
    if (first) pick(first);
    // Once, when the collection arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const shown = useMemo(() => {
    const scoped = (entries ?? []).filter((e) => filter === 'all' || e.source === filter);
    return sortCollection(searchCollection(scoped, query), sort, locale());
  }, [entries, filter, query, sort]);
  const upNext = useMemo(() => {
    const at = shown.findIndex((e) => e.key === current?.key);
    return shown
      .slice(at + 1)
      .filter((e) => e.playable)
      .slice(0, 6);
  }, [shown, current]);

  // One loop for every canvas on the page.
  const draws = useRef(new Set<Draw>());
  const register = useMemo(
    () => (draw: Draw) => {
      draws.current.add(draw);
      return () => void draws.current.delete(draw);
    },
    [],
  );
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  useEffect(() => {
    if (!song) return;
    const map = new TempoMap(song.tempos);
    const total = Math.max(0.1, map.beatToSeconds(song.lengthBeats));
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        seconds.current += dt * tempoRef.current;
        // The stand-in clock goes round; the transport will move on to the next piece.
        if (seconds.current > total + 1.5) seconds.current = 0;
      }
      const s = Math.min(total, seconds.current);
      const frame = { song, beat: map.secondsToBeat(s), fraction: s / total, seconds: s, total };
      for (const draw of draws.current) draw(frame);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [song]);

  const supported = midiSupported();
  const choice = settings.midi.playback;
  const route = playsOn(choice, {
    supported,
    connected: false,
    inputs: [],
    outputs: [],
    name: settings.midi.output,
  });
  const playsOnControl = (
    <PlaysOnControl
      choice={choice}
      route={route}
      supported={supported}
      keyboardName={null}
      outputs={[]}
      outputName={settings.midi.output}
      unavailableHint={playsOnUnavailableHint(
        midiUnavailableReason({
          userAgent: navigator.userAgent,
          maxTouchPoints: navigator.maxTouchPoints,
          secure: window.isSecureContext,
        }),
      )}
      onChoose={(playback) => void updateAppSettings({ midi: { ...settings.midi, playback } })}
      onOutput={(output) => void updateAppSettings({ midi: { ...settings.midi, output } })}
    />
  );

  const step = (by: number) => {
    const at = shown.findIndex((e) => e.key === current?.key);
    const next = shown.slice(Math.max(0, at + by)).find((e) => e.playable);
    const prev = shown
      .slice(0, Math.max(0, at))
      .reverse()
      .find((e) => e.playable);
    const target = by > 0 ? next : prev;
    if (target) pick(target);
  };

  const transport = (
    <div className="np-transport" role="group" aria-label={t('Playback')}>
      <button className="np-icon" aria-label={t('Shuffle')} aria-pressed={false}>
        <Shuffle />
      </button>
      <button className="np-icon" aria-label={t('Previous piece')} onClick={() => step(-1)}>
        <SkipBack />
      </button>
      <button
        className="np-play primary"
        aria-label={playing ? t('Pause') : t('Play')}
        onClick={() => setPlaying((p) => !p)}
        disabled={!song}
      >
        {playing ? <Pause /> : <Play />}
      </button>
      <button className="np-icon" aria-label={t('Next piece')} onClick={() => step(1)}>
        <SkipForward />
      </button>
      <button className="np-icon" aria-label={t('Repeat')} aria-pressed={false}>
        <Repeat />
      </button>
    </div>
  );

  const controls = (
    <div className="np-controls">
      <label className="tempo" title={t('Practice tempo')}>
        <span className="tempo__label">{t('Tempo')}</span>
        <input
          type="range"
          min={50}
          max={150}
          step={5}
          value={Math.round(tempo * 100)}
          onChange={(e) => setTempo(Number(e.target.value) / 100)}
        />
        <span className="tempo__value">{Math.round(tempo * 100)} %</span>
      </label>
      <div className="segmented" role="group" aria-label={t('Hands')}>
        {(
          [
            ['left', t('Left')],
            ['both', t('Both')],
            ['right', t('Right')],
          ] as const
        ).map(([h, label]) => (
          <button key={h} aria-pressed={hands === h} onClick={() => setHands(h)}>
            {label}
          </button>
        ))}
      </div>
      {playsOnControl}
    </div>
  );

  const nowPlaying = current && (
    <section
      className={`np np--${variant === 'a' ? 'sleeve' : 'stage'}`}
      aria-label={t('Now playing')}
    >
      {variant === 'a' ? (
        <>
          <Cover entry={current} song={song} pulse={playing && !reducedMotion} />
          <NowPlayingText entry={current} />
          <Seek />
          {transport}
          {controls}
          {song && <KeyboardStrip />}
        </>
      ) : (
        <>
          <Stage entry={current} transport={transport} />
          <Seek />
          {controls}
        </>
      )}
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
                      onClick={() => pick(e)}
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
              {upNext.map((e) => (
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
            onToggle={() => setPlaying((p) => !p)}
            onNext={() => step(1)}
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

/** The piece's picture as the seek bar, with the time played and the time left. */
function Seek() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef<HTMLSpanElement>(null);
  const remaining = useRef<HTMLSpanElement>(null);
  const palette = useRef<{ p: Palette; unplayed: string } | null>(null);
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
    if (elapsed.current) elapsed.current.textContent = formatTime(seconds);
    if (remaining.current) remaining.current.textContent = `−${formatTime(total - seconds)}`;
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
  return (
    <div className="np-seek">
      <canvas ref={canvas} role="slider" aria-label={t('Position')} tabIndex={0} />
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
