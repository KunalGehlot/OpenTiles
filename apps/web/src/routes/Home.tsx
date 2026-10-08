import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { CalendarCheck, Check, Clock, FilePlus, Link2, Medal, Play } from 'lucide-react';
import { DIFFICULTY_LABELS, loadCatalogue, siblingsOf } from '../catalogue/catalogue';
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
  const nextLevel = next ? path.find((l) => l.pieces.includes(next)) : undefined;
  const started = path.some((l) => l.played > 0);
  const today = (days ?? []).find((d) => d.day === localDay());
  const currentStreak = streak(days ?? []);
  const minutesToday = today ? Math.round(today.seconds / 60) : 0;
  const mastered = path.reduce((sum, l) => sum + l.mastered, 0);

  return (
    <>
      <section className="hero">
        <div className="hero__intro">
          <h1>Free piano practice</h1>
          <p className="lead">
            Pick a public-domain piece or bring your own MusicXML or MIDI file, then play it on a
            MIDI keyboard, an acoustic piano (microphone) or the on-screen keys. No account, no
            payment — your files never leave this device.
          </p>
        </div>
        {next && (
          <a
            className="continue"
            href={href({ name: 'practice', source: 'catalogue', id: next.slug })}
          >
            <span className="continue__eyebrow">{started ? 'Continue' : 'Start here'}</span>
            <span className="continue__title">{next.title}</span>
            <span className="continue__meta">
              {next.composer}
              {nextLevel && <> · Level {nextLevel.level}</>}
            </span>
            <span className="continue__go">
              <Play /> Practise
            </span>
          </a>
        )}
      </section>

      <HomeScreenHint />

      {(currentStreak > 0 || minutesToday > 0 || mastered > 0) && (
        <ul className="glance" aria-label="Your practice">
          {currentStreak > 0 && (
            <Glance icon={<CalendarCheck />} value={currentStreak} label="day streak" />
          )}
          {minutesToday > 0 && <Glance icon={<Clock />} value={minutesToday} label="min today" />}
          {mastered > 0 && (
            <Glance
              icon={<Medal />}
              value={mastered}
              label={mastered === 1 ? 'piece mastered' : 'pieces mastered'}
            />
          )}
        </ul>
      )}

      <section aria-labelledby="path-title">
        <h2 id="path-title">Your path through the public-domain pieces</h2>
        <p className="muted">
          Start at first steps and work upwards. A level is complete when every piece in it reaches{' '}
          {Math.round(MASTERY * 100)} %.
        </p>
        {error && <p className="error">{error}</p>}
        {pieces && shown.length === 0 && (
          <p className="notice">
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
                {level.status === 'done' ? <Check /> : level.level}
              </span>
              <div className="path-head">
                <h3 id={`level-${level.level}`}>
                  Level {level.level} · {DIFFICULTY_LABELS[level.level]}
                  {level.status === 'done' && <span className="visually-hidden"> (complete)</span>}
                </h3>
                <span className="path-count">
                  {level.mastered} of {level.pieces.length} mastered · {level.played} played
                </span>
              </div>
              <progress
                className="path-progress"
                max={1}
                value={level.progress}
                aria-label={`Level ${level.level} progress`}
              />
              <div className="grid">
                {level.pieces.map((p) => (
                  <PieceCard
                    key={p.slug}
                    piece={p}
                    best={best.get(catalogueKey(p.slug))}
                    others={siblingsOf(p, shown)}
                  />
                ))}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="panel panel--row" aria-labelledby="own-title">
        <div>
          <h2 id="own-title">Your own music</h2>
          <p className="muted">
            Import a <code>.musicxml</code>, <code>.mxl</code> or <code>.mid</code> file into your{' '}
            <a href={href({ name: 'library' })}>private library</a>. It is converted and stored on
            this device only.
          </p>
        </div>
        <a className="button" href={href({ name: 'library' })}>
          <FilePlus /> Open my library
        </a>
      </section>
    </>
  );
}

function Glance({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <li>
      {icon}
      <span className="glance__value">{value}</span>
      <span className="glance__label">{label}</span>
    </li>
  );
}

function PieceCard({
  piece,
  best,
  others,
}: {
  piece: CataloguePiece;
  best: number | undefined;
  others: CataloguePiece[];
}) {
  const route = { name: 'practice', source: 'catalogue', id: piece.slug } as const;
  return (
    <div className="piece">
      <a className="card piece__card" href={href(route)}>
        <h3>{piece.title}</h3>
        <span className="piece__composer muted">{piece.composer}</span>
        <span className="piece__foot">
          {best === undefined ? (
            <span className="muted">Not played yet</span>
          ) : (
            <span className={best >= MASTERY ? 'badge badge--ok' : 'badge'}>
              {best >= MASTERY && <Check />}
              Best {Math.round(best * 100)} %
            </span>
          )}
          {!piece.verified && <span className="badge badge--warn">Awaiting review</span>}
        </span>
      </a>
      <CopyLink url={absoluteHref(route)} title={piece.title} />
      {/* Always present, so cards in a row keep one height. */}
      <p className="piece__levels">
        {others.length > 0 && <span className="muted">Also:</span>}
        {others.map((o) => (
          <a
            key={o.slug}
            href={href({ name: 'practice', source: 'catalogue', id: o.slug })}
            title={`${o.title}, level ${o.difficulty}`}
          >
            {o.variant ?? o.title}
          </a>
        ))}
      </p>
    </div>
  );
}

/**
 * Teacher links (P4-05): the stable public link to a catalogue piece, to give to a student. Only
 * catalogue pieces have one; library items are private and have no link (docs/development.md hard rule 1).
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
        className={copied ? 'copy-link copy-link--done quiet' : 'copy-link quiet'}
        aria-label={`Copy link to ${title}`}
        title={url}
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Link2 />}
        <span className={copied ? 'copy-link__text' : 'visually-hidden'}>
          {copied ? 'Link copied' : 'Copy link'}
        </span>
      </button>
      {copied === false && (
        <input
          type="text"
          readOnly
          className="copy-link__fallback"
          value={url}
          aria-label={`Link to ${title}`}
          onFocus={(e) => e.target.select()}
        />
      )}
    </>
  );
}
