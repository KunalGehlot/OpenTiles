// Falling notes / Score / Page / Sheet switch for the practice screen, remembered on this device.
import { useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '../../storage/db';
import type { NotationSource } from './notation';
import { t } from '../../i18n';
import type { PracticeView } from './ScoreView';

const SETTING = 'practiceView';
const VIEWS: readonly PracticeView[] = ['falling', 'scroll', 'page', 'sheet'];

/**
 * The view to show for what the piece has: a score view needs notation (MIDI and audio have none),
 * the sheet view a PDF of the learner's (ADR 0018). Where the choice cannot be shown, the nearest
 * one that can: the sheet stands in for the score of a piece without notation, the page view for
 * the sheet of a piece without one.
 */
export function viewFor(
  chosen: PracticeView,
  notation: NotationSource,
  hasSheet: boolean,
): PracticeView {
  const score = notation.kind !== 'none';
  if (chosen === 'sheet') return hasSheet ? 'sheet' : score ? 'page' : 'falling';
  if (chosen === 'falling' || score) return chosen;
  return hasSheet ? 'sheet' : 'falling';
}

/** The chosen view, as far as this piece can show it (`viewFor`). */
export function usePracticeView(
  notation: NotationSource,
  hasSheet = false,
): [PracticeView, (view: PracticeView) => void] {
  const [view, setView] = useState<PracticeView>('falling');
  const chosen = useRef(false);
  useEffect(() => {
    let cancelled = false;
    getSetting<PracticeView>(SETTING, 'falling')
      .then((v) => !cancelled && !chosen.current && VIEWS.includes(v) && setView(v))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const choose = (v: PracticeView) => {
    chosen.current = true;
    setView(v);
    void setSetting(SETTING, v).catch(() => {});
  };
  return [viewFor(view, notation, hasSheet), choose];
}

export function ViewToggle({
  view,
  onChange,
  notation,
  hasSheet = false,
}: {
  view: PracticeView;
  onChange: (view: PracticeView) => void;
  notation: NotationSource;
  /** The piece has the learner's sheet music: offer the Sheet view. */
  hasSheet?: boolean;
}) {
  const noScore = notation.kind === 'none' ? notation.reason : null;
  const views: [PracticeView, string][] = [
    ['falling', t('Falling notes')],
    ['scroll', t('Score')],
    ['page', t('Page')],
  ];
  if (hasSheet) views.push(['sheet', t('Sheet')]);
  return (
    <>
      <div className="segmented" role="group" aria-label={t('View')}>
        {views.map(([v, label]) => {
          const unavailable = noScore !== null && (v === 'scroll' || v === 'page');
          return (
            <button
              key={v}
              aria-pressed={view === v}
              disabled={unavailable}
              title={unavailable ? (noScore ?? undefined) : undefined}
              onClick={() => onChange(v)}
            >
              {label}
            </button>
          );
        })}
      </div>
      {noScore && !hasSheet && <span className="muted ot-view-note">{noScore}</span>}
    </>
  );
}
