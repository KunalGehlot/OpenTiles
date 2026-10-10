import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { CalendarCheck, Check, Clock, FilePlus, Link2, Medal, Play } from 'lucide-react';
import { difficultyLabel, loadCatalogue, siblingsOf, variantLabel } from '../catalogue/catalogue';
import type { CataloguePiece } from '../catalogue/catalogue';
import { matchesQuery } from '../catalogue/search';
import { catalogueKey, difficultyPath, MASTERY, nextPiece } from '../catalogue/path';
import { absoluteHref, href } from '../lib/router';
import { HomeScreenHint } from '../pwa/HomeScreenHint';
import { SearchBox } from '../ui/SearchBox';
import { db, localDay, streak } from '../storage/db';
import { t } from '../i18n';

export function Home() {
  const [pieces, setPieces] = useState<CataloguePiece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
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
  const searching = query.trim().length > 0;
  const found = searching
    ? shown
        .filter((p) => matchesQuery(p, query))
        .sort((a, b) => a.title.localeCompare(b.title) || a.difficulty - b.difficulty)
    : [];
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
          <h1>{t('Free piano practice')}</h1>
          <p className="lead">
            {t(
              'Pick a public-domain piece or bring your own MusicXML or MIDI file, then play it on a MIDI keyboard, an acoustic piano (microphone) or the on-screen keys. No account, no payment — your files never leave this device.',
            )}
          </p>
        </div>
        {next && (
          <a
            className="continue"
            href={href({ name: 'practice', source: 'catalogue', id: next.slug })}
          >
            <span className="continue__eyebrow">{started ? t('Continue') : t('Start here')}</span>
            <span className="continue__title">{next.title}</span>
            <span className="continue__meta">
              {next.composer}
              {nextLevel && <> · {t('Level {n}', { n: nextLevel.level })}</>}
            </span>
            <span className="continue__go">
              <Play /> {t('Practise')}
            </span>
          </a>
        )}
      </section>

      <HomeScreenHint />

      {(currentStreak > 0 || minutesToday > 0 || mastered > 0) && (
        <ul className="glance" aria-label={t('Your practice')}>
          {currentStreak > 0 && (
            <Glance icon={<CalendarCheck />} value={currentStreak} label={t('day streak')} />
          )}
          {minutesToday > 0 && (
            <Glance icon={<Clock />} value={minutesToday} label={t('min today')} />
          )}
          {mastered > 0 && (
            <Glance
              icon={<Medal />}
              value={mastered}
              label={mastered === 1 ? t('piece mastered') : t('pieces mastered')}
            />
          )}
        </ul>
      )}

      <section aria-labelledby="path-title">
        <h2 id="path-title">{t('Your path through the public-domain pieces')}</h2>
        <p className="muted">
          {t(
            'Start at first steps and work upwards. A level is complete when every piece in it reaches {percent} %.',
            { percent: Math.round(MASTERY * 100) },
          )}
        </p>
        <SearchBox
          value={query}
          onChange={setQuery}
          label={t('Search pieces')}
          placeholder={t('Search by title, composer or level')}
        />
        {error && <p className="error">{error}</p>}
        {searching && (
          <>
            <p className="muted" role="status">
              {found.length === 0
                ? t('No piece matches “{query}”.', { query: query.trim() })
                : found.length === 1
                  ? t('1 piece found')
                  : t('{n} pieces found', { n: found.length })}
            </p>
            <div className="grid">
              {found.map((p) => (
                <PieceCard
                  key={p.slug}
                  piece={p}
                  best={best.get(catalogueKey(p.slug))}
                  others={siblingsOf(p, shown)}
                />
              ))}
            </div>
          </>
        )}
        {pieces && shown.length === 0 && (
          <p className="notice">
            {t(
              'No reviewed pieces yet. Every catalogue piece is checked by a person before it appears here — you can help review pieces on GitHub.',
            )}
          </p>
        )}
        {!searching && (
          <ol className="path" aria-label={t('Difficulty path')}>
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
                    {t('Level {n}', { n: level.level })} · {difficultyLabel(level.level)}
                    {level.status === 'done' && (
                      <span className="visually-hidden"> ({t('complete')})</span>
                    )}
                  </h3>
                  <span className="path-count">
                    {t('{mastered} of {total} mastered · {played} played', {
                      mastered: level.mastered,
                      total: level.pieces.length,
                      played: level.played,
                    })}
                  </span>
                </div>
                <progress
                  className="path-progress"
                  max={1}
                  value={level.progress}
                  aria-label={t('Level {n} progress', { n: level.level })}
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
        )}
      </section>

      <section className="panel panel--row" aria-labelledby="own-title">
        <div>
          <h2 id="own-title">{t('Your own music')}</h2>
          <p className="muted">
            {t(
              'Import a MusicXML, MuseScore, ABC or MIDI file into your private library. It is converted and stored on this device only.',
            )}{' '}
            <a href={href({ name: 'sheet-music' })}>{t('Where to find free sheet music')}</a>
          </p>
        </div>
        <a className="button" href={href({ name: 'library' })}>
          <FilePlus /> {t('Open my library')}
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
            <span className="muted">{t('Not played yet')}</span>
          ) : (
            <span className={best >= MASTERY ? 'badge badge--ok' : 'badge'}>
              {best >= MASTERY && <Check />}
              {t('Best {percent} %', { percent: Math.round(best * 100) })}
            </span>
          )}
          {!piece.verified && <span className="badge badge--warn">{t('Awaiting review')}</span>}
        </span>
      </a>
      <CopyLink url={absoluteHref(route)} title={piece.title} />
      {/* Always present, so cards in a row keep one height. */}
      <ul
        className="piece__levels"
        aria-label={others.length > 0 ? t('Other levels of this song') : undefined}
      >
        {others.map((o) => (
          <li key={o.slug}>
            <a
              className="level-chip"
              href={href({ name: 'practice', source: 'catalogue', id: o.slug })}
              title={t('{title}, level {n}', { title: o.title, n: o.difficulty })}
            >
              <span className="level-chip__level" aria-hidden="true">
                {o.difficulty}
              </span>
              <span className="level-chip__name">
                {o.variant ? variantLabel(o.variant) : o.title}
              </span>
              <span className="visually-hidden"> ({t('level {n}', { n: o.difficulty })})</span>
            </a>
          </li>
        ))}
      </ul>
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
        aria-label={t('Copy link to {title}', { title })}
        title={url}
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Link2 />}
        <span className={copied ? 'copy-link__text' : 'visually-hidden'}>
          {copied ? t('Link copied') : t('Copy link')}
        </span>
      </button>
      {copied === false && (
        <input
          type="text"
          readOnly
          className="copy-link__fallback"
          value={url}
          aria-label={t('Link to {title}', { title })}
          onFocus={(e) => e.target.select()}
        />
      )}
    </>
  );
}
