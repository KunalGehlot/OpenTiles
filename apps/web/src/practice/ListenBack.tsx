// "Listen to your performance" (P4-09): after a run, play it back as played or polished through
// the app's piano, and for catalogue pieces save it as a WAV file. Everything happens on the device.
import { useEffect, useRef, useState } from 'react';
import { now, unlockAudio } from '../audio/context';
import { fileSafe, playNotes, renderWav, saveFile } from '../audio/performance-audio';
import type { Playback } from '../audio/performance-audio';
import { synthFor } from '../audio/synth';
import { t } from '../i18n';
import type { PracticeSession } from '../views/session';

type Version = 'played' | 'polished';

interface Props {
  session: PracticeSession;
  title: string;
  /**
   * Offer a WAV file. Only for public-domain catalogue pieces: a file of a library piece would be
   * a copy of the user's music outside the app (docs/adr/0010-performance-playback.md).
   */
  allowSave: boolean;
}

export function ListenBack({ session, title, allowSave }: Props) {
  const [version, setVersion] = useState<Version>('polished');
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playback = useRef<Playback | null>(null);

  useEffect(() => () => playback.current?.stop(), []);

  const notes = (v: Version) => {
    const r = session.renderings();
    return r ? (v === 'played' ? r.asPlayed : r.polished) : [];
  };

  const listen = async () => {
    setError(null);
    if (playback.current) {
      playback.current.stop();
      return;
    }
    try {
      const ctx = await unlockAudio();
      const p = playNotes(synthFor(ctx), notes(version), now);
      playback.current = p;
      setPlaying(true);
      await p.ended;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      playback.current = null;
      setPlaying(false);
    }
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const blob = await renderWav(notes(version));
      const suffix = version === 'played' ? t('as played') : t('polished');
      saveFile(blob, `${fileSafe(title)} (${suffix}).wav`);
    } catch (e) {
      setError(
        e instanceof Error
          ? t('Could not make the file: {message}', { message: e.message })
          : t('Could not make the file.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack listen-back" role="group" aria-label={t('Listen to your performance')}>
      <div className="row">
        <span>{t('Listen to your performance:')}</span>
        <div className="segmented" role="group" aria-label={t('Version')}>
          {(
            [
              ['played', t('As played')],
              ['polished', t('Polished')],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              aria-pressed={version === v}
              disabled={playing}
              onClick={() => setVersion(v)}
              title={
                v === 'played'
                  ? t('Exactly what you played, wrong notes and all')
                  : t('Your notes and dynamics, exactly in time and held for their full length')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <button onClick={() => void listen()}>{playing ? t('Stop') : t('Listen')}</button>
        {allowSave && (
          <button disabled={saving} onClick={() => void save()}>
            {saving ? t('Making the file…') : t('Save as WAV')}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
