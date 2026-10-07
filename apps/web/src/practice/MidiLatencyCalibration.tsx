// MIDI latency calibration (PLAN.md P1-19): the app plays 8 clicks, the learner presses any key on
// each one, and the median delay is stored for this keyboard and taken off play-along timing.
import { useEffect, useRef, useState } from 'react';
import { clickTrain, latencyFromAnswers } from '@opentiles/practice';
import { now, unlockAudio } from '../audio/context';
import { clickTrackFor } from '../audio/click-track';
import type { MidiKeyboardInput } from '../input/midi-input';
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
      const t = now();
      setBeat(clicks.filter((c) => c <= t).length - 1);
      if (t > (clicks[clicks.length - 1] ?? 0) + 0.6) {
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
    <div className="overlay calibration" role="dialog" aria-label="MIDI latency">
      <div className="panel stack">
        <h2 style={{ marginTop: 0 }}>Keyboard timing</h2>
        {phase.kind === 'intro' && (
          <>
            <p>
              The app plays {CLICKS} clicks. Press any key on your keyboard exactly on each click.
              This measures the delay between your keyboard and this device, so play-along can judge
              your timing fairly.
            </p>
            <div className="row">
              <button className="primary" onClick={() => void start()}>
                Start
              </button>
              <button onClick={() => onClose(null)}>Cancel</button>
            </div>
          </>
        )}
        {phase.kind === 'running' && (
          <>
            <p>Press any key on each click.</p>
            <p aria-hidden="true" className="click-dots">
              {phase.clicks.map((_, i) => (
                <span key={i} className={i <= beat ? 'on' : undefined}>
                  ●
                </span>
              ))}
            </p>
            <p className="muted" aria-live="polite">
              {heard} key presses
            </p>
          </>
        )}
        {phase.kind === 'result' && (
          <>
            {phase.latency === null ? (
              <p>
                Only {phase.matched} of {CLICKS} clicks were answered. Try again and press a key on
                each click.
              </p>
            ) : (
              <p>
                Your keyboard is about <strong>{Math.round(phase.latency * 1000)} ms</strong> behind
                the clicks ({phase.matched} of {CLICKS} clicks). Play-along will allow for this on
                this keyboard.
              </p>
            )}
            <div className="row">
              {phase.latency !== null && (
                <button className="primary" onClick={() => void save(phase.latency ?? 0)}>
                  Save
                </button>
              )}
              <button onClick={() => setPhase({ kind: 'intro' })}>Try again</button>
              <button onClick={() => onClose(null)}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
