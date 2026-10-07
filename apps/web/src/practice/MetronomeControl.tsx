// Metronome toggle and click volume for the practice bar (PLAN.md P1-13).
import { useState } from 'react';
import { unlockAudio } from '../audio/context';
import { clickTrackFor } from '../audio/click-track';
import type { PracticeSession } from '../views/session';

/** Routes the session's clicks through the metronome's own volume. Call from a user gesture. */
export async function connectClickTrack(session: PracticeSession, volume?: number) {
  const track = clickTrackFor(await unlockAudio());
  if (volume !== undefined) track.volume = volume;
  session.setClickOutput((when, accent) => track.click(when, accent));
  return track;
}

export function MetronomeControl({ session, on }: { session: PracticeSession; on: boolean }) {
  const [volume, setVolume] = useState(0.5);

  const toggle = async () => {
    // Audio may only start from a gesture (Safari); this click is one.
    await connectClickTrack(session, volume);
    session.setMetronome(!on);
  };

  return (
    <span className="metronome-control row">
      <button
        aria-pressed={on}
        title={
          on
            ? 'Metronome on: clicks on every beat, accented on the first beat of the bar'
            : 'Metronome off'
        }
        onClick={() => void toggle()}
      >
        Metronome
      </button>
      {on && (
        <input
          type="range"
          className="metronome-volume"
          aria-label="Click volume"
          title="Click volume"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setVolume(v);
            void connectClickTrack(session, v);
          }}
        />
      )}
    </span>
  );
}
