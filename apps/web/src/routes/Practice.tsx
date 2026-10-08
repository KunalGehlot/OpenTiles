import { useEffect, useMemo, useRef, useState } from 'react';
import { customKeyboard, KEYBOARD_PRESETS, keyCount } from '@opentiles/practice';
import type { HandFilter } from '@opentiles/practice';
import type { Song } from '@opentiles/song-model';
import { now, unlockAudio } from '../audio/context';
import { synthFor } from '../audio/synth';
import { loadCatalogueSong } from '../catalogue/catalogue';
import { createMidiInput, midiSupported } from '../input/midi-input';
import type { MidiKeyboardInput } from '../input/midi-input';
import type { MicInput } from '../input/mic-input';
import { TouchInput } from '../input/touch-input';
import { href } from '../lib/router';
import { ListenBack } from '../practice/ListenBack';
import { connectClickTrack, MetronomeControl } from '../practice/MetronomeControl';
import { MicCalibration } from '../practice/MicCalibration';
import { MidiLatencyCalibration } from '../practice/MidiLatencyCalibration';
import { prepareSong } from '../practice/prepare';
import { SectionBar } from '../practice/SectionBar';
import { fitMessage, keyboardRange } from '../settings/model';
import type { FingeringDisplay } from '../settings/model';
import { updateAppSettings, useAppSettings } from '../settings/store';
import {
  getMicCalibration,
  getMidiCalibration,
  micCalibrationSkipped,
} from '../storage/calibration';
import { db, recordRun } from '../storage/db';
import { hitTest, rangeFor } from '../views/keyboard';
import { LoopDrag } from '../views/loop-drag';
import { PracticeRenderer } from '../views/renderer';
import { PracticeSession } from '../views/session';
import type { PracticeMode, SessionStatus } from '../views/session';
import { formatOfPath, notationFor } from '../views/score/notation';
import type { NotationSource } from '../views/score/notation';
import { ScoreView } from '../views/score/ScoreView';
import { usePracticeView, ViewToggle } from '../views/score/ViewToggle';

interface Loaded {
  source: 'catalogue' | 'library';
  song: Song;
  title: string;
  subtitle?: string;
  progressKey: string;
  notation: NotationSource;
}

const NO_BARS: readonly number[] = [];

export function Practice({ source, id }: { source: 'catalogue' | 'library'; id: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    const load = async (): Promise<Loaded> => {
      if (source === 'catalogue') {
        const { piece, song, bytes } = await loadCatalogueSong(id);
        return {
          source,
          song,
          title: piece.title,
          subtitle: piece.composer,
          progressKey: `catalogue:${id}`,
          notation: notationFor(formatOfPath(piece.score), bytes),
        };
      }
      const item = await db.library.get(Number(id));
      if (!item) throw new Error('This piece is not in your library on this device.');
      return {
        source,
        song: item.song,
        title: item.title,
        progressKey: `library:${id}`,
        notation: notationFor(item.format, item.bytes, item.settings.transpose),
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
      <div style={{ padding: '1rem' }}>
        <p className="error">{error}</p>
        <a href={href({ name: 'home' })}>Back to pieces</a>
      </div>
    );
  }
  if (!loaded) return <p style={{ padding: '1rem' }}>Loading…</p>;
  return <PracticeView key={loaded.progressKey} {...loaded} />;
}

function PracticeView({ source, song, title, subtitle, progressKey, notation }: Loaded) {
  const settings = useAppSettings();
  // The piece fitted to the learner's keyboard (P4-07), with the fingers they chose (P4-08).
  // Keyed on plain values: other settings changing must not restart the run.
  const { size, low, keys } = settings.keyboard;
  const fingering = settings.fingering;
  const range = useMemo(() => keyboardRange({ size, low, keys }), [size, low, keys]);
  const prepared = useMemo(() => prepareSong(song, range, fingering), [song, range, fingering]);
  const keysRange = useMemo(
    () => range ?? rangeFor(prepared.played.notes.map((n) => n.pitch)),
    [range, prepared],
  );
  const [session] = useState(() => new PracticeSession(prepared.played, now));
  const [status, setStatus] = useState<SessionStatus>(() => session.status());
  const [mode, setMode] = useState<PracticeMode>('wait');
  const [hands, setHands] = useState<HandFilter>('both');
  const [tempo, setTempo] = useState(1);
  const [accompany, setAccompany] = useState(true);
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
  const [view, setView] = usePracticeView(notation);

  // Wire the session to React and inputs.
  useEffect(() => {
    session.onStatus = setStatus;
    session.onFinish = (summary, seconds) => void recordRun(progressKey, summary.accuracy, seconds);
    session.onTempo = setTempo;
    // Loop runs count as practice time but not as a best score for the whole piece.
    const unsubscribe = session.addLoopListener(
      (run) => void recordRun(progressKey, 0, run.seconds),
    );
    const t = touch.current;
    t.onNote = (e) => session.input(e);
    t.onRelease = (p, time) => session.release(p, time);
    void t.start();
    return () => {
      unsubscribe();
      t.stop();
      session.stop();
    };
  }, [session, progressKey]);

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

  const ensureAudio = async () => {
    const ctx = await unlockAudio();
    session.setSynth(synthFor(ctx));
    await connectClickTrack(session);
  };

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
      await applyMidiCalibration(input.deviceNames);
    } catch (e) {
      setInputError(e instanceof Error ? e.message : String(e));
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
        e instanceof Error ? `Microphone: ${e.message}` : 'The microphone could not be started.',
      );
    } finally {
      setBusy(false);
    }
  };

  const changeMode = (m: PracticeMode) => {
    setMode(m);
    session.setMode(m);
    mic?.setMode(m === 'play-along' ? 'play-along' : 'wait');
  };

  const summary = status.summary;
  const fit = range && prepared.fit ? fitMessage(prepared.fit, range) : null;
  const holds = status.holds;
  const holdCount = holds.good + holds.short + holds.long;
  const measureLabel = (index: number) => song.measures[index]?.number ?? String(index + 1);

  return (
    <>
      <div className="practice-bar">
        <span className="title">
          {title}
          {subtitle && <span className="muted"> · {subtitle}</span>}
        </span>
        <div className="segmented" role="group" aria-label="Mode">
          {(
            [
              ['wait', 'Wait'],
              ['listen', 'Listen'],
              ['play-along', 'Play along'],
            ] as const
          ).map(([m, label]) => (
            <button key={m} aria-pressed={mode === m} onClick={() => changeMode(m)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Hands">
          {(
            [
              ['left', 'Left'],
              ['both', 'Both'],
              ['right', 'Right'],
            ] as const
          ).map(([h, label]) => (
            <button
              key={h}
              aria-pressed={hands === h}
              onClick={() => {
                setHands(h);
                session.setHands(h);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label title="Practice tempo">
          Tempo
          <input
            type="range"
            min={25}
            max={150}
            step={5}
            value={Math.round(tempo * 100)}
            onChange={(e) => {
              const t = Number(e.target.value) / 100;
              setTempo(t);
              session.setTempo(t);
            }}
          />
          {Math.round(tempo * 100)} %
        </label>
        {hands !== 'both' && (
          <label>
            <input
              type="checkbox"
              checked={accompany}
              onChange={(e) => {
                setAccompany(e.target.checked);
                session.accompany = e.target.checked;
              }}
            />
            Play other hand
          </label>
        )}
        <MetronomeControl session={session} on={status.metronome} />
        <button
          aria-expanded={showLoop || status.loop !== null}
          aria-pressed={status.loop !== null}
          onClick={() => {
            if (status.loop) session.setLoop(null);
            setShowLoop(!(showLoop || status.loop !== null));
          }}
          title="Loop a range of bars (or drag across the falling notes)"
        >
          Loop
        </button>
        {mode !== 'wait' && (
          <button className="primary" onClick={() => void toggle()}>
            {status.playing ? 'Stop' : mode === 'listen' ? 'Listen' : 'Start'}
          </button>
        )}
        <button onClick={() => session.rebuild()}>Restart</button>
        <label title="The keys of your own keyboard; pieces are moved by octaves to fit">
          <span className="bar-label">Keys</span>
          <select
            aria-label="Keyboard size"
            value={settings.keyboard.size}
            onChange={(e) =>
              void updateAppSettings({ keyboard: { ...settings.keyboard, size: e.target.value } })
            }
          >
            <option value="auto">Fit piece</option>
            {KEYBOARD_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.keys}
              </option>
            ))}
            <option value="custom">Custom ({keyCount(customKeyboard(low, keys))})</option>
          </select>
        </label>
        <label className="bar-fingers" title="Which fingers to show on the notes, keys and score">
          <span className="bar-label">Fingers</span>
          <select
            aria-label="Fingering"
            value={settings.fingering}
            onChange={(e) =>
              void updateAppSettings({ fingering: e.target.value as FingeringDisplay })
            }
          >
            <option value="suggested">Suggested</option>
            <option value="written">As written</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>
      <div className="practice-bar">
        <span className="muted">Play with:</span>
        <span className="badge">On-screen keys / computer keys A–;</span>
        {midiSupported() ? (
          midi ? (
            <>
              <span className="badge">
                MIDI: {midi.devices.join(', ') || 'no device connected'}
              </span>
              <button onClick={() => setMidiCalibrating(true)} title="Measure keyboard delay">
                Calibrate timing
              </button>
            </>
          ) : (
            <button onClick={() => void connectMidi()}>Connect MIDI keyboard</button>
          )
        ) : (
          <span className="muted" title="Safari and iPad browsers have no Web MIDI">
            (MIDI not available in this browser)
          </span>
        )}
        {mic ? (
          <>
            <span className="badge">Microphone listening</span>
            <button
              onClick={() => {
                session.stop();
                mic.onNote = () => {};
                setMicCalibrating(mic);
              }}
            >
              Set up microphone
            </button>
          </>
        ) : (
          <button disabled={busy} onClick={() => void connectMic()}>
            {busy ? 'Starting…' : 'Use microphone'}
          </button>
        )}
        <span className="stats" aria-live="polite">
          {mode === 'wait' ? (
            <span>
              Step {Math.min(status.stepIndex + 1, status.stepCount)}/{status.stepCount}
            </span>
          ) : null}
          <span style={{ color: 'var(--ok)' }}>✓ {status.correct}</span>
          <span style={{ color: 'var(--bad)' }}>✗ {status.wrong}</span>
        </span>
        {inputError && <span className="error">{inputError}</span>}
        <ViewToggle view={view} onChange={setView} notation={notation} />
      </div>
      {fit && (
        <p className="practice-note muted" role="status">
          {fit}
        </p>
      )}
      {(showLoop || status.loop !== null) && (
        <SectionBar session={session} song={song} status={status} />
      )}
      {view !== 'falling' && notation.kind !== 'none' && (
        <ScoreView
          session={session}
          song={prepared.score}
          suggested={prepared.suggested}
          notation={notation}
          layout={view}
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
          aria-label="Falling notes and piano keyboard"
          role="img"
          data-keys={`${keysRange.low}-${keysRange.high}`}
        />
        {status.finished && summary && (
          <div className="overlay">
            <div className="panel stack">
              <h2 style={{ marginTop: 0 }}>Well played!</h2>
              <p>
                Accuracy <strong>{Math.round(summary.accuracy * 100)} %</strong>
                {status.elapsed > 0 && <> · {Math.round(status.elapsed)} s</>}
                {mode === 'play-along' && summary.meanOffsetMs > 0 && (
                  <> · timing ±{Math.round(summary.meanOffsetMs)} ms</>
                )}
              </p>
              {mode === 'play-along' && (
                <p className="muted">
                  {summary.hit} on time, {summary.early} early, {summary.late} late,{' '}
                  {summary.missed} missed
                  {summary.extra > 0 && <>, {summary.extra} extra</>}
                </p>
              )}
              {summary.hardestMeasures.length > 0 && (
                <p className="muted">
                  Hardest bars:{' '}
                  {summary.hardestMeasures.map((m) => measureLabel(m.measureIndex)).join(', ')}
                </p>
              )}
              {holdCount > 0 && (
                <p className="muted" data-testid="hold-summary">
                  Held well: {holds.good} of {holdCount}
                  {holds.short > 0 && <> · {holds.short} too short</>}
                  {holds.long > 0 && <> · {holds.long} too long</>}
                </p>
              )}
              {status.recorded && (
                <ListenBack session={session} title={title} allowSave={source === 'catalogue'} />
              )}
              <div className="row">
                <button className="primary" onClick={() => session.rebuild()}>
                  Play again
                </button>
                <a className="button" href={href({ name: 'home' })}>
                  Choose another piece
                </a>
              </div>
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
