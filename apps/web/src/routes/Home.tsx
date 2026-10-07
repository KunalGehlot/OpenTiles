import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { DIFFICULTY_LABELS, loadCatalogue } from '../catalogue/catalogue';
import type { CataloguePiece } from '../catalogue/catalogue';
import { catalogueKey, difficultyPath, MASTERY, nextPiece } from '../catalogue/path';
import { absoluteHref, href } from '../lib/router';
import { HomeScreenHint } from '../pwa/HomeScreenHint';
import { db, localDay, streak } from '../storage/db';

export function Home() {
  const [pieces, setPieces] = useState<CataloguePiece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progress = useLiveQuery(() => db.progress.toArray(), []);
  const days = useLiveQuery(() => db.days.toArray(), []);

  useEffect(() => {
    loadCatalogue()
      .then(setPieces)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const best = new Map((progress ?? []).map((p) => [p.key, p.bestAccuracy]));
  const shown = (pieces ?? []).filter((p) => p.verified || __SHOW_UNVERIFIED__);
  const path = difficultyPath(shown, best);
  const next = nextPiece(path, best);
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

      <h2>Your path through the public-domain pieces</h2>
      <p className="muted">
        Start at first steps and work upwards. A level is complete when every piece in it reaches{' '}
        {Math.round(MASTERY * 100)} %.
        {next && (
          <>
            {' '}
            Next up:{' '}
            <a href={href({ name: 'practice', source: 'catalogue', id: next.slug })}>
              {next.title}
            </a>
            .
          </>
        )}
      </p>
      {error && <p className="error">{error}</p>}
      {pieces && shown.length === 0 && (
        <p className="muted">
          No reviewed pieces yet. Every catalogue piece is checked by a person before it appears
          here — you can help review pieces on GitHub.
        </p>
      )}
      <ol className="path" aria-label="Difficulty path">
        {path.map((level) => (
          <li
            key={level.level}
            className={`path-level path-level--${level.status}`}
            aria-labelledby={`level-${level.level}`}
          >
            <span className="path-step" aria-hidden="true">
              {level.status === 'done' ? '✓' : level.level}
            </span>
            <h3 id={`level-${level.level}`}>
              Level {level.level} · {DIFFICULTY_LABELS[level.level]}
              {level.status === 'done' && <span className="visually-hidden"> (complete)</span>}
            </h3>
            <div className="level-progress">
              <progress
                max={1}
                value={level.progress}
                aria-label={`Level ${level.level} progress`}
              />
              <span className="muted">
                {level.mastered} of {level.pieces.length} mastered · {level.played} played
              </span>
            </div>
            <div className="grid">
              {level.pieces.map((p) => (
                <PieceCard key={p.slug} piece={p} best={best.get(catalogueKey(p.slug))} />
              ))}
            </div>
          </li>
        ))}
      </ol>

      <h2>Your own music</h2>
      <p className="muted">
        Import a <code>.musicxml</code>, <code>.mxl</code> or <code>.mid</code> file into your{' '}
        <a href={href({ name: 'library' })}>private library</a>. It is converted and stored on this
        device only.
      </p>
    </>
  );
}

function PieceCard({ piece, best }: { piece: CataloguePiece; best: number | undefined }) {
  const route = { name: 'practice', source: 'catalogue', id: piece.slug } as const;
  return (
    <div className="card-wrap">
      <a className="card" href={href(route)}>
        <h3>{piece.title}</h3>
        <span className="muted">{piece.composer}</span>
        <span className="row">
          <span className="badge">Level {piece.difficulty}</span>
          {!piece.verified && <span className="badge badge--warn">Awaiting review</span>}
          {best !== undefined && <span className="badge">Best {Math.round(best * 100)} %</span>}
        </span>
      </a>
      <CopyLink url={absoluteHref(route)} title={piece.title} />
    </div>
  );
}

/**
 * Teacher links (P4-05): the stable public link to a catalogue piece, to give to a student. Only
 * catalogue pieces have one; library items are private and have no link (AGENTS.md hard rule 1).
 */
export function CopyLink({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard blocked: show the link so it can be copied by hand.
      setCopied(false);
    }
  };
  return (
    <>
      <button
        type="button"
        aria-label={`Copy link to ${title}`}
        title={url}
        onClick={() => void copy()}
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      {copied === false && (
        <input
          type="text"
          readOnly
          value={url}
          aria-label={`Link to ${title}`}
          onFocus={(e) => e.target.select()}
        />
      )}
    </>
  );
}
