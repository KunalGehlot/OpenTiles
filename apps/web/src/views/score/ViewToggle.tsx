// Falling notes / Score / Page switch for the practice screen, remembered on this device.
import { useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '../../storage/db';
import type { NotationSource } from './notation';
import type { PracticeView } from './ScoreView';

const SETTING = 'practiceView';
const VIEWS: readonly PracticeView[] = ['falling', 'scroll', 'page'];

/** The chosen view; always 'falling' for pieces without notation (MIDI, audio). */
export function usePracticeView(
  notation: NotationSource,
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
  return [notation.kind === 'none' ? 'falling' : view, choose];
}

export function ViewToggle({
  view,
  onChange,
  notation,
}: {
  view: PracticeView;
  onChange: (view: PracticeView) => void;
  notation: NotationSource;
}) {
  const noScore = notation.kind === 'none' ? notation.reason : null;
  return (
    <>
      <div className="segmented" role="group" aria-label="View">
        {(
          [
            ['falling', 'Falling notes'],
            ['scroll', 'Score'],
            ['page', 'Page'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            aria-pressed={view === v}
            disabled={noScore !== null && v !== 'falling'}
            title={noScore !== null && v !== 'falling' ? noScore : undefined}
            onClick={() => onChange(v)}
          >
            {label}
          </button>
        ))}
      </div>
      {noScore && <span className="muted ot-view-note">{noScore}</span>}
    </>
  );
}
