// The "Sheet" view of the practice screen (ADR 0018): the learner's own PDF with the bar being
// played highlighted. The first time a sheet is shown its bars are found and matched to the song
// in the background (the pages show at once); the map is saved on the library item. "Adjust bars"
// lets the learner fix a map that is wrong.
import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { addBarline, barAt, barlineAt, removeBarline, shiftFrom } from '@opentiles/sheet';
import type { SheetMap } from '@opentiles/sheet';
import { measureIndexAt } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import type { SheetAttachment } from '../../storage/db';
import type { PracticeSession } from '../session';
import { analyseSheet } from './analyse';
import { ensureSheetMap } from './ensure-map';
import type { SheetPoint } from './sheet-controller';
import { SheetPager } from './SheetPager';
import { clearSheetMap, saveSheetMap } from './sheet-store';
import { useSheet } from './use-sheet';
import { t } from '../../i18n';
import './sheet.css';

/** Keys a Bluetooth page-turn pedal sends (P2-15), and the arrow keys. */
const NEXT_KEYS = new Set(['PageDown', 'ArrowRight', 'Space']);
const PREVIOUS_KEYS = new Set(['PageUp', 'ArrowLeft']);

interface Props {
  session: PracticeSession;
  /** The piece as imported: its measures are the session's measures. */
  song: Song;
  itemId: number;
  sheet: SheetAttachment;
}

type MapState = 'waiting' | 'finding' | 'ready' | 'none-found' | { error: string };

export function SheetView({ session, song, itemId, sheet }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { state, open, page } = useSheet(hostRef, sheet.bytes, session, song);
  const [map, setMap] = useState<SheetMap | null>(null);
  const [mapState, setMapState] = useState<MapState>('waiting');
  const [adjusting, setAdjusting] = useState(false);
  const [analysisMs, setAnalysisMs] = useState<number | null>(null);
  /** Where the learner tapped in a bar while adjusting: a barline can be added there. */
  const [mark, setMark] = useState<SheetPoint | null>(null);
  const [history, setHistory] = useState<SheetMap[]>([]);
  const controller = open?.controller ?? null;

  // The map: the stored one, matched again if the song changed, or found now.
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    const run = async () => {
      const { map: next, timing } = await ensureSheetMap(
        itemId,
        sheet,
        song,
        // This view's document stays open for drawing.
        () => Promise.resolve({ pdfjs: open.pdfjs, doc: open.doc, done: () => {} }),
        { signal: abort.signal, onFinding: () => setMapState('finding') },
      );
      if (timing) setAnalysisMs(Math.round(timing.total));
      if (abort.signal.aborted) return;
      setMap(next);
      setMapState(next.layout.bars.length > 0 ? 'ready' : 'none-found');
    };
    run().catch((e: unknown) => {
      if (abort.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setMapState({ error: t('The bars of this sheet could not be found.') });
    });
    return () => abort.abort();
  }, [open, itemId, sheet, song]);

  useEffect(() => {
    controller?.setMap(map);
  }, [controller, map]);

  /** Saves a corrected map and shows it; Undo goes back through the corrections of this visit. */
  const correct = (next: SheetMap) => {
    if (map) setHistory((h) => [...h, map]);
    setMap(next);
    setMark(null);
    void saveSheetMap(itemId, sheet, next);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((h) => h.slice(0, -1));
    setMap(previous);
    setMark(null);
    // The map from before is saved as corrected too: undoing is a correction of its own.
    void saveSheetMap(itemId, sheet, { ...previous, edited: true });
  };

  useEffect(() => {
    if (!controller) return;
    controller.setAdjusting(adjusting);
    controller.onAdjustTap = (point: SheetPoint) => {
      if (!map) return;
      // A tap on a barline (about a finger's width either side) removes it; anywhere else in a
      // bar goes there and marks the place for "Add a barline here".
      const tolerance = 14 / Math.max(0.1, controller.scaleNow);
      const before = barlineAt(map, point.page, point.x, point.y, tolerance);
      if (before >= 0) {
        correct(removeBarline(map, song, before));
        return;
      }
      const bar = barAt(map, point.page, point.x, point.y);
      if (bar < 0) return;
      controller.goToBar(bar);
      setMark(point);
    };
    // correct() only closes over values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller, adjusting, map, song]);

  useEffect(() => {
    controller?.setMark(adjusting ? mark : null);
  }, [controller, adjusting, mark]);

  const shift = (delta: number) => {
    if (!map) return;
    const measure = Math.max(0, measureIndexAt(song.measures, session.beat));
    correct(shiftFrom(map, measure, delta));
  };

  const addHere = () => {
    if (!map || !mark) return;
    const bar = barAt(map, mark.page, mark.x, mark.y);
    if (bar >= 0) correct(addBarline(map, song, bar, mark.x));
  };

  const findAgain = async () => {
    if (!open) return;
    setMapState('finding');
    await clearSheetMap(itemId, sheet);
    try {
      const result = await analyseSheet(open.pdfjs, open.doc, song);
      await saveSheetMap(itemId, sheet, result.map);
      if (map) setHistory((h) => [...h, map]);
      setMap(result.map);
      setMapState(result.map.layout.bars.length > 0 ? 'ready' : 'none-found');
    } catch {
      setMapState({ error: t('The bars of this sheet could not be found.') });
    }
  };

  // Page turns from the keyboard or a Bluetooth pedal, while no timed run is playing. Space is
  // left to the practice controls in listen and play-along mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, select, textarea')) return;
      if (e.metaKey || e.ctrlKey || e.altKey || session.playing) return;
      const key = e.code === 'Space' ? 'Space' : e.key;
      if (key === 'Space' && (session.mode !== 'wait' || target?.closest('button'))) return;
      const delta = NEXT_KEYS.has(key) ? 1 : PREVIOUS_KEYS.has(key) ? -1 : 0;
      if (delta === 0) return;
      e.preventDefault();
      controller?.turn(delta);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, session]);

  const status =
    typeof state === 'object'
      ? state.error
      : typeof mapState === 'object'
        ? mapState.error
        : state === 'opening'
          ? t('Opening the sheet music…')
          : mapState === 'finding'
            ? t('Finding the bars…')
            : mapState === 'none-found'
              ? t(
                  'No bars were found on this sheet, so the highlight cannot follow the music. The pages can still be read.',
                )
              : null;

  return (
    <section
      className={`ot-sheet-panel${adjusting ? ' ot-sheet-panel--adjusting' : ''}`}
      aria-label={t('Your sheet music')}
      data-map={mapState === 'ready' ? 'ready' : 'pending'}
      data-analysis-ms={analysisMs ?? undefined}
    >
      {status && (
        <p
          className={`ot-sheet-status${typeof state === 'object' || typeof mapState === 'object' ? ' error' : ' muted'}`}
          role="status"
        >
          {status}
        </p>
      )}
      <div ref={hostRef} className="ot-sheet-host" data-testid="sheet-host" />
      {adjusting && map && (
        <div className="ot-sheet-adjust" role="group" aria-label={t('Adjust bars')}>
          <p className="ot-sheet-adjust__hint muted">
            {t(
              'Tap a bar to go to it. Tap a wrong barline to remove it. For a missing barline, tap where it belongs, then Add a barline here.',
            )}
          </p>
          <div className="ot-sheet-adjust__row">
            <span className="ot-sheet-adjust__label">
              {t('From this bar on, the highlight is')}
            </span>
            <button onClick={() => shift(-1)}>{t('a bar ahead')}</button>
            <button onClick={() => shift(1)}>{t('a bar behind')}</button>
          </div>
          <div className="ot-sheet-adjust__row">
            <button disabled={!mark} onClick={addHere}>
              {t('Add a barline here')}
            </button>
            <button disabled={history.length === 0} onClick={undo}>
              {t('Undo')}
            </button>
            <button onClick={() => void findAgain()}>{t('Find the bars again')}</button>
            <button
              className="primary"
              onClick={() => {
                setAdjusting(false);
                setMark(null);
              }}
            >
              {t('Done')}
            </button>
          </div>
        </div>
      )}
      {state === 'ready' && (
        <SheetPager controller={controller} page={page}>
          {map && !adjusting && (
            <button onClick={() => setAdjusting(true)} title={t('Fix where the highlight goes')}>
              <SlidersHorizontal />
              <span className="btn-label">{t('Adjust bars')}</span>
            </button>
          )}
        </SheetPager>
      )}
    </section>
  );
}
