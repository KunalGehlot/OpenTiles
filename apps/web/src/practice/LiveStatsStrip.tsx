// The live stats strip (P5-07), off unless the learner turns it on in Options: perfect, good,
// missed and wrong notes of this run, and the streak of right notes. Listen mode judges nothing,
// and wait mode misses nothing, so those counts are left out there.
import type { LiveStats } from '@opentiles/practice';
import type { PracticeMode } from '../views/session';
import { t } from '../i18n';

export function LiveStatsStrip({ stats, mode }: { stats: LiveStats; mode: PracticeMode }) {
  if (mode === 'listen') return null;
  return (
    <span className="live-stats" role="group" aria-label={t('Live stats')} data-testid="live-stats">
      <span className="live-stats__item live-stats__item--perfect">
        <b>{stats.perfect}</b> {t('perfect')}
      </span>
      <span className="live-stats__item live-stats__item--good">
        <b>{stats.good}</b> {t('good')}
      </span>
      {mode === 'play-along' && (
        <span className="live-stats__item live-stats__item--missed">
          <b>{stats.missed}</b> {t('missed')}
        </span>
      )}
      <span className="live-stats__item live-stats__item--wrong">
        <b>{stats.wrong}</b> {t('wrong')}
      </span>
      <span className="live-stats__item live-stats__item--streak">
        {t('streak')} <b>{stats.streak}</b>
        {stats.bestStreak > stats.streak && (
          <span className="muted"> · {t('best {n}', { n: stats.bestStreak })}</span>
        )}
      </span>
    </span>
  );
}
