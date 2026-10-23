import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Gauge,
  Headphones,
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
import {
  CHORD_SPREAD,
  customKeyboard,
  hardestChords,
  isChordDrillId,
  KEYBOARD_PRESETS,
  keyCount,
  mainCause,
  mostNotesAtOnce,
  pitchClassOf,
  recentShares,
  STRICT_CHORD_SPREAD,
} from '@opentiles/practice';
import type { ChordRoundSummary, ChordStats, HandFilter } from '@opentiles/practice';
import type { ScoreHints, Song } from '@opentiles/song-model';
import { audioContext, audioStarted, now, unlockAudio } from '../audio/context';
import { MidiOutInstrument, playbackInstrument, SentNotes } from '../audio/midi-out';
import { playsOn, playsOnMessage, playsOnUnavailableHint } from '../audio/plays-on';
import { synthFor } from '../audio/synth';
import { loadCatalogueSong } from '../catalogue/catalogue';
import {
  createMidiInput,
  describeMidiError,
  midiSupported,
  noKeyboardMessage,
  midiUnavailableMessage,
  midiUnavailableReason,
  midiAllowed,
  midiWaitingMessage,
  pickOutput,
  startMidiInput,
  webMidiSupported,
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
import {
  afterRound,
  causeName,
  chordDrillRoute,
  hintFor,
  kindLabel,
  loadChordDrill,
  loadChordDrillPrefs,
  loadChordStats,
  recordChordRound,
  saveChordDrillPrefs,
  weakFocus,
} from '../practice/chord-drill';
import type { ChordDrillPrefs, LoadedChordDrill } from '../practice/chord-drill';
import type { Route } from '../lib/router';
import { LiveStatsStrip } from '../practice/LiveStatsStrip';
import { OverviewStrip } from '../practice/OverviewStrip';
import { PlaysOnControl } from '../practice/PlaysOnControl';
import { stopPlayer } from '../player/browser';
import type { CollectionKey } from '../player/collection';
import { listenInPlayer } from '../player/listen';
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
import { spelledName } from '../lib/notes';
import type { SpellingSetting } from '../lib/notes';
import { loadPracticePrefs, savePracticePrefs } from '../practice/prefs';
import type { PracticePrefs } from '../practice/prefs';
import { updateAppSettings, useAppSettings, useEffectiveAccessibility } from '../settings/store';
import {
  getMicCalibration,
  getMidiCalibration,
  micCalibrationSkipped,
} from '../storage/calibration';
import { recordPracticeTime, recordRun } from '../storage/db';
import { getLibraryItem } from '../storage/library';
import { songWithPedals } from '../library/pedals';
import type { SheetAttachment } from '../storage/db';
import { hitTest, rangeFor } from '../views/keyboard';
import type { KeysToDraw } from '../views/keyboard';
import { LoopDrag } from '../views/loop-drag';
import { PracticeRenderer, spellKey } from '../views/renderer';
import { PracticeSession } from '../views/session';
import type { PracticeMode, SessionStatus } from '../views/session';
import { formatOfPath, scoreFor } from '../views/score/notation';
import { AddNotesButton } from '../library/AddNotesButton';
import type { NotationSource } from '../views/score/notation';
import { ScoreView } from '../views/score/ScoreView';
import { usePracticeView, ViewToggle } from '../views/score/ViewToggle';
import { Popover } from '../ui/Popover';
import { t } from '../i18n';

type SheetViews = typeof import('../views/sheet');

interface Loaded {
  source: 'catalogue' | 'library' | 'drill';
  song: Song;
  title: string;
  subtitle?: string;
  progressKey: string;
  notation: NotationSource;
  /** A drill (P5-05, P7-04): what it hides, and the choices for the next one. */
  drill?: DrillInfo;
  /**
   * The learner's sheet music for a library piece (ADR 0018), with its views: loaded with the
   * piece rather than lazily on first render, which React would hold back for a moment.
   */
  sheet?: { itemId: number; attachment: SheetAttachment; views: SheetViews };
  /** A sheet without notes yet (format 'pdf'): it can be read, not practised. */
  sheetOnly?: boolean;
  /**
   * Set when the score is engraved from the song (a MIDI piece, P5-13): the hints from the
   * learner's PDF it was engraved with (P5-18), if any.
   */
  engraved?: { hints: ScoreHints | undefined };
}

/**
 * A drill (P5-05, P7-04): what the screen gives away, and the choices for the next one. A chord
 * drill also carries its chords and names.
 */
type DrillInfo =
  | { kind: 'sight'; guide: 'keys' | 'none'; prefs: DrillPrefs }
  | {
      kind: 'chords';
      guide: 'full' | 'keys' | 'none';
      prefs: ChordDrillPrefs;
      drill: LoadedChordDrill;
    };

/** The next drill with the same choices. */
const nextDrill = (d: DrillInfo, chordPrefs?: ChordDrillPrefs, focus: string[] = []): Route =>
  d.kind === 'chords' ? chordDrillRoute(chordPrefs ?? d.prefs, focus) : drillRoute(d.prefs);

const NO_BARS: readonly number[] = [];
/** How long an endless drill's result stays before the next drill starts. */
const ENDLESS_PAUSE_MS = 2500;
/** The longest a key waits for sound to start before it plays anyway. */
const SOUND_WAIT_MS = 300;

const unavailableReason = () =>
  midiUnavailableReason({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    secure: window.isSecureContext,
  });

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
  // Loads the piece again, after notes were added to a sheet-only piece.
  const [reload, setReload] = useState(0);

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
      if (source === 'drill' && isChordDrillId(id)) {
        const chordPrefs = await loadChordDrillPrefs();
        const d = loadChordDrill(id, chordPrefs.names);
        return {
          source,
          song: d.song,
          title: d.title,
          subtitle: t('Chords'),
          progressKey: `drill:${id}`,
          notation: { kind: 'musicxml', text: d.musicxml, transpose: 0 },
          drill: {
            kind: 'chords',
            guide: chordPrefs.show === 'falling' ? 'full' : chordPrefs.showKeys ? 'keys' : 'none',
            prefs: chordPrefs,
            drill: d,
          },
        };
      }
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
          drill: { kind: 'sight', guide: drillPrefs.showKeys ? 'keys' : 'none', prefs: drillPrefs },
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
      const found = await getLibraryItem(Number(id));
      if (!found) throw new Error(t('This piece is not in your library on this device.'));
      // Pieces stored before pedals were read get them from their file, once (P6-10).
      const item = { ...found, song: (await songWithPedals(found.id)) ?? found.song };
      const views = item.sheet ? await import('../views/sheet') : null;
      const hints = item.sheet?.map && !item.sheet.map.edited ? item.sheet.map.score : undefined;
      return {
        source,
        // A MIDI file's score is written from the song (P5-13), which comes back with the refs of
        // its glyphs.
        // A MIDI piece with the learner's PDF is engraved as the PDF writes it, unless the learner
        // had to correct how its bars were found (P5-18).
        ...scoreFor(item.format, item.bytes, item.song, item.settings.transpose, hints),
        engraved: item.format === 'midi' ? { hints } : undefined,
        title: item.title,
        progressKey: `library:${id}`,
        sheet:
          item.sheet && views ? { itemId: Number(id), attachment: item.sheet, views } : undefined,
        sheetOnly:
          item.sheet !== undefined && (item.format === 'pdf' || item.song.notes.length === 0),
      };
    };
    load()
      .then((l) => !cancelled && setLoaded(l))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [source, id, reload]);

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
  if (loaded.sheetOnly && loaded.sheet) {
    const { SheetReader } = loaded.sheet.views;
    return (
      <SheetReader
        title={loaded.title}
        bytes={loaded.sheet.attachment.bytes}
        onNotesAdded={() => setReload((n) => n + 1)}
        addNotes={(onSaved) => <AddNotesButton itemId={Number(id)} onSaved={onSaved} />}
      />
    );
  }
  return <PracticeView key={loaded.progressKey} {...loaded} prefs={prefs} />;
}

function PracticeView({
  source,
  song: loadedSong,
  title,
  subtitle,
  progressKey,
  notation: loadedNotation,
  drill,
  sheet,
  engraved,
  prefs: savedPrefs,
}: Loaded & { prefs: PracticePrefs }) {
  const settings = useAppSettings();
  // The score engraved again once the learner's PDF has been read (P5-18).
  const [written, setWritten] = useState<{ song: Song; notation: NotationSource } | null>(null);
  const song = written?.song ?? loadedSong;
  const notation = written?.notation ?? loadedNotation;
  // A drill starts in wait mode with both hands, shows the score and nothing that gives the notes
  // away (no falling notes, no overview), and keeps the learner's choices for pieces as they are.
  // A chord drill at a tempo plays along at the tempo written into it (P7-07).
  const chordDrill = drill?.kind === 'chords' ? drill : null;
  const prefs = useMemo<PracticePrefs>(() => {
    if (!drill) return savedPrefs;
    const atTempo = drill.kind === 'chords' && drill.prefs.pace === 'tempo';
    return {
      ...savedPrefs,
      mode: atTempo ? 'play-along' : 'wait',
      hands: 'both',
      overview: false,
      ...(drill.kind === 'chords' ? { tempo: 1, accompany: false } : {}),
    };
  }, [drill, savedPrefs]);
  // A chord drill's choices after this round (the tempo ladder may move), its progress before the
  // round, and the round itself, for the result card (P7-07, P7-08).
  const [chordPrefs, setChordPrefs] = useState<ChordDrillPrefs | null>(chordDrill?.prefs ?? null);
  const [chordRound, setChordRound] = useState<{
    summary: ChordRoundSummary;
    before: ChordStats;
    after: ChordStats;
    tempo: { from: number; to: number } | null;
  } | null>(null);
  const [chordFocus, setChordFocus] = useState<string[]>([]);
  useEffect(() => {
    if (!chordDrill?.prefs.weak) return;
    let cancelled = false;
    void loadChordStats().then(
      (stats) => !cancelled && setChordFocus(weakFocus(stats, chordDrill.prefs)),
    );
    return () => {
      cancelled = true;
    };
  }, [chordDrill]);
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
  // The learner's keyboard is drawn as it is; the keys a piece needs may grow on a wide window.
  const keysRange = useMemo<KeysToDraw>(
    () =>
      range
        ? { ...range, fixed: true }
        : { ...rangeFor(prepared.played.notes.map((n) => n.pitch)), fixed: false },
    [range, prepared],
  );
  const [session] = useState(() => new PracticeSession(prepared.played, now));
  const [status, setStatus] = useState<SessionStatus>(() => session.status());

  // A MIDI piece with the learner's PDF: the PDF is read in the background whichever view is
  // open, and the score then follows how it writes the notes (P5-18). Only before anything has
  // been played on this visit, since a new score restarts the run; otherwise next time.
  useEffect(() => {
    if (!sheet || !engraved) return;
    const abort = new AbortController();
    const { views, itemId, attachment } = sheet;
    views
      .ensureSheetMap(
        itemId,
        attachment,
        loadedSong,
        async () => {
          const opened = await views.openPdf(attachment.bytes);
          return { ...opened, done: () => void opened.doc.loadingTask.destroy() };
        },
        { signal: abort.signal },
      )
      .then(({ map }) => {
        const hints = map.edited ? undefined : map.score;
        if (!hints || JSON.stringify(hints) === JSON.stringify(engraved.hints)) return;
        const s = session.status();
        if (s.playing || s.finished || s.stepIndex > 0 || s.correct + s.wrong > 0) return;
        setWritten(scoreFor('midi', undefined, loadedSong, 0, hints));
      })
      .catch(() => {
        // Not read: the score stays as the writer engraves it.
      });
    return () => abort.abort();
  }, [sheet, engraved, loadedSong, session]);
  const [mode, setMode] = useState<PracticeMode>(prefs.mode);
  // A remembered hand the piece has no notes for (the left hand of a melody level) is not used here
  // and not forgotten either.
  const startHands: HandFilter =
    prefs.hands === 'both' || song.notes.some((n) => n.hand === prefs.hands) ? prefs.hands : 'both';
  const [hands, setHands] = useState<HandFilter>(startHands);
  const handsInPiece = useMemo(() => new Set(song.notes.map((n) => n.hand)), [song]);
  const [tempo, setTempo] = useState(prefs.tempo);
  const [accompany, setAccompany] = useState(prefs.accompany);
  const [liveStats, setLiveStats] = useState(prefs.liveStats);
  const [overview, setOverview] = useState(prefs.overview);
  // The input and its device names are separate state: the names change whenever a port opens or
  // a keyboard comes or goes (also when the app first plays on the keyboard), and that must never
  // look like a new input, which used to stop the one in use while the screen still said connected.
  const [midiInput, setMidiInput] = useState<MidiKeyboardInput | null>(null);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [midiOutputs, setMidiOutputs] = useState<string[]>([]);
  // True once the screen has tried to connect by itself, so "not connected" does not flash first.
  const [midiChecked, setMidiChecked] = useState(false);
  const [mic, setMic] = useState<MicInput | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [midiWaiting, setMidiWaiting] = useState(false);
  const [showLoop, setShowLoop] = useState(false);
  const [midiCalibrating, setMidiCalibrating] = useState(false);
  const [micCalibrating, setMicCalibrating] = useState<MicInput | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PracticeRenderer | null>(null);
  const touch = useRef(new TouchInput());
  const pointers = useRef(new Map<number, number>());
  const [loopDrag] = useState(() => new LoopDrag(session, () => rendererRef.current));
  const [chosenView, setView] = usePracticeView(notation, sheet !== undefined);
  // The page view shows the whole drill at once, so the learner can read ahead; a chord drill can
  // show falling keys instead (P7-06).
  const view = chordDrill?.prefs.show === 'falling' ? 'falling' : drill ? 'page' : chosenView;
  useScreenWakeLock(session, status.playing);
  // After a run the position glides back to the start; under Reduce motion it jumps there.
  const { reducedMotion } = useEffectiveAccessibility();
  useEffect(() => {
    session.glideHome = !reducedMotion;
  }, [session, reducedMotion]);

  // Practice and drills take the sound over from the Player (P6-05, plan Q5).
  useEffect(() => stopPlayer(), []);

  // Wire the session to React and inputs.
  useEffect(() => {
    session.onStatus = setStatus;
    session.guide = drill?.guide ?? 'full';
    // A chord drill judges whole chords (P7-03), lights the keys its level allows (P7-06) and, for
    // "Name only", keeps the notes to come off the score (P7-05).
    const chords = drill?.kind === 'chords' ? drill : null;
    session.chordDrill = chords
      ? {
          kinds: chords.drill.chords.map((c) => `${pitchClassOf(c.chord.root)}.${c.chord.quality}`),
          roots: chords.drill.chords.map((c) => pitchClassOf(c.chord.root)),
          spread: chords.prefs.strict ? STRICT_CHORD_SPREAD : CHORD_SPREAD,
        }
      : null;
    session.keyHint =
      chords && chords.prefs.show === 'falling'
        ? hintFor(chords.prefs, chords.drill.options.level)
        : 'all';
    session.hideAhead =
      chords !== null && chords.prefs.show === 'sheet' && chords.prefs.names === 'name-only';
    session.onFinish = (summary, seconds) => {
      if (!drill) return void recordRun(progressKey, summary.accuracy, seconds);
      void recordPracticeTime(seconds);
      if (!chords) return;
      const round = session.chords.summary();
      void recordChordRound(round, session.chords.attempts).then(({ before, after }) => {
        const next = afterRound(chords.prefs, round.share);
        if (next !== chords.prefs) void saveChordDrillPrefs(next);
        setChordPrefs(next);
        setChordRound({
          summary: round,
          before,
          after,
          tempo:
            next.tempo !== chords.prefs.tempo ? { from: chords.prefs.tempo, to: next.tempo } : null,
        });
        if (next.weak) setChordFocus(weakFocus(after, next));
      });
    };
    session.onTempo = (factor) => {
      setTempo(factor);
      remember({ tempo: factor });
    };
    // Loop runs count as practice time but not as a best score for the whole piece.
    const unsubscribe = session.addLoopListener(
      (run) =>
        void (drill ? recordPracticeTime(run.seconds) : recordRun(progressKey, 0, run.seconds)),
    );
    // A run the learner plays counts in and starts by itself (P6-20); a drill waits for its first
    // note. The count-in's opening waits while it could not be heard.
    session.countIn = !drill || (drill.kind === 'chords' && drill.prefs.pace === 'tempo');
    session.soundReady = () => audioStarted() || keyboardOut.current !== null || soundTried.current;
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
    // A chord round waits for its result to be kept, so the next round has the new tempo.
    if (drill.kind === 'chords' && !chordRound) return;
    const timer = window.setTimeout(
      () => navigate(nextDrill(drill, chordPrefs ?? undefined, chordFocus)),
      ENDLESS_PAUSE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [finished, drill, chordRound, chordPrefs, chordFocus]);
  // A new run of the same drill starts a new round.
  useEffect(() => {
    if (!finished) setChordRound(null);
  }, [finished]);

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

  // The input in use, stopped when another replaces it (Connect pressed twice, or pressed while
  // the screen connects by itself) and when the screen closes; otherwise both would hear every key.
  const midiInUse = useRef<MidiKeyboardInput | null>(null);
  useEffect(
    () => () => {
      midiInUse.current?.stop();
      midiInUse.current = null;
    },
    [],
  );
  useEffect(
    () => () => {
      mic?.stop();
    },
    [mic],
  );

  // How the app plays notes without velocities (Settings → Practice, P6-11).
  useEffect(() => {
    session.touch = settings.touch;
  }, [session, settings.touch]);

  // Leaving the page or hiding it ends the run, so nothing keeps sounding on a MIDI keyboard
  // (P6-02): notes stamped ahead may lose their note-offs once the page is gone, and a hidden tab
  // draws no frames, so the piece would stop there anyway.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') session.stop();
    };
    const onPageHide = () => session.stop();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [session]);

  // A new keyboard size or fingering: the same piece with other pitches or fingers.
  useEffect(() => {
    session.setSong(prepared.played);
    rendererRef.current?.setRange(keysRange);
  }, [session, prepared, keysRange]);

  // Canvas: resize and draw every frame.
  const initialRange = useRef(keysRange);
  // A chord drill's names on the falling bars (P7-06), unless the learner hides them.
  const chordLabels = useRef(
    chordDrill && chordDrill.prefs.show === 'falling' && chordDrill.prefs.names !== 'hidden'
      ? chordDrill.drill.chords.map((c, i) => ({
          beat: c.beat,
          text: chordDrill.drill.names[i] ?? '',
        }))
      : [],
  );
  // A chord drill's notes are named as its chords spell them (P7-06).
  const spelledNames = useRef(
    chordDrill
      ? new Map(
          chordDrill.drill.chords.flatMap((c) =>
            [...c.lower, ...c.upper].map(
              (n) => [spellKey(c.beat, n.midi), spelledName(n.letter, n.alter)] as const,
            ),
          ),
        )
      : null,
  );
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const renderer = new PracticeRenderer(canvas, initialRange.current);
    rendererRef.current = renderer;
    renderer.chordLabels = chordLabels.current;
    renderer.spelledNames = spelledNames.current;
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
   * Where notes sound ("Plays on", P6-01): the app's own notes on this device, the MIDI keyboard or
   * both, and the keys played on the MIDI keyboard echoed on this device or not. With the keyboard
   * chosen but out of reach, the notes play on this device and the screen says why.
   */
  const { echo: midiEcho, playback: midiPlayback, output: midiOutput, thru } = settings.midi;
  const routeFor = (input: MidiKeyboardInput | null, inputs: string[], outputs: string[]) =>
    playsOn(midiPlayback, {
      supported: midiSupported(),
      connected: input !== null,
      inputs,
      outputs,
      name: midiOutput,
    });
  const route = routeFor(midiInput, midiDevices, midiOutputs);
  // Copies of the app's notes that a "MIDI thru" keyboard sends back, ignored as input (P6-02).
  const echoes = useRef<SentNotes | null>(null);
  // One instrument per output, kept while it is in use: it knows which notes it has sounding, so
  // Stop can end them all (Play, Stop and every tap apply the sound again).
  const keyboardOut = useRef<{
    input: MidiKeyboardInput;
    output: string;
    instrument: MidiOutInstrument;
  } | null>(null);
  // The keyboard needs no sound on this device: its part plays even before the browser lets this
  // device sound (wait mode on a MIDI keyboard may never see a tap or a click).
  const applySound = (ctx: AudioContext | null) => {
    const device = ctx ? synthFor(ctx) : null;
    // A keyboard that has just connected is not on the screen yet; its own lists say where it plays.
    const input = midiInUse.current;
    const to =
      input === midiInput
        ? route
        : routeFor(input, input?.deviceNames ?? [], input?.outputNames ?? []);
    let kept = keyboardOut.current;
    if (kept && (kept.input !== input || kept.output !== to.output)) {
      // The notes move elsewhere (another output, or this device): nothing may keep sounding here.
      kept.instrument.silence();
      kept = null;
    }
    if (!kept && input && to.output) {
      const sink = input.output(midiOutput);
      if (sink) {
        kept = {
          input,
          output: to.output,
          instrument: new MidiOutInstrument(sink, now),
        };
      }
    }
    keyboardOut.current = kept;
    const keyboard = kept?.instrument ?? null;
    if (kept && keyboard) {
      keyboard.sent = thru.includes(kept.output) ? (keyboard.sent ?? new SentNotes()) : null;
    }
    echoes.current = keyboard?.sent ?? null;
    session.setSynth(playbackInstrument(device, keyboard, to.effective));
    session.midiEcho = midiEcho ? device : null;
    // A count-in that waited for sound can start now.
    session.startCountIn();
  };

  // Sound may start long after the render that asked for it (a keyboard connected meanwhile), so
  // it applies the newest choices.
  const applySoundNow = useRef(applySound);
  useEffect(() => {
    applySoundNow.current = applySound;
  });
  // True once a try to start sound has finished, whether sound started or not (a browser with no
  // sound device never starts it): from then on nothing waits for it.
  const soundTried = useRef(false);
  const startSound = async () => {
    try {
      const starting = unlockAudio();
      // The context exists from here on: notes go to it at once, and sound once it runs.
      applySoundNow.current(audioContext());
      applySoundNow.current(await starting);
    } finally {
      soundTried.current = true;
      session.startCountIn();
    }
  };
  const ensureAudio = async () => {
    await startSound();
    await connectClickTrack(session);
  };
  // A key that completes a step plays the other hand with it, so before sound has started such a
  // key waits for it: a moment, never more than SOUND_WAIT_MS after the first try began.
  const firstSound = useRef<{ until: number; ready: Promise<void> } | null>(null);
  const waitForSound = (): Promise<void> | null => {
    if (audioStarted() || soundTried.current || !session.playsOtherHand) return null;
    if (!firstSound.current) {
      firstSound.current = { until: performance.now() + SOUND_WAIT_MS, ready: startSound() };
    }
    const left = firstSound.current.until - performance.now();
    if (left <= 0) return null;
    return Promise.race([
      firstSound.current.ready,
      new Promise<void>((resolve) => window.setTimeout(resolve, left)),
    ]);
  };

  // A changed setting, or a keyboard (and its output) connected later, applies at once.
  useEffect(() => {
    applySound(audioContext());
    // applySound reads exactly these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midiInput, midiDevices, midiOutputs, midiEcho, midiPlayback, midiOutput, thru]);

  // Sound on this device starts only from a tap, a click or a key (Safari), and wait mode has no Play
  // button: the first one anywhere on the screen starts it, so the other hand, the metronome and the
  // keyboard's echo sound in wait mode too.
  useEffect(() => {
    const start = () => {
      if (!audioStarted()) ensureAudio().catch(() => {});
    };
    window.addEventListener('pointerdown', start, true);
    window.addEventListener('keydown', start, true);
    // The first key tapped or typed waits a moment for sound to start: the step it completes plays
    // the other hand, and its time is on the clock every later note uses.
    touch.current.waitFor = waitForSound;
    return () => {
      window.removeEventListener('pointerdown', start, true);
      window.removeEventListener('keydown', start, true);
    };
  });

  const toggle = async () => {
    // Stopping needs no sound, so it never waits for the browser to start audio (which can take
    // up to two seconds where it never starts): the keyboard and the screen stop at once.
    if (session.playing) {
      session.stop();
      return;
    }
    await ensureAudio();
    session.start();
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
    // The tap that starts the count-in plays no key.
    if (session.status().tapToStart) return;
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

  const mounted = useRef(true);
  /** Connects the MIDI keyboard; `quiet` when the screen does it by itself, which never prompts. */
  const connectMidi = async (quiet = false) => {
    if (!quiet) setInputError(null);
    setMidiWaiting(false);
    try {
      const input = createMidiInput();
      input.onNote = (e) => {
        if (!echoes.current?.isEcho(true, e.pitch, e.time)) session.input(e);
      };
      input.onRelease = (p, time) => {
        if (!echoes.current?.isEcho(false, p, time)) session.release(p, time);
      };
      // A port opening fires this too; only a real change of keyboards re-renders the screen.
      const same = (a: string[], b: string[]) => a.join('\n') === b.join('\n');
      input.onDevicesChanged = (names) => {
        setMidiDevices((old) => (same(old, names) ? old : names));
        const outs = input.outputNames;
        setMidiOutputs((old) => (same(old, outs) ? old : outs));
      };
      // The browser's permission prompt is easy to miss, and nothing happens until it is answered.
      await startMidiInput(input, () => !quiet && setMidiWaiting(true)).finally(() =>
        setMidiWaiting(false),
      );
      if (!mounted.current) {
        input.stop();
        return;
      }
      midiInUse.current?.stop();
      midiInUse.current = input;
      // At once: the keyboard may be played before the screen shows it connected.
      applySoundNow.current(audioContext());
      setMidiInput(input);
      setMidiDevices(input.deviceNames);
      setMidiOutputs(input.outputNames);
      if (input.deviceNames.length === 0 && !quiet) {
        setInputError(noKeyboardMessage(navigator.userAgent));
      }
      await applyMidiCalibration(input.deviceNames);
      // Played on a MIDI keyboard alone, the screen may never be tapped. Chrome and Firefox let
      // sound start once the page has been used (a link followed here counts). Only with Web MIDI:
      // Safari and the iPad app have none, so sound there still starts only from a gesture.
      if (webMidiSupported() && navigator.userActivation?.hasBeenActive && !audioStarted()) {
        ensureAudio().catch(() => {});
      }
    } catch (e) {
      if (!quiet) setInputError(describeMidiError(e, navigator.userAgent));
    } finally {
      if (mounted.current) setMidiChecked(true);
    }
  };

  /** "Plays on": choosing the keyboard connects it, as Connect does (P6-01). */
  const choosePlayback = (playback: MidiPlayback) => {
    void updateAppSettings({ midi: { ...settings.midi, playback } });
    if (playback !== 'device' && !midiInput && midiSupported()) void connectMidi();
  };

  // Once the browser allows MIDI for this site, every piece connects by itself, so Connect is
  // pressed once, not on every piece.
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void midiAllowed().then((allowed) => {
      if (cancelled) return;
      if (allowed) void connectMidi(true);
      else setMidiChecked(true);
    });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
    // Once per piece; connectMidi reads the session, which lives as long as this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const backRoute: Route =
    source === 'library'
      ? { name: 'library' }
      : drill
        ? { name: 'drills', page: drill.kind === 'chords' ? 'chords' : 'sight-reading' }
        : { name: 'home' };
  // Four or more notes at once on the microphone are best effort until P7-10 has numbers (Q6).
  const manyNotes = chordDrill !== null && mostNotesAtOnce(chordDrill.drill.chords) > 3;
  const nameOnly = chordDrill?.prefs.show === 'sheet' && chordDrill.prefs.names === 'name-only';
  const hardest = chordRound ? hardestChords(chordRound.summary) : [];
  const lastShares = chordRound ? recentShares(chordRound.before) : [];
  const lastShare =
    lastShares.length > 0 ? lastShares.reduce((a, b) => a + b, 0) / lastShares.length : null;

  return (
    <>
      <header className="bar session-bar">
        <a className="back" href={href(backRoute)}>
          <ChevronLeft />
          <span className="back__label">
            {source === 'library' ? t('My library') : drill ? t('Drills') : t('Pieces')}
          </span>
        </a>
        <h1 className="session-title">
          <span className="session-title__name">{title}</span>
          {subtitle && <span className="session-title__sub">{subtitle}</span>}
        </h1>
        <div className="session-bar__end">
          {midiSupported() ? (
            midiInput ? (
              <>
                <span
                  className="chip chip--live"
                  title={
                    midiDevices.length > 0
                      ? t('A MIDI keyboard is connected')
                      : t('Plug in your keyboard and switch it on; it appears here by itself.')
                  }
                >
                  <Piano />
                  <span className="chip__text">
                    MIDI: {midiDevices.join(', ') || t('no device connected')}
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
              <button aria-busy={midiWaiting} onClick={() => void connectMidi()}>
                <Piano />
                <span className="btn-label">
                  {midiWaiting ? t('Waiting for the browser…') : t('Connect MIDI keyboard')}
                </span>
              </button>
            )
          ) : (
            <Popover label={t('MIDI keyboard')} icon={<Piano />}>
              <p className="popover__hint" data-testid="midi-unavailable">
                {midiUnavailableMessage(unavailableReason())}
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
            )}
            <p className="muted popover__hint">
              {t(
                'The on-screen keys and the computer keys A–; always play. Pieces are moved by octaves to fit the keyboard you choose.',
              )}
            </p>
            {(progressKey.startsWith('catalogue:') || progressKey.startsWith('library:')) && (
              <button
                className="quiet"
                onClick={() => void listenInPlayer(progressKey as CollectionKey)}
              >
                <Headphones /> {t('Listen in the Player')}
              </button>
            )}
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
          <PlaysOnControl
            choice={midiPlayback}
            route={route}
            supported={midiSupported()}
            keyboardName={pickOutput(midiOutputs, midiDevices, midiOutput)}
            outputs={midiOutputs}
            outputName={midiOutput}
            unavailableHint={playsOnUnavailableHint(unavailableReason())}
            onChoose={choosePlayback}
            onOutput={(output) => void updateAppSettings({ midi: { ...settings.midi, output } })}
          />
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
                // A hand the piece has no notes for (a melody alone) would leave nothing to play.
                disabled={h !== 'both' && hands !== h && !handsInPiece.has(h)}
                title={
                  h !== 'both' && !handsInPiece.has(h)
                    ? t('This piece has no notes for this hand.')
                    : undefined
                }
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
              // On, it loops the whole piece at once, so wait mode goes round again instead of
              // ending; the bars, a drag or phrase by phrase narrow it. Off stops looping.
              const on = !(showLoop || status.loop !== null);
              session.setLoop(
                on ? { fromMeasure: 0, toMeasure: Math.max(0, song.measures.length - 1) } : null,
              );
              setShowLoop(on);
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
              {chordDrill
                ? t('Chord {step}/{count}', {
                    step: Math.min(status.stepIndex + 1, status.stepCount),
                    count: status.stepCount,
                  })
                : t('Step {step}/{count}', {
                    step: Math.min(status.stepIndex + 1, status.stepCount),
                    count: status.stepCount,
                  })}
            </span>
          ) : null}
          {status.chords && status.chords.judged > 0 && (
            <span className="stat" data-testid="chord-first-try">
              {t('{n} of {count} at the first try', {
                n: status.chords.firstTry,
                count: status.chords.judged,
              })}
            </span>
          )}
          <span className="stat stat--ok">✓ {status.correct}</span>
          <span className="stat stat--bad">✗ {status.wrong}</span>
        </span>
        {liveStats && <LiveStatsStrip stats={status.live} mode={mode} />}
        {nameOnly && mode === 'wait' && !status.finished && (
          <button
            onClick={() => session.revealChord()}
            disabled={status.revealed}
            title={t('Shows the chord on the sheet; it counts as a miss.')}
          >
            {t('Show me')}
          </button>
        )}
        {mic && manyNotes && (
          <span className="hint" role="status" data-testid="chord-mic-hint">
            {t('Four-note chords work best with a MIDI keyboard or the on-screen keys.')}
          </span>
        )}
        {inputError && <span className="error">{inputError}</span>}
        {route.problem && route.problem !== 'no-midi' && midiChecked && !midiWaiting && (
          <span className="hint" role="status" data-testid="plays-on-notice">
            {playsOnMessage(route.problem)}
            {route.problem === 'not-connected' && (
              <>
                {' '}
                <button onClick={() => void connectMidi()}>{t('Connect')}</button>
              </>
            )}
          </span>
        )}
        {midiWaiting && (
          <span className="hint" role="status" data-testid="midi-waiting">
            {midiWaitingMessage(navigator.userAgent)}
          </span>
        )}
        <div className="session-status__view">
          {!drill && (
            <ViewToggle
              view={view}
              onChange={setView}
              notation={shownNotation}
              hasSheet={sheet !== undefined}
            />
          )}
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
      {(view === 'scroll' || view === 'page') && shownNotation.kind !== 'none' && (
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
      {view === 'sheet' && sheet && (
        <sheet.views.SheetView
          session={session}
          song={song}
          itemId={sheet.itemId}
          sheet={sheet.attachment}
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
        {status.countdown !== null && (
          <div className="countdown" role="timer" aria-live="polite" aria-atomic="true">
            {/* A new element for each number, so its animation starts again. */}
            <span key={status.countdown} className="countdown__number">
              {status.countdown}
            </span>
          </div>
        )}
        {status.tapToStart && (
          <div className="countdown" role="status">
            <p className="countdown__tap">
              {t('Tap to start')}
              <small>{t('or press a key')}</small>
            </p>
          </div>
        )}
        {status.finished && summary && (
          <div className="overlay">
            <div className="panel stack summary">
              <h2>{t('Well played!')}</h2>
              {chordDrill && status.chords ? (
                <div
                  className="ring"
                  role="img"
                  aria-label={t('{percent} % at the first try', {
                    percent: Math.round(
                      (status.chords.firstTry / Math.max(1, status.chords.judged)) * 100,
                    ),
                  })}
                  style={
                    {
                      '--pct': Math.round(
                        (status.chords.firstTry / Math.max(1, status.chords.judged)) * 100,
                      ),
                    } as React.CSSProperties
                  }
                >
                  <span className="ring__value">
                    {Math.round((status.chords.firstTry / Math.max(1, status.chords.judged)) * 100)}
                    <small> %</small>
                  </span>
                  <span className="ring__label">{t('first try')}</span>
                </div>
              ) : (
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
              )}
              {chordDrill && status.chords && (
                <div className="chord-result" data-testid="chord-result">
                  <p className="drill-speed">
                    <strong>
                      {mode === 'wait'
                        ? t('{n} chords a minute', { n: status.chords.perMinute })
                        : t('{n} of {count} chords together and on time', {
                            n: status.chords.firstTry,
                            count: status.chords.judged,
                          })}
                    </strong>
                    {mode === 'wait' && (
                      <>
                        {' · '}
                        {t('{n} of {count} at the first try', {
                          n: status.chords.firstTry,
                          count: status.chords.judged,
                        })}
                      </>
                    )}
                  </p>
                  {lastShare !== null && (
                    <p className="muted">
                      {t('Your last rounds: {percent} % at the first try', {
                        percent: Math.round(lastShare * 100),
                      })}
                    </p>
                  )}
                  {hardest.length > 0 && (
                    <ul className="chord-hardest">
                      {hardest.map((k) => {
                        const cause = mainCause(k);
                        const times = cause ? (k.causes[cause] ?? 0) : 0;
                        return (
                          <li key={k.kind}>
                            <strong>{kindLabel(k.kind)}</strong>
                            {cause &&
                              ` ${t('{cause}, {n}×', { cause: causeName(cause), n: times })}`}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {chordRound?.tempo && (
                    <p className="muted" role="status">
                      {chordRound.tempo.to > chordRound.tempo.from
                        ? t('Next round: {bpm} beats a minute, a step faster.', {
                            bpm: chordRound.tempo.to,
                          })
                        : t('Next round: {bpm} beats a minute, a step slower.', {
                            bpm: chordRound.tempo.to,
                          })}
                    </p>
                  )}
                </div>
              )}
              {drill?.kind === 'sight' && mode === 'wait' && status.elapsed > 0 && (
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
              {summary.hardestMeasures.length > 0 && !chordDrill && (
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
                    <a
                      className="button primary"
                      href={href(nextDrill(drill, chordPrefs ?? undefined, chordFocus))}
                    >
                      <Play /> {drill.kind === 'chords' ? t('Next round') : t('Next drill')}
                    </a>
                    <button onClick={() => session.rebuild()}>
                      <RotateCcw /> {t('Play again')}
                    </button>
                    <a className="button" href={href(backRoute)}>
                      {drill.kind === 'chords' ? t('Change the chords') : t('Change the drill')}
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
                  {drill.kind === 'chords'
                    ? t('The next round starts in a moment.')
                    : t('The next drill starts in a moment.')}
                </p>
              )}
            </div>
          </div>
        )}
        {midiCalibrating && midiInput && (
          <MidiLatencyCalibration
            input={midiInput}
            device={midiDevice(midiDevices)}
            onClose={() => {
              setMidiCalibrating(false);
              void applyMidiCalibration(midiDevices);
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
