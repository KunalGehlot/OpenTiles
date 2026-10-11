// Opens a sheet's PDF and mounts the controller that draws it, for the practice view and the
// reader alike. The document is opened once per mount and closed on leaving.
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Song } from '@opentiles/song-model';
import type { PracticeSession } from '../session';
import { openPdf } from './pdf';
import type { PdfDocument } from './pdf';
import { SheetController } from './sheet-controller';
import type { SheetPageInfo } from './sheet-controller';
import { t } from '../../i18n';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export interface OpenSheet {
  pdfjs: PdfJs;
  doc: PdfDocument;
  controller: SheetController;
}

export function useSheet(
  hostRef: RefObject<HTMLDivElement | null>,
  bytes: Uint8Array,
  session: PracticeSession | null,
  song: Song | null,
): {
  state: 'opening' | 'ready' | { error: string };
  open: OpenSheet | null;
  page: SheetPageInfo;
} {
  const [state, setState] = useState<'opening' | 'ready' | { error: string }>('opening');
  const [open, setOpen] = useState<OpenSheet | null>(null);
  const [page, setPage] = useState<SheetPageInfo>({ page: 1, pageCount: 1 });
  // The song and session only matter for following; a new song object must not reopen the PDF.
  const follow = useRef({ session, song });
  follow.current = { session, song };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let doc: PdfDocument | null = null;
    let controller: SheetController | null = null;
    let raf = 0;
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => controller?.resize(), 150);
    });
    setState('opening');
    setOpen(null);
    openPdf(bytes)
      .then(async (opened) => {
        if (cancelled) {
          void opened.doc.loadingTask.destroy();
          return;
        }
        doc = opened.doc;
        const c = await SheetController.create(
          host,
          opened.doc,
          follow.current.session,
          follow.current.song,
        );
        if (cancelled) {
          c.destroy();
          return;
        }
        controller = c;
        c.onPage = setPage;
        setPage({ page: 1, pageCount: c.pageCount });
        setOpen({ pdfjs: opened.pdfjs, doc: opened.doc, controller: c });
        setState('ready');
        ro.observe(host);
        const loop = () => {
          c.frame();
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => {
        if (!cancelled)
          setState({ error: t('The sheet music could not be opened on this device.') });
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      ro.disconnect();
      controller?.destroy();
      void doc?.loadingTask.destroy();
    };
  }, [hostRef, bytes]);

  return { state, open, page };
}
