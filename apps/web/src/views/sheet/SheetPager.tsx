// Page and zoom controls under the sheet, shared by the practice view and the reader.
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import type { SheetController, SheetPageInfo } from './sheet-controller';
import { MAX_ZOOM, MIN_ZOOM } from './sheet-controller';
import { t } from '../../i18n';
import { useState } from 'react';

const STEP = 1.25;

export function SheetPager({
  controller,
  page,
  children,
}: {
  controller: SheetController | null;
  page: SheetPageInfo;
  /** More controls at the end of the row (Adjust bars). */
  children?: ReactNode;
}) {
  // Only to enable and disable the buttons; the controller keeps the zoom itself.
  const [zoom, setZoom] = useState(1);
  const zoomTo = (z: number) => {
    controller?.setZoom(z);
    setZoom(controller?.zoomLevel ?? z);
  };
  return (
    <div className="ot-sheet-pager">
      <div className="ot-sheet-pager__group">
        <button
          disabled={!controller || page.page <= 1}
          onClick={() => controller?.turn(-1)}
          aria-label={t('Previous page')}
        >
          <ChevronLeft />
        </button>
        <span aria-live="polite" data-testid="sheet-page">
          {t('Page {n} of {count}', { n: page.page, count: page.pageCount })}
        </span>
        <button
          disabled={!controller || page.page >= page.pageCount}
          onClick={() => controller?.turn(1)}
          aria-label={t('Next page')}
        >
          <ChevronRight />
        </button>
      </div>
      <div className="ot-sheet-pager__group">
        <button
          disabled={!controller || zoom <= MIN_ZOOM + 1e-3}
          onClick={() => zoomTo(zoom / STEP)}
          aria-label={t('Zoom out')}
        >
          <ZoomOut />
        </button>
        <button
          disabled={!controller || Math.abs(zoom - 1) < 1e-3}
          onClick={() => zoomTo(1)}
          title={t('Fit the page to the width')}
        >
          {Math.round(zoom * 100)} %
        </button>
        <button
          disabled={!controller || zoom >= MAX_ZOOM - 1e-3}
          onClick={() => zoomTo(zoom * STEP)}
          aria-label={t('Zoom in')}
        >
          <ZoomIn />
        </button>
      </div>
      {children}
    </div>
  );
}
