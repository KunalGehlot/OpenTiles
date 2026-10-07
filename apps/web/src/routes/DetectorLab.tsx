// Detector Lab (PLAN.md P0-10): the Phase 0 tool for trying microphone recognition on a real
// piano, recording the test set (P0-04) and measuring latency (P0-11).
import { useEffect, useRef, useState } from 'react';
import type { DetectorEvent, DetectorMode, MicDetector, ThresholdName } from '@opentiles/engine';
import { noteName } from '@opentiles/song-model';
import { synthFor } from '../audio/synth';
import { parseNoteNames } from '../lib/notes';
import { encodeWav } from '../lib/wav';

interface LoggedEvent extends DetectorEvent {
  receivedAt: number;
}

const DEFAULT_THRESHOLDS: Record<DetectorMode, Record<ThresholdName, number>> = {
  wait: { accept: 0.25, wrong: 0.45, wrongMargin: 0.1, octaveBelow: 0.25 },
  'play-along': { accept: 0.4, wrong: 0.4, wrongMargin: 0.05, octaveBelow: 0.25 },
};

const median = (xs: number[]) => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

export function DetectorLab() {
  const [running, setRunning] = useState<{
    detector: MicDetector;
    stream: MediaStream;
    context: AudioContext;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [mode, setMode] = useState<DetectorMode>('wait');
  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS.wait);
  const [expectedText, setExpectedText] = useState('C4 E4 G4');
  const [generation, setGeneration] = useState(0);
  const [log, setLog] = useState<LoggedEvent[]>([]);
  const [level, setLevel] = useState(0);
  const [noiseDb, setNoiseDb] = useState<number | null>(null);
  const [tuning, setTuning] = useState<number | null>(null);
  const [latency, setLatency] = useState<string | null>(null);
  const [benchmark, setBenchmark] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  const chunks = useRef<Float32Array[]>([]);
  const clickTimes = useRef<number[]>([]);
  const onsetTimes = useRef<number[]>([]);

  const expected = parseNoteNames(expectedText);

  useEffect(
    () => () => {
      running?.detector.dispose();
      for (const t of running?.stream.getTracks() ?? []) t.stop();
    },
    [running],
  );

  // Input level meter.
  useEffect(() => {
    if (!running) return;
    const analyser = running.context.createAnalyser();
    analyser.fftSize = 1024;
    const source = running.context.createMediaStreamSource(running.stream);
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let raf = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      setLevel(peak);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
    };
  }, [running]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const { createMicDetector } = await import('../input/mic-input');
      const r = await createMicDetector(mode);
      r.detector.onEvents = (events) => {
        const receivedAt = r.context.currentTime;
        for (const e of events) if (e.kind === 'onset') onsetTimes.current.push(e.time);
        setLog((prev) =>
          [...events.map((e) => ({ ...e, receivedAt })).reverse(), ...prev].slice(0, 200),
        );
      };
      r.detector.onAudio = (samples) => chunks.current.push(samples);
      for (const [name, value] of Object.entries(thresholds)) {
        r.detector.setThreshold(name as ThresholdName, value);
      }
      if (expected) setGeneration(r.detector.setExpected(expected));
      setRunning(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  const stop = () => setRunning(null);

  const applyExpected = (pitches: number[] | null) => {
    if (running && pitches) setGeneration(running.detector.setExpected(pitches));
  };

  const changeMode = (m: DetectorMode) => {
    setMode(m);
    setThresholds(DEFAULT_THRESHOLDS[m]);
    running?.detector.setMode(m);
  };

  const changeThreshold = (name: ThresholdName, value: number) => {
    setThresholds((t) => ({ ...t, [name]: value }));
    running?.detector.setThreshold(name, value);
  };

  const calibrate = async () => {
    if (!running) return;
    setNoiseDb(null);
    setNoiseDb(await running.detector.calibrateNoise(2000));
  };

  const readTuning = async () => {
    if (!running) return;
    setTuning((await running.detector.stats()).tuningEstimate);
  };

  const latencyTest = () => {
    if (!running) return;
    const ctx = running.context;
    const synth = synthFor(ctx);
    clickTimes.current = [];
    onsetTimes.current = [];
    const t0 = ctx.currentTime + 0.5;
    for (let i = 0; i < 8; i++) {
      const when = t0 + i * 0.6;
      synth.click(when, true);
      clickTimes.current.push(when);
    }
    setLatency('Listening for 8 clicks… keep the room quiet.');
    setTimeout(() => {
      const offsets: number[] = [];
      for (const c of clickTimes.current) {
        const hit = onsetTimes.current.find((o) => o > c - 0.02 && o < c + 0.4);
        if (hit !== undefined) offsets.push(hit - c);
      }
      setLatency(
        offsets.length === 0
          ? 'No clicks were heard. Turn the volume up and try again.'
          : `Speaker → microphone → detector onset: median ${(median(offsets) * 1000).toFixed(0)} ms over ${offsets.length}/8 clicks (output + input latency).`,
      );
    }, 6000);
  };

  const toggleRecording = () => {
    if (!running) return;
    if (!recording) {
      chunks.current = [];
      if (download) URL.revokeObjectURL(download.url);
      setDownload(null);
      running.detector.setRecording(true);
      setRecording(true);
    } else {
      running.detector.setRecording(false);
      setRecording(false);
      // The last chunk arrives asynchronously.
      setTimeout(() => {
        const wav = encodeWav(chunks.current, running.context.sampleRate);
        const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }));
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        setDownload({ url, name: `opentiles-take-${stamp}.wav` });
      }, 300);
    }
  };

  const runBenchmark = async () => {
    setBenchmark('Running…');
    try {
      const { loadEngine } = await import('../input/mic-input');
      const { EngineDetector } = await import('@opentiles/engine');
      const module = await loadEngine();
      const sr = 48000;
      const d = new EngineDetector(module, sr);
      d.setExpected([48, 60, 64, 67]);
      const seconds = 10;
      const samples = new Float32Array(sr * seconds);
      let seed = 7;
      for (let i = 0; i < samples.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const t = i / sr;
        const beat = t % 0.5;
        const env = Math.exp(-beat * 4);
        samples[i] =
          0.002 * (seed / 2 ** 32 - 0.5) +
          0.05 *
            env *
            (Math.sin(2 * Math.PI * 261.63 * t) + 0.5 * Math.sin(2 * Math.PI * 329.63 * t));
      }
      const t0 = performance.now();
      const events = d.process(samples);
      const ms = performance.now() - t0;
      d.dispose();
      const hops = (sr * seconds) / 256;
      setBenchmark(
        `${(ms / hops).toFixed(3)} ms per 5.3 ms hop on average (${ms.toFixed(0)} ms for ${seconds} s of audio, ${events.length} events). Target ≤ 2 ms on an older iPad.`,
      );
    } catch (e) {
      setBenchmark(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = { expected: 0, rejected: 0, wrong: 0, onset: 0 };
  for (const e of log) counts[e.kind] += 1;
  const delays = log.filter((e) => e.kind === 'expected').map((e) => e.decidedAt - e.time);

  return (
    <div className="stack">
      <h1>Detector Lab</h1>
      <p className="lead">
        Try microphone note recognition on a real piano. Tell the detector which notes you are about
        to play, play them (or something else) and watch its decisions. This is the Phase 0 test
        bench; everything runs on this device.
      </p>

      <div className="panel stack">
        <div className="row">
          {running ? (
            <button onClick={stop}>Stop microphone</button>
          ) : (
            <button className="primary" disabled={starting} onClick={() => void start()}>
              {starting ? 'Starting…' : 'Start microphone'}
            </button>
          )}
          <div className="segmented" role="group" aria-label="Mode">
            <button aria-pressed={mode === 'wait'} onClick={() => changeMode('wait')}>
              Wait mode
            </button>
            <button aria-pressed={mode === 'play-along'} onClick={() => changeMode('play-along')}>
              Play-along
            </button>
          </div>
          {running && (
            <span className="row">
              <span className="meter" aria-label="Input level">
                <div style={{ width: `${Math.min(100, level * 100)}%` }} />
              </span>
              <span className="muted">
                {running.context.sampleRate} Hz · base latency{' '}
                {((running.context.baseLatency ?? 0) * 1000).toFixed(0)} ms
              </span>
            </span>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <label>
          Expected notes
          <input
            type="text"
            value={expectedText}
            onChange={(e) => setExpectedText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyExpected(expected)}
            aria-invalid={expected === null}
            style={{ width: '14em' }}
          />
          <button disabled={!running || expected === null} onClick={() => applyExpected(expected)}>
            Set
          </button>
          <span className="muted">generation {generation}</span>
        </label>
        <div className="row">
          {['C4', 'A4', 'C4 E4 G4', 'C3 G3', 'C2', 'C6 E6', 'F#3 A3 D4'].map((t) => (
            <button
              key={t}
              disabled={!running}
              onClick={() => {
                setExpectedText(t);
                applyExpected(parseNoteNames(t));
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="panel stack">
        <strong>Thresholds</strong>
        <div className="row">
          {(Object.keys(thresholds) as ThresholdName[]).map((name) => (
            <label key={name}>
              {name}
              <input
                type="range"
                min={0}
                max={name === 'wrongMargin' ? 0.5 : 1}
                step={0.01}
                value={thresholds[name]}
                onChange={(e) => changeThreshold(name, Number(e.target.value))}
              />
              {thresholds[name].toFixed(2)}
            </label>
          ))}
        </div>
        <div className="row">
          <button disabled={!running} onClick={() => void calibrate()}>
            Measure room noise (2 s)
          </button>
          {noiseDb !== null && <span className="muted">noise {noiseDb.toFixed(1)} dB per bin</span>}
          <button disabled={!running} onClick={() => void readTuning()}>
            Estimate tuning
          </button>
          {tuning !== null && (
            <>
              <span className="muted">{tuning.toFixed(1)} cents from A = 440 Hz</span>
              <button onClick={() => running?.detector.setTuning(tuning)}>Apply</button>
            </>
          )}
        </div>
      </div>

      <div className="panel stack">
        <strong>Decisions</strong>
        <p className="muted">
          {counts.expected} accepted · {counts.rejected} rejected · {counts.wrong} wrong notes ·{' '}
          {counts.onset} onsets
          {delays.length > 0 && (
            <> · decision {(median(delays) * 1000).toFixed(0)} ms after onset (median)</>
          )}
        </p>
        <div className="log" role="log" aria-live="polite">
          {log.length === 0 && <span className="muted">Nothing yet.</span>}
          {log.map((e, i) => (
            <div
              key={i}
              className={e.kind === 'expected' ? 'ok' : e.kind === 'wrong' ? 'bad' : undefined}
            >
              {e.time.toFixed(3)}s {e.kind.padEnd(8)}{' '}
              {e.kind === 'onset' ? '' : noteName(e.pitch).padEnd(4)}{' '}
              {e.kind === 'onset'
                ? ''
                : `score ${e.confidence.toFixed(2)} odd ${e.odd.toFixed(2)} gen ${e.generation}`}{' '}
              {e.kind !== 'onset' && `+${((e.decidedAt - e.time) * 1000).toFixed(0)}ms`}
            </div>
          ))}
        </div>
        <div className="row">
          <button onClick={() => setLog([])}>Clear</button>
        </div>
      </div>

      <div className="panel stack">
        <strong>Test-set recorder and latency</strong>
        <p className="muted">
          Records exactly what the detector hears, as a WAV file saved to this device, for the Phase
          0 test set. Only record public-domain or your own music.
        </p>
        <div className="row">
          <button disabled={!running} onClick={toggleRecording} aria-pressed={recording}>
            {recording ? 'Stop recording' : 'Record'}
          </button>
          {download && (
            <a className="button" href={download.url} download={download.name}>
              Save {download.name}
            </a>
          )}
          <button disabled={!running} onClick={latencyTest}>
            Latency test (speaker clicks)
          </button>
          <button onClick={() => void runBenchmark()}>Benchmark detector speed</button>
        </div>
        {latency && <p>{latency}</p>}
        {benchmark && <p>{benchmark}</p>}
      </div>
    </div>
  );
}
