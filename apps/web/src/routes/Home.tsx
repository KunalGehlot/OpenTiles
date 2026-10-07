import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { DIFFICULTY_LABELS, loadCatalogue } from '../catalogue/catalogue';
import type { CataloguePiece } from '../catalogue/catalogue';
import { href } from '../lib/router';
import { HomeScreenHint } from '../pwa/HomeScreenHint';
import { db, localDay, streak } from '../storage/db';

export function Home() {
  const [pieces, setPieces] = useState<CataloguePiece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const progress = useLiveQuery(() => db.progress.toArray(), []);
  const days = useLiveQuery(() => db.days.toArray(), []);

  useEffect(() => {
    loadCatalogue()
      .then(setPieces)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const best = new Map((progress ?? []).map((p) => [p.key, p.bestAccuracy]));
  const shown = (pieces ?? []).filter(
    (p) => (p.verified || __SHOW_UNVERIFIED__) && (level === null || p.difficulty === level),
  );
  const today = (days ?? []).find((d) => d.day === localDay());
  const currentStreak = streak(days ?? []);

  return (
    <>
      <h1>Free piano practice</h1>
      <p className="lead">
        Pick a public-domain piece or bring your own MusicXML or MIDI file, then play it on a MIDI
        keyboard, an acoustic piano (microphone) or the on-screen keys. No account, no payment —
        your files never leave this device.
      </p>
      <HomeScreenHint />
      {(currentStreak > 0 || today) && (
        <p className="muted">
          {currentStreak > 0 && <>🔥 {currentStreak}-day streak. </>}
          {today && <>Practised {Math.round(today.seconds / 60)} min today.</>}
        </p>
      )}

      <h2>Public-domain pieces</h2>
      <div className="chips" role="group" aria-label="Filter by difficulty">
        <button aria-pressed={level === null} onClick={() => setLevel(null)}>
          All levels
        </button>
        {[1, 2, 3, 4, 5].map((l) => (
          <button key={l} aria-pressed={level === l} onClick={() => setLevel(l)}>
            {l} · {DIFFICULTY_LABELS[l]}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {pieces && shown.length === 0 && (
        <p className="muted">
          No reviewed pieces at this level yet. Every catalogue piece is checked by a person before
          it appears here — you can help review pieces on GitHub.
        </p>
      )}
      <div className="grid">
        {shown.map((p) => {
          const acc = best.get(`catalogue:${p.slug}`);
          return (
            <a
              key={p.slug}
              className="card"
              href={href({ name: 'practice', source: 'catalogue', id: p.slug })}
            >
              <h3>{p.title}</h3>
              <span className="muted">{p.composer}</span>
              <span className="row">
                <span className="badge">Level {p.difficulty}</span>
                {!p.verified && <span className="badge badge--warn">Awaiting review</span>}
                {acc !== undefined && <span className="badge">Best {Math.round(acc * 100)} %</span>}
              </span>
            </a>
          );
        })}
      </div>

      <h2>Your own music</h2>
      <p className="muted">
        Import a <code>.musicxml</code>, <code>.mxl</code> or <code>.mid</code> file into your{' '}
        <a href={href({ name: 'library' })}>private library</a>. It is converted and stored on this
        device only.
      </p>
    </>
  );
}
