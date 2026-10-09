// Metronome toggle and click volume for the practice bar (PLAN.md P1-13).
import { useState } from 'react';
import { Metronome } from 'lucide-react';
import { unlockAudio } from '../audio/context';
import { clickTrackFor } from '../audio/click-track';
import type { PracticeSession } from '../views/session';
import { savePracticePrefs } from './prefs';
import { t } from '../i18n';

/** Routes the session's clicks through the metronome's own volume. Call from a user gesture. */
export async function connectClickTrack(session: PracticeSession, volume?: number) {
  const track = clickTrackFor(await unlockAudio());
  if (volume !== undefined) track.volume = volume;
  session.setClickOutput((when, accent) => track.click(when, accent));
  return track;
}

export function MetronomeControl({
  session,
  on,
  volume: initialVolume = 0.5,
}: {
  session: PracticeSession;
  on: boolean;
  volume?: number;
}) {
  const [volume, setVolume] = useState(initialVolume);

  const toggle = async () => {
    // Audio may only start from a gesture (Safari); this click is one.
    await connectClickTrack(session, volume);
    session.setMetronome(!on);
    savePracticePrefs({ metronome: !on });
  };

  return (
    <span className="metronome-control">
      <button
        aria-pressed={on}
        title={
          on
            ? t('Metronome on: clicks on every beat, accented on the first beat of the bar')
            : t('Metronome off')
        }
        onClick={() => void toggle()}
      >
        <Metronome />
        <span className="btn-label">{t('Metronome')}</span>
      </button>
      {on && (
        <input
          type="range"
          className="metronome-volume"
          aria-label={t('Click volume')}
          title={t('Click volume')}
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            setVolume(v);
            savePracticePrefs({ clickVolume: v });
            void connectClickTrack(session, v);
          }}
        />
      )}
    </span>
  );
}
