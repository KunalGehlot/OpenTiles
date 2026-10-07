import { useEffect, useRef, useState } from 'react';
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
import { db, recordRun } from '../storage/db';
import { hitTest, rangeFor } from '../views/keyboard';
import { PracticeRenderer } from '../views/renderer';
import { PracticeSession } from '../views/session';
import type { PracticeMode, SessionStatus } from '../views/session';

interface Loaded {
  song: Song;
  title: string;
  subtitle?: string;
  progressKey: string;
}

export function Practice({ source, id }: { source: 'catalogue' | 'library'; id: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    const load = async (): Promise<Loaded> => {
      if (source === 'catalogue') {
        const { piece, song } = await loadCatalogueSong(id);
        return {
          song,
          title: piece.title,
          subtitle: piece.composer,
          progressKey: `catalogue:${id}`,
        };
      }
      const item = await db.library.get(Number(id));
      if (!item) throw new Error('This piece is not in your library on this device.');
      return { song: item.song, title: item.title, progressKey: `library:${id}` };
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

function PracticeView({ song, title, subtitle, progressKey }: Loaded) {
  const [session] = useState(() => new PracticeSession(song, now));
  const [status, setStatus] = useState<SessionStatus>(() => session.status());
  const [mode, setMode] = useState<PracticeMode>('wait');
  const [hands, setHands] = useState<HandFilter>('both');
  const [tempo, setTempo] = useState(1);
  const [accompany, setAccompany] = useState(true);
  const [midi, setMidi] = useState<{ input: MidiKeyboardInput; devices: string[] } | null>(null);
  const [mic, setMic] = useState<MicInput | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PracticeRenderer | null>(null);
  const touch = useRef(new TouchInput());
  const pointers = useRef(new Map<number, number>());

  // Wire the session to React and inputs.
  useEffect(() => {
    session.onStatus = setStatus;
    session.onFinish = (summary, seconds) => void recordRun(progressKey, summary.accuracy, seconds);
    const t = touch.current;
    t.onNote = (e) => session.input(e);
    t.onRelease = (p) => session.release(p);
    void t.start();
    return () => {
      t.stop();
      session.stop();
    };
  }, [session, progressKey]);

  useEffect(() => {
    session.onExpected = (pitches) => mic?.setExpected(pitches);
    mic?.setExpected(session.mode === 'wait' ? (session.wait.current?.pitches ?? []) : []);
  }, [session, mic]);

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

  // Canvas: resize and draw every frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const renderer = new PracticeRenderer(canvas, rangeFor(song.notes.map((n) => n.pitch)));
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
  }, [session, song]);

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
    if (pitch === null) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, pitch);
    touch.current.press(pitch);
  };
  const onPointerUp = (e: React.PointerEvent) => {
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
      input.onRelease = (p) => session.release(p);
      input.onDevicesChanged = (devices) => setMidi((m) => (m ? { ...m, devices } : m));
      await input.start();
      setMidi({ input, devices: input.deviceNames });
    } catch (e) {
      setInputError(e instanceof Error ? e.message : String(e));
    }
  };

  const connectMic = async () => {
    setInputError(null);
    setBusy(true);
    try {
      await ensureAudio();
      const { MicInput } = await import('../input/mic-input');
      const input = new MicInput(session.mode === 'play-along' ? 'play-along' : 'wait');
      input.onNote = (e) => session.input(e);
      await input.start();
      setMic(input);
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
        {mode !== 'wait' && (
          <button className="primary" onClick={() => void toggle()}>
            {status.playing ? 'Stop' : mode === 'listen' ? 'Listen' : 'Start'}
          </button>
        )}
        <button onClick={() => session.rebuild()}>Restart</button>
      </div>
      <div className="practice-bar">
        <span className="muted">Play with:</span>
        <span className="badge">On-screen keys / computer keys A–;</span>
        {midiSupported() ? (
          midi ? (
            <span className="badge">MIDI: {midi.devices.join(', ') || 'no device connected'}</span>
          ) : (
            <button onClick={() => void connectMidi()}>Connect MIDI keyboard</button>
          )
        ) : (
          <span className="muted" title="Safari and iPad browsers have no Web MIDI">
            (MIDI not available in this browser)
          </span>
        )}
        {mic ? (
          <span className="badge">Microphone listening</span>
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
      </div>
      <div
        ref={wrapRef}
        className="practice-canvas-wrap"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} aria-label="Falling notes and piano keyboard" role="img" />
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
      </div>
    </>
  );
}
