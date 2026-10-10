// The score views (PLAN.md P1-15 scrolling score, P2-11 page view). React mounts the elements and
// shows loading, errors and page buttons; ScoreController does the drawing and per-frame work.
import { useEffect, useRef, useState } from 'react';
import type { Song } from '@opentiles/song-model';
import type { PracticeSession } from '../session';
import type { NotationSource } from './notation';
import { ScoreController } from './score-controller';
import type { PageInfo, ScoreLayout } from './score-controller';
import { createToolkit } from './verovio';
import { t } from '../../i18n';
import './score.css';

export type PracticeView = 'falling' | ScoreLayout;

interface Props {
  session: PracticeSession;
  /**
   * The piece as the score writes it, with the fingers to show. Note ids match the session's
   * song, whose pitches may have been moved to fit the learner's keyboard (P4-07).
   */
  song: Song;
  /** Ids of notes whose finger was suggested (P4-08). */
  suggested: ReadonlySet<string>;
  notation: Extract<NotationSource, { kind: 'musicxml' | 'abc' }>;
  layout: ScoreLayout;
  /** Playback measure indices to mark after a run (P1-24); empty while practising. */
  hardest: readonly number[];
}

/** Keys a Bluetooth page-turn pedal sends (P2-15), and the arrow keys. */
const NEXT_KEYS = new Set(['PageDown', 'ArrowRight', 'Space']);
const PREVIOUS_KEYS = new Set(['PageUp', 'ArrowLeft']);

export function ScoreView({ session, song, suggested, notation, layout, hardest }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ScoreController | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  const [page, setPage] = useState<PageInfo>({ page: 1, pageCount: 1 });
  const [unlinked, setUnlinked] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    const strip = stripRef.current;
    const cursor = cursorRef.current;
    if (!host || !strip || !cursor) return;
    let cancelled = false;
    let controller: ScoreController | null = null;
    let raf = 0;
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(
        () => controller?.resize(host.clientWidth, host.clientHeight),
        200,
      );
    });
    setState('loading');
    createToolkit(notation, {})
      .then((tk) => {
        if (cancelled) {
          tk.destroy();
          return;
        }
        controller = new ScoreController(tk, song, session, layout, host, strip, cursor, suggested);
        controllerRef.current = controller;
        controller.onPage = setPage;
        setPage({ page: controller.page, pageCount: controller.pageCount });
        setUnlinked(controller.links.unmatched.length);
        setState('ready');
        ro.observe(host);
        const loop = () => {
          controller?.frame(performance.now() / 1000);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          error: t(
            'The score could not be drawn on this device. The falling-notes view still works.',
          ),
        });
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      controller?.destroy();
      controllerRef.current = null;
    };
  }, [session, song, suggested, notation, layout]);

  const hardestKey = hardest.join(',');
  useEffect(() => {
    if (state !== 'ready') return;
    controllerRef.current?.setHardest(hardestKey ? hardestKey.split(',').map(Number) : []);
  }, [hardestKey, state]);

  // Page turns from the keyboard or a Bluetooth pedal, while no timed run is playing. Space is
  // left to the practice controls in listen and play-along mode.
  useEffect(() => {
    if (layout !== 'page') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, select, textarea')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || session.playing) return;
      const key = e.code === 'Space' ? 'Space' : e.key;
      // Space on a focused button presses it; elsewhere it is a pedal's "next page".
      if (key === 'Space' && (session.mode !== 'wait' || target?.closest('button'))) return;
      const delta = NEXT_KEYS.has(key) ? 1 : PREVIOUS_KEYS.has(key) ? -1 : 0;
      if (delta === 0) return;
      e.preventDefault();
      controllerRef.current?.turn(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout, session]);

  return (
    <section
      className={`ot-score-panel ${layout}`}
      aria-label={layout === 'page' ? t('Score, page view') : t('Score, scrolling')}
    >
      {state === 'loading' && <p className="ot-score-status muted">{t('Drawing the score…')}</p>}
      {typeof state === 'object' && <p className="ot-score-status error">{state.error}</p>}
      {state === 'ready' && unlinked > 0 && unlinked === song.notes.length && (
        <p className="ot-score-status muted">
          {t(
            'The score is shown, but its notes could not be matched to the music, so they are not coloured.',
          )}
        </p>
      )}
      <div ref={hostRef} className="ot-score-host" hidden={typeof state === 'object'}>
        <div className="ot-score-mover">
          <div ref={stripRef} className="ot-score-strip" data-testid="score-strip" />
          <div ref={cursorRef} className="ot-score-cursor" data-testid="score-cursor" hidden />
        </div>
      </div>
      {layout === 'page' && state === 'ready' && (
        <div className="ot-score-pager">
          <button
            disabled={page.page <= 1}
            onClick={() => controllerRef.current?.turn(-1)}
            aria-label={t('Previous page')}
          >
            ‹
          </button>
          <span aria-live="polite">
            {t('Page {n} of {count}', { n: page.page, count: page.pageCount })}
          </span>
          <button
            disabled={page.page >= page.pageCount}
            onClick={() => controllerRef.current?.turn(1)}
            aria-label={t('Next page')}
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
}
