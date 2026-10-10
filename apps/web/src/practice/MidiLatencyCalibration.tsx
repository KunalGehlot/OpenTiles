// MIDI latency calibration (PLAN.md P1-19): the app plays 8 clicks, the learner presses any key on
// each one, and the median delay is stored for this keyboard and taken off play-along timing.
import { useEffect, useRef, useState } from 'react';
import { clickTrain, latencyFromAnswers } from '@opentiles/practice';
import { now, unlockAudio } from '../audio/context';
import { clickTrackFor } from '../audio/click-track';
import type { MidiKeyboardInput } from '../input/midi-input';
import { t } from '../i18n';
import { setMidiCalibration } from '../storage/calibration';

const CLICKS = 8;
const INTERVAL = 0.75;
const LEAD = 1;

type Phase =
  | { kind: 'intro' }
  | { kind: 'running'; clicks: number[] }
  | { kind: 'result'; latency: number | null; matched: number };

export function MidiLatencyCalibration({
  input,
  device,
  onClose,
}: {
  input: MidiKeyboardInput;
  device: string;
  /** Called with the saved latency in seconds, or null when cancelled. */
  onClose: (latency: number | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [heard, setHeard] = useState(0);
  const [beat, setBeat] = useState(-1);
  const restore = useRef<(() => void) | null>(null);
  const timer = useRef(0);

  useEffect(
    () => () => {
      window.clearInterval(timer.current);
      restore.current?.();
    },
    [],
  );

  const start = async () => {
    const ctx = await unlockAudio();
    const track = clickTrackFor(ctx);
    const clicks = clickTrain(now() + LEAD, CLICKS, INTERVAL);
    clicks.forEach((t, i) => track.click(t, i % 4 === 0));
    const answers: number[] = [];
    const previous = input.onNote;
    // The keys answer the clicks; they must not also play the piece meanwhile.
    input.onNote = (e) => {
      answers.push(e.time);
      setHeard(answers.length);
    };
    restore.current = () => {
      input.onNote = previous;
      restore.current = null;
    };
    setHeard(0);
    setPhase({ kind: 'running', clicks });
    timer.current = window.setInterval(() => {
      const time = now();
      setBeat(clicks.filter((c) => c <= time).length - 1);
      if (time > (clicks[clicks.length - 1] ?? 0) + 0.6) {
        window.clearInterval(timer.current);
        restore.current?.();
        const r = latencyFromAnswers(clicks, answers);
        setPhase({ kind: 'result', latency: r.latency, matched: r.matched });
      }
    }, 50);
  };

  const save = async (latency: number) => {
    await setMidiCalibration(device, { latency, measuredAt: Date.now() });
    onClose(latency);
  };

  return (
    <div className="overlay calibration" role="dialog" aria-label={t('MIDI latency')}>
      <div className="panel stack">
        <h2 style={{ marginTop: 0 }}>{t('Keyboard timing')}</h2>
        {phase.kind === 'intro' && (
          <>
            <p>
              {t(
                'The app plays {n} clicks. Press any key on your keyboard exactly on each click. This measures the delay between your keyboard and this device, so play-along can judge your timing fairly.',
                { n: CLICKS },
              )}
            </p>
            <div className="row">
              <button className="primary" onClick={() => void start()}>
                {t('Start')}
              </button>
              <button onClick={() => onClose(null)}>{t('Cancel')}</button>
            </div>
          </>
        )}
        {phase.kind === 'running' && (
          <>
            <p>{t('Press any key on each click.')}</p>
            <p aria-hidden="true" className="click-dots">
              {phase.clicks.map((_, i) => (
                <span key={i} className={i <= beat ? 'on' : undefined}>
                  ●
                </span>
              ))}
            </p>
            <p className="muted" aria-live="polite">
              {t('{n} key presses', { n: heard })}
            </p>
          </>
        )}
        {phase.kind === 'result' && (
          <>
            {phase.latency === null ? (
              <p>
                {t(
                  'Only {matched} of {n} clicks were answered. Try again and press a key on each click.',
                  { matched: phase.matched, n: CLICKS },
                )}
              </p>
            ) : (
              <p>
                {t(
                  'Your keyboard is about {ms} ms behind the clicks ({matched} of {n} clicks). Play-along will allow for this on this keyboard.',
                  { ms: Math.round(phase.latency * 1000), matched: phase.matched, n: CLICKS },
                )}
              </p>
            )}
            <div className="row">
              {phase.latency !== null && (
                <button className="primary" onClick={() => void save(phase.latency ?? 0)}>
                  {t('Save')}
                </button>
              )}
              <button onClick={() => setPhase({ kind: 'intro' })}>{t('Try again')}</button>
              <button onClick={() => onClose(null)}>{t('Cancel')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
