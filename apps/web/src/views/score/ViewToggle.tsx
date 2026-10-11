// Falling notes / Score / Sheet switch for the practice screen, remembered on this device.
import { useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '../../storage/db';
import type { NotationSource } from './notation';
import { t } from '../../i18n';
import type { PracticeView } from './ScoreView';

/**
 * A tab, and what is remembered. The learner picks "Sheet" once and each piece decides what that
 * shows (`viewFor`): their PDF where there is one, otherwise the engraved pages. So 'page' is a
 * view the Sheet tab leads to, not a choice of its own (P5-17).
 */
export type ViewChoice = 'falling' | 'scroll' | 'sheet';

const SETTING = 'practiceView';
const CHOICES: readonly ViewChoice[] = ['falling', 'scroll', 'sheet'];

/**
 * A remembered choice as a tab. 'page' was the engraved pages' own tab before they became the
 * Sheet tab (P5-17); it is read as 'sheet' rather than rewritten once, so a backup restored later
 * still lands on the sheet. Anything else unknown is no choice.
 */
export function readChoice(stored: unknown): ViewChoice | null {
  if (stored === 'page') return 'sheet';
  return CHOICES.find((c) => c === stored) ?? null;
}

/**
 * The view to show for what the piece has: a score view needs notation (a recording has none),
 * the PDF view a sheet of the learner's (ADR 0018). The Sheet tab shows the learner's PDF, or the
 * engraved pages of a piece without one. Where the choice cannot be shown, the nearest one that
 * can: the PDF stands in for the scrolling score of a piece without notation.
 */
export function viewFor(
  chosen: ViewChoice,
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
): [PracticeView, (choice: ViewChoice) => void] {
  const [choice, setChoice] = useState<ViewChoice>('falling');
  const chosen = useRef(false);
  useEffect(() => {
    let cancelled = false;
    getSetting<unknown>(SETTING, null)
      .then((v) => {
        const stored = readChoice(v);
        if (!cancelled && !chosen.current && stored) setChoice(stored);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const choose = (c: ViewChoice) => {
    chosen.current = true;
    setChoice(c);
    void setSetting(SETTING, c).catch(() => {});
  };
  return [viewFor(choice, notation, hasSheet), choose];
}

export function ViewToggle({
  view,
  onChange,
  notation,
  hasSheet = false,
}: {
  view: PracticeView;
  onChange: (choice: ViewChoice) => void;
  notation: NotationSource;
  /** The piece has the learner's sheet music: the Sheet tab shows it. */
  hasSheet?: boolean;
}) {
  const noScore = notation.kind === 'none' ? notation.reason : null;
  const tab: ViewChoice = view === 'page' ? 'sheet' : view;
  const views: [ViewChoice, string][] = [
    ['falling', t('Falling notes')],
    ['scroll', t('Score')],
    ['sheet', t('Sheet')],
  ];
  return (
    <>
      <div className="segmented" role="group" aria-label={t('View')}>
        {views.map(([v, label]) => {
          const unavailable = noScore !== null && (v === 'scroll' || (v === 'sheet' && !hasSheet));
          return (
            <button
              key={v}
              aria-pressed={tab === v}
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
