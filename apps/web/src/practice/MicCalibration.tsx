// Guided microphone calibration, about 10 seconds (PLAN.md P1-20, spec §4): 2 s of room noise,
// three keys across the keyboard for level and tuning, and an optional speaker-click delay check.
// Every step can be skipped; results are stored for this microphone and reused on later starts.
import { useEffect, useRef, useState } from 'react';
import {
  CALIBRATION_PITCHES,
  clickTrain,
  latencyFromAnswers,
  median,
  micLevelVerdict,
} from '@opentiles/practice';
import type { MicLevelVerdict } from '@opentiles/practice';
import { noteName } from '@opentiles/song-model';
import { clickTrackFor } from '../audio/click-track';
import { now, unlockAudio } from '../audio/context';
import type { MicInput } from '../input/mic-input';
import { setMicCalibration, skipMicCalibration } from '../storage/calibration';
import type { MicCalibration as StoredMicCalibration } from '../storage/calibration';

const KEY_TIMEOUT_MS = 4000;
const LATENCY_CLICKS = 8;

type Phase = 'intro' | 'noise' | 'keys' | 'latency-offer' | 'latency' | 'done';

const VERDICT_TEXT: Record<MicLevelVerdict, string> = {
  ok: 'The level is good.',
  quiet: 'The piano sounds quiet. Move the device closer to the piano if notes are missed.',
  loud: 'The piano is very loud for this microphone. Move the device a little further away.',
  noisy: 'The room is noisy. Notes may be missed or misheard; a quieter room helps.',
  unknown: 'No keys were heard, so the level could not be checked.',
};

const describeKey = (pitch: number) => {
  if (pitch === 60) return 'middle C';
  return pitch < 60 ? `the low ${noteName(pitch)}` : `the high ${noteName(pitch)}`;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MicCalibration({
  mic,
  onClose,
}: {
  mic: MicInput;
  /** Called with the stored calibration, or null when the learner skipped it. */
  onClose: (calibration: StoredMicCalibration | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [keyIndex, setKeyIndex] = useState(0);
  const [heardKeys, setHeardKeys] = useState<number[]>([]);
  const [result, setResult] = useState<StoredMicCalibration | null>(null);
  const [verdict, setVerdict] = useState<MicLevelVerdict>('unknown');
  const cancelled = useRef(false);
  const skipKey = useRef<(() => void) | null>(null);
  const partial = useRef<StoredMicCalibration>({
    noiseDb: null,
    roomDb: null,
    peakDb: null,
    tuningCents: null,
    latency: null,
    measuredAt: 0,
  });

  useEffect(
    () => () => {
      cancelled.current = true;
      skipKey.current?.();
    },
    [],
  );

  /** Samples the input level every 50 ms until `stop` is called. */
  const sampleLevels = () => {
    const levels: number[] = [];
    const timer = window.setInterval(() => levels.push(mic.level()), 50);
    return { levels, stop: () => window.clearInterval(timer) };
  };

  const run = async () => {
    // 1. Room noise.
    setPhase('noise');
    const room = sampleLevels();
    const noiseDb = await mic.calibrateNoise(2000);
    room.stop();
    const finiteRoom = room.levels.filter(Number.isFinite);
    partial.current.noiseDb = Number.isFinite(noiseDb) ? noiseDb : null;
    partial.current.roomDb = finiteRoom.length ? median(finiteRoom) : null;
    if (cancelled.current) return;

    // 2. A few keys across the keyboard: level and tuning.
    setPhase('keys');
    const heard: number[] = [];
    let peak = -Infinity;
    for (let i = 0; i < CALIBRATION_PITCHES.length; i++) {
      const pitch = CALIBRATION_PITCHES[i] as number;
      setKeyIndex(i);
      const levels = sampleLevels();
      const ok = await new Promise<boolean>((resolve) => {
        const timer = window.setTimeout(() => finish(false), KEY_TIMEOUT_MS);
        function finish(v: boolean) {
          window.clearTimeout(timer);
          mic.onNote = () => {};
          skipKey.current = null;
          resolve(v);
        }
        skipKey.current = () => finish(false);
        mic.onNote = (e) => {
          if (e.pitch === pitch) finish(true);
        };
        mic.setExpected([pitch]);
      });
      // Let the note ring a moment so its level is measured, not just the attack.
      if (ok) await sleep(300);
      levels.stop();
      peak = Math.max(peak, ...levels.levels);
      if (ok) {
        heard.push(pitch);
        setHeardKeys([...heard]);
      }
      if (cancelled.current) return;
    }
    mic.setExpected([]);
    partial.current.peakDb = Number.isFinite(peak) ? peak : null;
    if (heard.length > 0) {
      const stats = await mic.stats();
      const cents = stats?.tuningEstimate;
      // Only trust a tuning estimate within a quarter tone; beyond that something else is wrong.
      if (cents !== undefined && Number.isFinite(cents) && Math.abs(cents) <= 50) {
        partial.current.tuningCents = Math.round(cents * 10) / 10;
        mic.setTuning(partial.current.tuningCents);
      }
    }
    setVerdict(
      heard.length === 0
        ? 'unknown'
        : micLevelVerdict(partial.current.roomDb ?? -Infinity, partial.current.peakDb ?? -Infinity),
    );
    if (cancelled.current) return;
    setPhase('latency-offer');
  };

  const runLatency = async () => {
    setPhase('latency');
    const ctx = await unlockAudio();
    const track = clickTrackFor(ctx);
    const previousVolume = track.volume;
    track.volume = 1;
    const onsets: number[] = [];
    const previous = mic.onDetector;
    mic.onDetector = (events) => {
      for (const e of events) if (e.kind === 'onset') onsets.push(e.time);
    };
    const clicks = clickTrain(now() + 0.5, LATENCY_CLICKS, 0.6);
    clicks.forEach((t) => track.click(t, true));
    await sleep(((clicks[clicks.length - 1] ?? 0) - now() + 0.6) * 1000);
    mic.onDetector = previous;
    track.volume = previousVolume;
    // Speaker → microphone → detector is output plus input latency; the learner hears the
    // output delay too, so only the input part is taken off their notes.
    const r = latencyFromAnswers(clicks, onsets, { before: 0.02, after: 0.4 });
    partial.current.latency =
      r.latency === null ? null : Math.max(0, r.latency - mic.outputLatency);
    finish();
  };

  const finish = () => {
    const c = { ...partial.current, measuredAt: Date.now() };
    setResult(c);
    void setMicCalibration(mic.deviceKey, c);
    setPhase('done');
  };

  const skip = () => {
    cancelled.current = true;
    skipKey.current?.();
    mic.setExpected([]);
    void skipMicCalibration(mic.deviceKey);
    onClose(null);
  };

  const keyPitch = CALIBRATION_PITCHES[keyIndex] ?? 60;

  return (
    <div className="overlay calibration" role="dialog" aria-label="Microphone set-up">
      <div className="panel stack">
        <h2 style={{ marginTop: 0 }}>Set up the microphone</h2>
        {phase === 'intro' && (
          <>
            <p>
              About 10 seconds: first stay quiet for 2 seconds, then play three keys when asked.
              This tunes note detection to your piano and room.
            </p>
            <div className="row">
              <button className="primary" onClick={() => void run()}>
                Start
              </button>
              <button onClick={skip}>Skip</button>
            </div>
          </>
        )}
        {phase === 'noise' && <p aria-live="polite">Stay quiet for 2 seconds…</p>}
        {phase === 'keys' && (
          <>
            <p aria-live="polite">
              Play <strong>{describeKey(keyPitch)}</strong> ({noteName(keyPitch)}) and let it ring.
            </p>
            <p className="muted">
              Key {keyIndex + 1} of {CALIBRATION_PITCHES.length}
              {heardKeys.length > 0 && <> · heard {heardKeys.map(noteName).join(', ')}</>}
            </p>
            <div className="row">
              <button onClick={() => skipKey.current?.()}>Skip this key</button>
              <button onClick={skip}>Skip set-up</button>
            </div>
          </>
        )}
        {phase === 'latency-offer' && (
          <>
            <p>{VERDICT_TEXT[verdict]}</p>
            <p>
              Optional: check the delay of the microphone. Turn the speakers up; the app plays 8
              clicks and listens for them (5 seconds).
            </p>
            <div className="row">
              <button className="primary" onClick={() => void runLatency()}>
                Check delay
              </button>
              <button onClick={finish}>Not now</button>
            </div>
          </>
        )}
        {phase === 'latency' && <p aria-live="polite">Listening for the clicks… keep quiet.</p>}
        {phase === 'done' && result && (
          <>
            <p>{VERDICT_TEXT[verdict]}</p>
            <ul className="muted">
              {result.tuningCents !== null && (
                <li>
                  Piano tuning: {result.tuningCents >= 0 ? '+' : ''}
                  {result.tuningCents.toFixed(0)} cents from A = 440 Hz
                </li>
              )}
              {result.latency !== null && (
                <li>Microphone delay: {Math.round(result.latency * 1000)} ms</li>
              )}
            </ul>
            <p className="muted">Saved for this microphone on this device.</p>
            <div className="row">
              <button className="primary" onClick={() => onClose(result)}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
