// Sheet-music PDFs kept with a piece (ADR 0018). The PDF is only checked here, never parsed: the
// sheet view draws it with pdf.js, which loads only for a piece that has one.
import type { Song } from '@opentiles/song-model';
import type { SheetAttachment } from '../storage/db';
import { t } from '../i18n';

/**
 * Largest PDF the library keeps. Engraved PDFs from notation programs are 1–5 MB and scanned
 * pieces 20–50 MB; larger files are usually whole volumes, slow to draw on an iPad. The PDF is held
 * in memory while it is saved and backed up, so this sits between the score (30 MB) and recording
 * (200 MB) limits of ADR 0013, far below a backup entry's 512 MB.
 */
export const MAX_PDF_BYTES = 60_000_000;

/** A PDF the learner picked, checked and read but not yet saved. */
export interface SheetFile {
  fileName: string;
  bytes: Uint8Array;
}

/**
 * True when the bytes carry a PDF header. Readers accept it anywhere in the first 1024 bytes (some
 * tools write a few bytes first), so this does too.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 5 <= head.length; i++) {
    if (
      head[i] === 0x25 && // %
      head[i + 1] === 0x50 && // P
      head[i + 2] === 0x44 && // D
      head[i + 3] === 0x46 && // F
      head[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

/** Reads and checks a PDF the learner picked. Throws an Error whose message is for the screen. */
export async function readSheetFile(file: Blob & { name: string }): Promise<SheetFile> {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(
      t('This PDF is too large ({size} MB). The limit is {limit} MB.', {
        size: Math.round(file.size / 1e6),
        limit: Math.round(MAX_PDF_BYTES / 1e6),
      }),
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikePdf(bytes)) {
    throw new Error(
      t('“{name}” is not a PDF file, so it cannot be kept as sheet music.', { name: file.name }),
    );
  }
  return { fileName: file.name, bytes };
}

/** A fresh attachment for a picked PDF. It has no map: the sheet view analyses the PDF itself. */
export function sheetAttachment(file: SheetFile, addedAt = Date.now()): SheetAttachment {
  return { fileName: file.fileName, bytes: file.bytes, addedAt };
}

/** A piece's title from a file name: no folders or extension. */
export function titleFromFileName(fileName: string): string {
  return (
    fileName
      .replace(/^.*[\\/]/, '')
      .replace(/\.[^.]+$/, '')
      .trim() || t('Untitled')
  );
}

/**
 * The song of a sheet-only piece: a PDF with no notes yet (`format: 'pdf'`). It can be read but not
 * practised until a MIDI or score file is added to it.
 */
export function sheetOnlySong(title: string): Song {
  return {
    title,
    format: 'pdf',
    notes: [],
    measures: [],
    tempos: [{ beat: 0, bpm: 120 }],
    timeSignatures: [],
    keySignatures: [],
    parts: [{ name: 'Piano' }],
    lengthBeats: 0,
    warnings: [],
  };
}

/** True for a piece that is only a PDF, with no notes to practise yet. */
export function isSheetOnly(item: { format: string }): boolean {
  return item.format === 'pdf';
}
