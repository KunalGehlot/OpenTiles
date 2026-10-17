// A sheet-only piece (format 'pdf', ADR 0018): the learner's PDF without notes. It can be read
// (pages, page turns, zoom) but not practised until a MIDI or score file is added to it.
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { href } from '../../lib/router';
import { SheetPager } from './SheetPager';
import { useSheet } from './use-sheet';
import { pageTurn } from '../../settings/pedal';
import { appSettings } from '../../settings/store';
import { t } from '../../i18n';
import './sheet.css';

export function SheetReader({
  title,
  bytes,
  onNotesAdded,
  addNotes,
}: {
  title: string;
  bytes: Uint8Array;
  /** Loads the piece again once it has notes, so it opens for practice. */
  onNotesAdded: () => void;
  /**
   * The button that adds a MIDI or score file to this piece (P5-15's AddNotesButton), given by
   * the practice route; it calls `onSaved` once the notes are stored.
   */
  addNotes?: (onSaved: () => void) => ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { state, open, page } = useSheet(hostRef, bytes, null, null);
  const controller = open?.controller ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, select, textarea, button')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const delta = pageTurn(e, appSettings().pedal);
      if (delta === 0) return;
      e.preventDefault();
      controller?.turn(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller]);

  return (
    <>
      <header className="bar session-bar">
        <a className="back" href={href({ name: 'library' })}>
          <ChevronLeft />
          <span className="back__label">{t('My library')}</span>
        </a>
        <h1 className="session-title">
          <span className="session-title__name">{title}</span>
        </h1>
      </header>
      <div className="bar ot-sheet-reader-note">
        <p className="muted" role="note">
          {t('Add the MIDI file of this piece to practise it with falling notes and feedback.')}
        </p>
        {addNotes?.(onNotesAdded)}
      </div>
      <section className="ot-sheet-panel ot-sheet-panel--reader" aria-label={t('Your sheet music')}>
        {state === 'opening' && (
          <p className="ot-sheet-status muted" role="status">
            {t('Opening the sheet music…')}
          </p>
        )}
        {typeof state === 'object' && (
          <p className="ot-sheet-status error" role="status">
            {state.error}
          </p>
        )}
        <div ref={hostRef} className="ot-sheet-host" data-testid="sheet-host" />
        {state === 'ready' && <SheetPager controller={controller} page={page} />}
      </section>
    </>
  );
}
