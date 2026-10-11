import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Gauge,
  Mic,
  Minus,
  Piano,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { customKeyboard, KEYBOARD_PRESETS, keyCount } from '@opentiles/practice';
import type { HandFilter } from '@opentiles/practice';
import type { Song } from '@opentiles/song-model';
import { audioContext, now, unlockAudio } from '../audio/context';
import { MidiOutInstrument, playbackInstrument } from '../audio/midi-out';
import { synthFor } from '../audio/synth';
import { loadCatalogueSong } from '../catalogue/catalogue';
import {
  createMidiInput,
  describeMidiError,
  midiSupported,
  noKeyboardMessage,
  midiUnavailableMessage,
  midiUnavailableReason,
} from '../input/midi-input';
import type { MidiKeyboardInput } from '../input/midi-input';
import type { MicInput } from '../input/mic-input';
import { TouchInput } from '../input/touch-input';
import { href, navigate } from '../lib/router';
import { ListenBack } from '../practice/ListenBack';
import { connectClickTrack, MetronomeControl } from '../practice/MetronomeControl';
import { MicCalibration } from '../practice/MicCalibration';
import { MidiLatencyCalibration } from '../practice/MidiLatencyCalibration';
import { prepareSong } from '../practice/prepare';
import { drillRoute, loadDrill, loadDrillPrefs, notesPerMinute } from '../practice/drill';
import type { DrillPrefs } from '../practice/drill';
import { LiveStatsStrip } from '../practice/LiveStatsStrip';
import { OverviewStrip } from '../practice/OverviewStrip';
import { SectionBar } from '../practice/SectionBar';
import {
  shiftLabel,
  shiftLimits,
  shiftMessage,
  shiftNotation,
  shiftSong,
} from '../practice/transpose';
import { useScreenWakeLock } from '../practice/wake-lock';
import { fitMessage, keyboardRange } from '../settings/model';
import type { FingeringDisplay, MidiPlayback } from '../settings/model';
import type { SpellingSetting } from '../lib/notes';
import { loadPracticePrefs, savePracticePrefs } from '../practice/prefs';
import type { PracticePrefs } from '../practice/prefs';
import { updateAppSettings, useAppSettings, useEffectiveAccessibility } from '../settings/store';
import {
  getMicCalibration,
  getMidiCalibration,
  micCalibrationSkipped,
} from '../storage/calibration';
import { db, recordPracticeTime, recordRun } from '../storage/db';
import { hitTest, rangeFor } from '../views/keyboard';
import { LoopDrag } from '../views/loop-drag';
import { PracticeRenderer } from '../views/renderer';
import { PracticeSession } from '../views/session';
import type { PracticeMode, SessionStatus } from '../views/session';
import { formatOfPath, scoreFor } from '../views/score/notation';
import type { NotationSource } from '../views/score/notation';
import { ScoreView } from '../views/score/ScoreView';
import { usePracticeView, ViewToggle } from '../views/score/ViewToggle';
import { Popover } from '../ui/Popover';
import { t } from '../i18n';

interface Loaded {
  source: 'catalogue' | 'library' | 'drill';
  song: Song;
  title: string;
  subtitle?: string;
  progressKey: string;
  notation: NotationSource;
  /** A sight-reading drill (P5-05): what it hides, and the choices for the next one. */
  drill?: { guide: 'keys' | 'none'; prefs: DrillPrefs };
}

const NO_BARS: readonly number[] = [];
/** How long an endless drill's result stays before the next drill starts. */
const ENDLESS_PAUSE_MS = 2500;

export function Practice({
  source,
  id,
}: {
  source: 'catalogue' | 'library' | 'drill';
  id: string;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<PracticePrefs | null>(null);

  // What the learner chose last time (mode, hands, tempo, metronome); read once per visit.
  useEffect(() => {
    let cancelled = false;
    void loadPracticePrefs().then((p) => !cancelled && setPrefs(p));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    const load = async (): Promise<Loaded> => {
      if (source === 'drill') {
        const drillPrefs = await loadDrillPrefs();
        const d = loadDrill(id, drillPrefs.letters);
        return {
          source,
          song: d.song,
          title: d.title,
          subtitle: t('Sight-reading'),
          progressKey: `drill:${id}`,
          notation: { kind: 'musicxml', text: d.musicxml, transpose: 0 },
          drill: { guide: drillPrefs.showKeys ? 'keys' : 'none', prefs: drillPrefs },
        };
      }
      if (source === 'catalogue') {
        const { piece, song, bytes } = await loadCatalogueSong(id);
        return {
          source,
          ...scoreFor(formatOfPath(piece.score), bytes, song),
          title: piece.title,
          subtitle: piece.composer,
          progressKey: `catalogue:${id}`,
        };
      }
      const item = await db.library.get(Number(id));
      if (!item) throw new Error(t('This piece is not in your library on this device.'));
      return {
        source,
        // A MIDI file's score is written from the song (P5-13), which comes back with the refs of
        // its glyphs.
        ...scoreFor(item.format, item.bytes, item.song, item.settings.transpose),
        title: item.title,
        progressKey: `library:${id}`,
      };
    };
    load()
      .then((l) => !cancelled && setLoaded(l))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [source, id]);

  if (error) {
    return (
      <div className="session-message">
        <p className="error">{error}</p>
        <a className="button" href={href({ name: 'home' })}>
          <ChevronLeft /> {t('Back to pieces')}
        </a>
      </div>
    );
  }
  if (!loaded || !prefs) return <p className="session-message muted">{t('Loading…')}</p>;
  return <PracticeView key={loaded.progressKey} {...loaded} prefs={prefs} />;
}

function PracticeView({
  source,
  song,
  title,
  subtitle,
  progressKey,
  notation,
  drill,
  prefs: savedPrefs,
}: Loaded & { prefs: PracticePrefs }) {
  const settings = useAppSettings();
  // A drill starts in wait mode with both hands, shows the score and nothing that gives the notes
  // away (no falling notes, no overview), and keeps the learner's choices for pieces as they are.
  const prefs = useMemo<PracticePrefs>(
    () => (drill ? { ...savedPrefs, mode: 'wait', hands: 'both', overview: false } : savedPrefs),
    [drill, savedPrefs],
  );
  const remember = useCallback(
    (patch: Partial<PracticePrefs>) => {
      if (!drill) savePracticePrefs(patch);
      else if (patch.liveStats !== undefined) savePracticePrefs({ liveStats: patch.liveStats });
    },
    [drill],
  );
  // The piece fitted to the learner's keyboard (P4-07), with the fingers they chose (P4-08).
  // Keyed on plain values: other settings changing must not restart the run.
  const { size, low, keys } = settings.keyboard;
  const fingering = drill ? 'off' : settings.fingering;
  const range = useMemo(() => keyboardRange({ size, low, keys }), [size, low, keys]);
  // Semitones the learner moved the piece by on this visit (P5-04). The score is drawn moved too,
  // and suggested fingers are worked out again for the new key.
  const [shift, setShift] = useState(0);
  const limits = useMemo(() => shiftLimits(song), [song]);
  const moved = Math.min(limits.up, Math.max(limits.down, shift));
  const shifted = useMemo(() => shiftSong(song, moved), [song, moved]);
  const shownNotation = useMemo(() => shiftNotation(notation, moved), [notation, moved]);
  const prepared = useMemo(
    () => prepareSong(shifted, range, fingering),
    [shifted, range, fingering],
  );
  const keysRange = useMemo(
    () => range ?? rangeFor(prepared.played.notes.map((n) => n.pitch)),
    [range, prepared],
  );
  const [session] = useState(() => new PracticeSession(prepared.played, now));
  const [status, setStatus] = useState<SessionStatus>(() => session.status());
  const [mode, setMode] = useState<PracticeMode>(prefs.mode);
  // A remembered hand the piece has no notes for (the left hand of a melody level) is not used here
  // and not forgotten either.
  const startHands: HandFilter =
    prefs.hands === 'both' || song.notes.some((n) => n.hand === prefs.hands) ? prefs.hands : 'both';
  const [hands, setHands] = useState<HandFilter>(startHands);
  const [tempo, setTempo] = useState(prefs.tempo);
  const [accompany, setAccompany] = useState(prefs.accompany);
  const [liveStats, setLiveStats] = useState(prefs.liveStats);
  const [overview, setOverview] = useState(prefs.overview);
  const [midi, setMidi] = useState<{ input: MidiKeyboardInput; devices: string[] } | null>(null);
  const [mic, setMic] = useState<MicInput | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showLoop, setShowLoop] = useState(false);
  const [midiCalibrating, setMidiCalibrating] = useState(false);
  const [micCalibrating, setMicCalibrating] = useState<MicInput | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PracticeRenderer | null>(null);
  const touch = useRef(new TouchInput());
  const pointers = useRef(new Map<number, number>());
  const [loopDrag] = useState(() => new LoopDrag(session, () => rendererRef.current));
  const [chosenView, setView] = usePracticeView(notation);
  // The page view shows the whole drill at once, so the learner can read ahead.
  const view = drill ? 'page' : chosenView;
  useScreenWakeLock(session, status.playing);
  // After a run the position glides back to the start; under Reduce motion it jumps there.
  const { reducedMotion } = useEffectiveAccessibility();
  useEffect(() => {
    session.glideHome = !reducedMotion;
  }, [session, reducedMotion]);

  // Wire the session to React and inputs.
  useEffect(() => {
    session.onStatus = setStatus;
    session.guide = drill?.guide ?? 'full';
    session.onFinish = (summary, seconds) =>
      void (drill
        ? recordPracticeTime(seconds)
        : recordRun(progressKey, summary.accuracy, seconds));
    session.onTempo = (factor) => {
      setTempo(factor);
      remember({ tempo: factor });
    };
    // Loop runs count as practice time but not as a best score for the whole piece.
    const unsubscribe = session.addLoopListener(
      (run) =>
        void (drill ? recordPracticeTime(run.seconds) : recordRun(progressKey, 0, run.seconds)),
    );
    // Start from the learner's last choices.
    session.setMode(prefs.mode);
    session.setHands(startHands);
    session.setTempo(prefs.tempo);
    session.accompany = prefs.accompany;
    session.setMetronome(prefs.metronome);
    const keys = touch.current;
    keys.onNote = (e) => session.input(e);
    keys.onRelease = (p, time) => session.release(p, time);
    void keys.start();
    return () => {
      unsubscribe();
      keys.stop();
      session.stop();
    };
  }, [session, progressKey, prefs, startHands, drill, remember]);

  // Endless drills (P5-05): a new one follows a finished one after a moment to see the result.
  const finished = status.finished;
  useEffect(() => {
    if (!finished || !drill?.prefs.endless) return;
    const timer = window.setTimeout(() => navigate(drillRoute(drill.prefs)), ENDLESS_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [finished, drill]);

  useEffect(() => {
    // While the microphone is being set up, the set-up decides what it listens for.
    if (micCalibrating) {
      session.onExpected = () => {};
      return;
    }
    session.onExpected = (pitches) => mic?.setExpected(pitches);
    mic?.setExpected(session.mode === 'wait' ? (session.wait.current?.pitches ?? []) : []);
  }, [session, mic, micCalibrating]);

  // A microphone being set up for the first time is not the session's yet; stop it on leaving.
  const pendingMic = useRef<MicInput | null>(null);
  useEffect(() => () => pendingMic.current?.stop(), []);

  useEffect(
    () => () => {
      midi?.input.stop();
    },
    [midi],
  );
  useEffect(
    () => () => {
      mic?.stop();
    },
    [mic],
  );

  // A new keyboard size or fingering: the same piece with other pitches or fingers.
  useEffect(() => {
    session.setSong(prepared.played);
    rendererRef.current?.setRange(keysRange);
  }, [session, prepared, keysRange]);

  // Canvas: resize and draw every frame.
  const initialRange = useRef(keysRange);
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const renderer = new PracticeRenderer(canvas, initialRange.current);
    rendererRef.current = renderer;
    const ro = new ResizeObserver(() => renderer.resize(wrap.clientWidth, wrap.clientHeight));
    ro.observe(wrap);
    renderer.resize(wrap.clientWidth, wrap.clientHeight);
    let raf = 0;
    const loop = () => {
      session.frame();
      renderer.draw(session, now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => renderer.resize(wrap.clientWidth, wrap.clientHeight);
    scheme.addEventListener('change', onScheme);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      scheme.removeEventListener('change', onScheme);
    };
  }, [session]);

  // Space starts/stops playback, R restarts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
      if (e.code === 'Space' && session.mode !== 'wait') {
        e.preventDefault();
        void toggle();
      } else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) {
        session.rebuild();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /**
   * Where notes sound (Settings → MIDI keyboard): the app's own notes on this device, the MIDI
   * keyboard or both, and the keys played on the MIDI keyboard echoed on this device or not.
   */
  const { echo: midiEcho, playback: midiPlayback, output: midiOutput } = settings.midi;
  const applySound = (ctx: AudioContext) => {
    const device = synthFor(ctx);
    const sink = midi?.input.output(midiOutput) ?? null;
    const keyboard = sink ? new MidiOutInstrument(sink, now) : null;
    session.setSynth(playbackInstrument(device, keyboard, midiPlayback));
    session.midiEcho = midiEcho ? device : null;
  };

  const ensureAudio = async () => {
    const ctx = await unlockAudio();
    applySound(ctx);
    await connectClickTrack(session);
  };

  // A changed setting, or a keyboard connected later, applies at once once audio is running.
  useEffect(() => {
    const ctx = audioContext();
    if (ctx) applySound(ctx);
    // applySound reads exactly these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midi, midiEcho, midiPlayback, midiOutput]);

  const toggle = async () => {
    await ensureAudio();
    if (session.playing) session.stop();
    else session.start();
  };

  const pitchAt = (e: React.PointerEvent) => {
    const r = rendererRef.current;
    const canvas = canvasRef.current;
    if (!r || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top - r.keyboardTop;
    if (y < 0) return null;
    return hitTest(r.layout, e.clientX - rect.left, y, r.keyboardHeight);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    void ensureAudio();
    const pitch = pitchAt(e);
    if (pitch === null) {
      // Above the keyboard: a drag selects bars to loop (P2-08).
      const canvas = canvasRef.current;
      if (canvas && e.target === canvas) {
        const y = e.clientY - canvas.getBoundingClientRect().top;
        if (loopDrag.down(e.pointerId, y)) canvas.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, pitch);
    touch.current.press(pitch);
  };
  const canvasY = (e: React.PointerEvent) =>
    e.clientY - (canvasRef.current?.getBoundingClientRect().top ?? 0);
  const onPointerMove = (e: React.PointerEvent) => {
    if (loopDrag.dragging) loopDrag.move(e.pointerId, canvasY(e));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (loopDrag.dragging) {
      const range = e.type === 'pointercancel' ? null : loopDrag.up(e.pointerId, canvasY(e));
      loopDrag.cancel();
      if (range) {
        session.setLoop(range);
        setShowLoop(true);
      }
      return;
    }
    const pitch = pointers.current.get(e.pointerId);
    if (pitch === undefined) return;
    pointers.current.delete(e.pointerId);
    touch.current.release(pitch);
  };

  const connectMidi = async () => {
    setInputError(null);
    try {
      const input = createMidiInput();
      input.onNote = (e) => session.input(e);
      input.onRelease = (p, time) => session.release(p, time);
      input.onDevicesChanged = (devices) => setMidi((m) => (m ? { ...m, devices } : m));
      await input.start();
      setMidi({ input, devices: input.deviceNames });
      if (input.deviceNames.length === 0) setInputError(noKeyboardMessage(navigator.userAgent));
      await applyMidiCalibration(input.deviceNames);
    } catch (e) {
      setInputError(describeMidiError(e, navigator.userAgent));
    }
  };

  const midiDevice = (names: string[]) => names.join(', ') || 'default';
  const applyMidiCalibration = async (names: string[]) => {
    const c = await getMidiCalibration(midiDevice(names));
    session.latency = { ...session.latency, midi: c?.latency, 'native-midi': c?.latency };
  };

  /** Hands a started microphone to the session, with its stored calibration applied (P1-20). */
  const attachMic = async (input: MicInput) => {
    const c = await getMicCalibration(input.deviceKey);
    if (c?.tuningCents != null) input.setTuning(c.tuningCents);
    session.latency = { ...session.latency, microphone: c?.latency ?? undefined };
    if (pendingMic.current === input) pendingMic.current = null;
    input.onNote = (e) => session.input(e);
    input.setExpected(session.mode === 'wait' ? (session.wait.current?.pitches ?? []) : []);
    setMic(input);
  };

  const connectMic = async () => {
    setInputError(null);
    setBusy(true);
    try {
      await ensureAudio();
      const { MicInput } = await import('../input/mic-input');
      const input = new MicInput(session.mode === 'play-along' ? 'play-along' : 'wait');
      await input.start();
      const device = input.deviceKey;
      const [stored, skipped] = await Promise.all([
        getMicCalibration(device),
        micCalibrationSkipped(device),
      ]);
      if (!stored && !skipped) {
        // First use of this microphone: the guided 10-second set-up, which can be skipped.
        pendingMic.current = input;
        setMicCalibrating(input);
      } else {
        // The room may have changed since: re-measure its noise floor for a second.
        void input.calibrateNoise(1000);
        await attachMic(input);
      }
    } catch (e) {
      setInputError(
        e instanceof Error
          ? t('Microphone: {message}', { message: t(e.message) })
          : t('The microphone could not be started.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (m: PracticeMode) => {
    setMode(m);
    remember({ mode: m });
    session.setMode(m);
    mic?.setMode(m === 'play-along' ? 'play-along' : 'wait');
  };

  const summary = status.summary;
  const fit = range && prepared.fit ? fitMessage(prepared.fit, range) : null;
  const holds = status.holds;
  const holdCount = holds.good + holds.short + holds.long;
  const measureLabel = (index: number) => song.measures[index]?.number ?? String(index + 1);

  const backRoute =
    source === 'library' ? ({ name: 'library' } as const) : ({ name: 'home' } as const);

  return (
    <>
      <header className="bar session-bar">
        <a className="back" href={href(backRoute)}>
          <ChevronLeft />
          <span className="back__label">
            {source === 'library' ? t('My library') : t('Pieces')}
          </span>
        </a>
        <h1 className="session-title">
          <span className="session-title__name">{title}</span>
          {subtitle && <span className="session-title__sub">{subtitle}</span>}
        </h1>
        <div className="session-bar__end">
          {midiSupported() ? (
            midi ? (
              <>
                <span
                  className="chip chip--live"
                  title={
                    midi.devices.length > 0
                      ? t('A MIDI keyboard is connected')
                      : t('Plug in your keyboard and switch it on; it appears here by itself.')
                  }
                >
                  <Piano />
                  <span className="chip__text">
                    MIDI: {midi.devices.join(', ') || t('no device connected')}
                  </span>
                </span>
                <button
                  onClick={() => setMidiCalibrating(true)}
                  title={t('Measure keyboard delay')}
                >
                  <Gauge />
                  <span className="btn-label">{t('Calibrate timing')}</span>
                </button>
              </>
            ) : (
              <button onClick={() => void connectMidi()}>
                <Piano />
                <span className="btn-label">{t('Connect MIDI keyboard')}</span>
              </button>
            )
          ) : (
            <Popover label={t('MIDI keyboard')} icon={<Piano />}>
              <p className="popover__hint" data-testid="midi-unavailable">
                {midiUnavailableMessage(
                  midiUnavailableReason({
                    userAgent: navigator.userAgent,
                    maxTouchPoints: navigator.maxTouchPoints,
                    secure: window.isSecureContext,
                  }),
                )}
              </p>
            </Popover>
          )}
          {mic ? (
            <>
              <span className="chip chip--live chip--pulse">
                <Mic />
                <span className="chip__text">{t('Microphone listening')}</span>
              </span>
              <button
                onClick={() => {
                  session.stop();
                  mic.onNote = () => {};
                  setMicCalibrating(mic);
                }}
              >
                <SlidersHorizontal />
                <span className="btn-label">{t('Set up microphone')}</span>
              </button>
            </>
          ) : (
            <button disabled={busy} aria-busy={busy} onClick={() => void connectMic()}>
              <Mic />
              <span className="btn-label">{busy ? t('Starting…') : t('Use microphone')}</span>
            </button>
          )}
          <Popover label={t('Options')} icon={<SettingsIcon />}>
            <label className="field">
              <span className="field__label">{t('Keyboard size')}</span>
              <select
                aria-label={t('Keyboard size')}
                value={settings.keyboard.size}
                onChange={(e) =>
                  void updateAppSettings({
                    keyboard: { ...settings.keyboard, size: e.target.value },
                  })
                }
              >
                <option value="auto">{t('Fit piece')}</option>
                {KEYBOARD_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.keys}
                  </option>
                ))}
                <option value="custom">
                  {t('Custom ({n})', { n: keyCount(customKeyboard(low, keys)) })}
                </option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">{t('Fingers')}</span>
              <select
                aria-label={t('Fingering')}
                value={settings.fingering}
                onChange={(e) =>
                  void updateAppSettings({ fingering: e.target.value as FingeringDisplay })
                }
              >
                <option value="suggested">{t('Suggested')}</option>
                <option value="written">{t('As written')}</option>
                <option value="off">{t('Off')}</option>
              </select>
            </label>
            {!drill && (
              <div className="field">
                <span className="field__label" id="transpose-label">
                  {t('Transpose')}
                </span>
                <div className="stepper" role="group" aria-labelledby="transpose-label">
                  <button
                    type="button"
                    aria-label={t('Down a semitone')}
                    disabled={moved <= limits.down}
                    onClick={() => setShift(Math.max(limits.down, moved - 1))}
                  >
                    <Minus />
                  </button>
                  <output aria-live="polite" data-testid="transpose">
                    {shiftLabel(moved)}
                  </output>
                  <button
                    type="button"
                    aria-label={t('Up a semitone')}
                    disabled={moved >= limits.up}
                    onClick={() => setShift(Math.min(limits.up, moved + 1))}
                  >
                    <Plus />
                  </button>
                </div>
              </div>
            )}
            <label className="field">
              <span className="field__label">{t('Black keys')}</span>
              <select
                aria-label={t('Black keys')}
                value={settings.noteSpelling}
                onChange={(e) =>
                  void updateAppSettings({ noteSpelling: e.target.value as SpellingSetting })
                }
              >
                <option value="key">{t('As the key')}</option>
                <option value="sharps">{t('Sharps (♯)')}</option>
                <option value="flats">{t('Flats (♭)')}</option>
              </select>
            </label>
            {!drill && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={overview}
                  onChange={(e) => {
                    setOverview(e.target.checked);
                    remember({ overview: e.target.checked });
                  }}
                />
                {t('Overview of the piece')}
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={liveStats}
                onChange={(e) => {
                  setLiveStats(e.target.checked);
                  remember({ liveStats: e.target.checked });
                }}
              />
              {t('Live stats')}
            </label>
            {midiSupported() && (
              <>
                <label className="field">
                  <span className="field__label">{t('App’s notes play on')}</span>
                  <select
                    aria-label={t('App’s notes play on')}
                    value={midiPlayback}
                    onChange={(e) =>
                      void updateAppSettings({
                        midi: { ...settings.midi, playback: e.target.value as MidiPlayback },
                      })
                    }
                  >
                    <option value="device">{t('This device')}</option>
                    <option value="keyboard">{t('My MIDI keyboard')}</option>
                    <option value="both">{t('Both')}</option>
                  </select>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={midiEcho}
                    onChange={(e) =>
                      void updateAppSettings({ midi: { ...settings.midi, echo: e.target.checked } })
                    }
                  />
                  {t('Play my MIDI keys on this device')}
                </label>
              </>
            )}
            <p className="muted popover__hint">
              {t(
                'The on-screen keys and the computer keys A–; always play. Pieces are moved by octaves to fit the keyboard you choose.',
              )}
            </p>
            <a href={href({ name: 'settings' })}>{t('All settings')}</a>
          </Popover>
        </div>
      </header>
      <div className="bar session-controls">
        <div className="group">
          <div className="segmented" role="group" aria-label={t('Mode')}>
            {(
              [
                ['wait', t('Wait')],
                ['listen', t('Listen')],
                ['play-along', t('Play along')],
              ] as const
            ).map(([m, label]) => (
              <button key={m} aria-pressed={mode === m} onClick={() => changeMode(m)}>
                {label}
              </button>
            ))}
          </div>
          {mode !== 'wait' && (
            <button className="primary" onClick={() => void toggle()}>
              {status.playing ? <Square /> : <Play />}
              {status.playing ? t('Stop') : mode === 'listen' ? t('Play') : t('Start')}
            </button>
          )}
          <button onClick={() => session.rebuild()}>
            <RotateCcw />
            <span className="btn-label">{t('Restart')}</span>
          </button>
        </div>
        <div className="group">
          <div className="segmented" role="group" aria-label={t('Hands')}>
            {(
              [
                ['left', t('Left')],
                ['both', t('Both')],
                ['right', t('Right')],
              ] as const
            ).map(([h, label]) => (
              <button
                key={h}
                aria-pressed={hands === h}
                onClick={() => {
                  setHands(h);
                  remember({ hands: h });
                  session.setHands(h);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {hands !== 'both' && (
            <label className="check">
              <input
                type="checkbox"
                checked={accompany}
                onChange={(e) => {
                  setAccompany(e.target.checked);
                  remember({ accompany: e.target.checked });
                  session.accompany = e.target.checked;
                }}
              />
              {t('Play other hand')}
            </label>
          )}
        </div>
        <div className="group">
          <MetronomeControl session={session} on={status.metronome} volume={prefs.clickVolume} />
          <button
            aria-expanded={showLoop || status.loop !== null}
            aria-pressed={status.loop !== null}
            onClick={() => {
              if (status.loop) session.setLoop(null);
              setShowLoop(!(showLoop || status.loop !== null));
            }}
            title={t('Loop a range of bars (or drag across the falling notes)')}
          >
            <Repeat />
            <span className="btn-label">{t('Loop')}</span>
          </button>
        </div>
        <label className="tempo" title={t('Practice tempo')}>
          <span className="tempo__label">{t('Tempo')}</span>
          <input
            type="range"
            min={25}
            max={150}
            step={5}
            value={Math.round(tempo * 100)}
            onChange={(e) => {
              const factor = Number(e.target.value) / 100;
              setTempo(factor);
              remember({ tempo: factor });
              session.setTempo(factor);
            }}
          />
          <span className="tempo__value">{Math.round(tempo * 100)} %</span>
        </label>
      </div>
      <div className="bar session-status">
        <span className="stats" aria-live="polite">
          {mode === 'wait' ? (
            <span className="stat">
              {t('Step {step}/{count}', {
                step: Math.min(status.stepIndex + 1, status.stepCount),
                count: status.stepCount,
              })}
            </span>
          ) : null}
          <span className="stat stat--ok">✓ {status.correct}</span>
          <span className="stat stat--bad">✗ {status.wrong}</span>
        </span>
        {liveStats && <LiveStatsStrip stats={status.live} mode={mode} />}
        {inputError && <span className="error">{inputError}</span>}
        <div className="session-status__view">
          {!drill && <ViewToggle view={view} onChange={setView} notation={shownNotation} />}
        </div>
      </div>
      {/* Above the loop controls, so it stays put under the pointer when they appear. */}
      {overview && !drill && (
        <OverviewStrip
          session={session}
          song={prepared.played}
          status={status}
          onLoop={() => setShowLoop(true)}
        />
      )}
      {(fit || moved !== 0) && (
        <p className="practice-note muted" role="status">
          {[shiftMessage(moved), fit].filter(Boolean).join(' ')}
        </p>
      )}
      {(showLoop || status.loop !== null) && (
        <SectionBar session={session} song={song} status={status} />
      )}
      {view !== 'falling' && shownNotation.kind !== 'none' && (
        <ScoreView
          session={session}
          song={prepared.score}
          suggested={prepared.suggested}
          notation={shownNotation}
          layout={view}
          main={drill !== undefined}
          hardest={
            status.finished && summary
              ? summary.hardestMeasures.map((m) => m.measureIndex)
              : NO_BARS
          }
        />
      )}
      <div
        ref={wrapRef}
        className="practice-canvas-wrap"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas
          ref={canvasRef}
          aria-label={t('Falling notes and piano keyboard')}
          role="img"
          data-keys={`${keysRange.low}-${keysRange.high}`}
        />
        {status.finished && summary && (
          <div className="overlay">
            <div className="panel stack summary">
              <h2>{t('Well played!')}</h2>
              <div
                className="ring"
                role="img"
                aria-label={t('Accuracy {percent} %', {
                  percent: Math.round(summary.accuracy * 100),
                })}
                style={{ '--pct': Math.round(summary.accuracy * 100) } as React.CSSProperties}
              >
                <span className="ring__value">
                  {Math.round(summary.accuracy * 100)}
                  <small> %</small>
                </span>
                <span className="ring__label">{t('accuracy')}</span>
              </div>
              {drill && mode === 'wait' && status.elapsed > 0 && (
                <p className="drill-speed" data-testid="drill-speed">
                  <strong>
                    {t('{n} notes a minute', {
                      n: notesPerMinute(status.live.perfect + status.live.good, status.elapsed),
                    })}
                  </strong>
                  {status.live.perfect + status.live.good > 0 && (
                    <>
                      {' · '}
                      {t('{percent} % at the first try', {
                        percent: Math.round(
                          (status.live.perfect / (status.live.perfect + status.live.good)) * 100,
                        ),
                      })}
                    </>
                  )}
                </p>
              )}
              {(status.elapsed > 0 || (mode === 'play-along' && summary.meanOffsetMs > 0)) && (
                <p className="muted">
                  {status.elapsed > 0 && <>{Math.round(status.elapsed)} s</>}
                  {mode === 'play-along' && summary.meanOffsetMs > 0 && (
                    <>
                      {status.elapsed > 0 && ' · '}
                      {t('timing ±{ms} ms', { ms: Math.round(summary.meanOffsetMs) })}
                    </>
                  )}
                </p>
              )}
              {mode === 'play-along' && (
                <p className="muted">
                  {t('{hit} on time, {early} early, {late} late, {missed} missed', {
                    hit: summary.hit,
                    early: summary.early,
                    late: summary.late,
                    missed: summary.missed,
                  })}
                  {summary.extra > 0 && <>, {t('{n} extra', { n: summary.extra })}</>}
                </p>
              )}
              {summary.hardestMeasures.length > 0 && (
                <p className="muted">
                  {t('Hardest bars: {bars}', {
                    bars: summary.hardestMeasures
                      .map((m) => measureLabel(m.measureIndex))
                      .join(', '),
                  })}
                </p>
              )}
              {holdCount > 0 && (
                <p className="muted" data-testid="hold-summary">
                  {t('Held well: {good} of {count}', { good: holds.good, count: holdCount })}
                  {holds.short > 0 && <> · {t('{n} too short', { n: holds.short })}</>}
                  {holds.long > 0 && <> · {t('{n} too long', { n: holds.long })}</>}
                </p>
              )}
              {status.recorded && (
                <ListenBack session={session} title={title} allowSave={source === 'catalogue'} />
              )}
              <div className="row summary__actions">
                {drill ? (
                  <>
                    <a className="button primary" href={href(drillRoute(drill.prefs))}>
                      <Play /> {t('Next drill')}
                    </a>
                    <button onClick={() => session.rebuild()}>
                      <RotateCcw /> {t('Play again')}
                    </button>
                    <a className="button" href={href({ name: 'drills' })}>
                      {t('Change the drill')}
                    </a>
                  </>
                ) : (
                  <>
                    <button className="primary" onClick={() => session.rebuild()}>
                      <RotateCcw /> {t('Play again')}
                    </button>
                    <a className="button" href={href({ name: 'home' })}>
                      {t('Choose another piece')}
                    </a>
                  </>
                )}
              </div>
              {drill?.prefs.endless && (
                <p className="muted" role="status">
                  {t('The next drill starts in a moment.')}
                </p>
              )}
            </div>
          </div>
        )}
        {midiCalibrating && midi && (
          <MidiLatencyCalibration
            input={midi.input}
            device={midiDevice(midi.devices)}
            onClose={() => {
              setMidiCalibrating(false);
              void applyMidiCalibration(midi.devices);
            }}
          />
        )}
        {micCalibrating && (
          <MicCalibration
            mic={micCalibrating}
            onClose={() => {
              const input = micCalibrating;
              setMicCalibrating(null);
              void attachMic(input);
            }}
          />
        )}
      </div>
    </>
  );
}
