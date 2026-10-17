// A sheet's map, wherever the practice screen needs it (ADR 0018, P5-18): the Sheet view for the
// highlight, and the Score tab for how the PDF writes the notes, even when the Sheet view is never
// opened. The stored map is used when it is current, matched again when the song changed, and
// found afresh otherwise; a finding in progress is shared, so the PDF is read once.
import { alignSong, needsAnalysis } from '@opentiles/sheet';
import type { SheetMap } from '@opentiles/sheet';
import type { Song } from '@opentiles/song-model';
import { db } from '../../storage/db';
import type { SheetAttachment } from '../../storage/db';
import { analyseSheet } from './analyse';
import type { AnalysisTiming } from './analyse';
import type { PdfDocument } from './pdf';
import { saveSheetMap } from './sheet-store';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

/** An open sheet for the analysis, and what to do with it afterwards. */
export interface OpenSheet {
  pdfjs: PdfJs;
  doc: PdfDocument;
  /** Called once the analysis is done with the document (a copy opened for it is closed). */
  done(): void;
}

interface Finding {
  promise: Promise<{ map: SheetMap; timing: AnalysisTiming }>;
  abort: AbortController;
  users: number;
}

const findings = new Map<string, Finding>();

const abortError = () => new DOMException('Stopped', 'AbortError');

/**
 * Waits for a shared finding; this caller stopping lets it go, the last one stopping ends it (and
 * a caller coming after that starts a new one).
 */
function join(
  key: string,
  finding: Finding,
  signal: AbortSignal | undefined,
): Promise<{ map: SheetMap; timing: AnalysisTiming }> {
  finding.users += 1;
  if (!signal) return finding.promise;
  return new Promise((resolve, reject) => {
    const leave = () => {
      finding.users -= 1;
      if (finding.users === 0) {
        finding.abort.abort();
        if (findings.get(key) === finding) findings.delete(key);
      }
      reject(abortError());
    };
    if (signal.aborted) {
      leave();
      return;
    }
    signal.addEventListener('abort', leave, { once: true });
    finding.promise.then(
      (r) => {
        signal.removeEventListener('abort', leave);
        resolve(r);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', leave);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * The map of a library item's sheet for this song, saved on the item when it had to be matched
 * again or found. `onFinding` is called when the sheet has to be read, which takes a moment a
 * page; `timing` is set then.
 */
export async function ensureSheetMap(
  itemId: number,
  sheet: SheetAttachment,
  song: Pick<Song, 'measures' | 'notes'>,
  open: () => Promise<OpenSheet>,
  options: { signal?: AbortSignal; onFinding?: () => void } = {},
): Promise<{ map: SheetMap; timing: AnalysisTiming | null }> {
  // The item may hold a newer map than the one the screen was opened with.
  const stored = (await db.library.get(itemId))?.sheet;
  const current = stored && stored.addedAt === sheet.addedAt ? stored : sheet;
  const need = needsAnalysis(current.map, song.measures.length);
  if (need === 'none' && current.map) return { map: current.map, timing: null };
  if (need === 'align' && current.map) {
    // The hints name the old song's notes, so they go with it.
    const { score: _stale, ...kept } = current.map;
    const map = { ...kept, barOfMeasure: alignSong(current.map.layout, song).barOfMeasure };
    await saveSheetMap(itemId, sheet, map);
    return { map, timing: null };
  }
  options.onFinding?.();
  const key = `${itemId}:${sheet.addedAt}:${song.measures.length}:${song.notes.length}`;
  let finding = findings.get(key);
  if (!finding) {
    const abort = new AbortController();
    const promise = (async () => {
      const opened = await open();
      try {
        const result = await analyseSheet(opened.pdfjs, opened.doc, song, abort.signal);
        await saveSheetMap(itemId, sheet, result.map);
        return result;
      } finally {
        opened.done();
      }
    })();
    const started: Finding = { promise, abort, users: 0 };
    findings.set(key, started);
    // Forgotten once settled: a later visit reads the stored map instead.
    const forget = () => {
      if (findings.get(key) === started) findings.delete(key);
    };
    void promise.then(forget, forget);
    finding = started;
  }
  return join(key, finding, options.signal);
}
