// A piece between reading its files and saving it: what the import review screen shows and edits.
import type { Song } from '@opentiles/song-model';
import { applySettings, DEFAULT_SETTINGS } from '../lib/import-settings';
import type { ImportSettings } from '../storage/db';
import { t } from '../i18n';
import { sheetOnlySong, titleFromFileName } from './sheet';
import type { SheetFile } from './sheet';
import type { PieceNotes } from './store';

export interface Pending {
  fileName: string;
  bytes: Uint8Array;
  base: Song;
  title: string;
  settings: ImportSettings;
  /** Transcribed from a recording (P4-02): the notes are a best guess. */
  approximate: boolean;
  /** The sheet-music PDF to keep with the piece (ADR 0018). */
  sheet?: SheetFile;
  /** Words to find the piece by in the library (P1-07). */
  tags?: string[];
}

/** Largest score file and recording the library accepts, so a huge file cannot hang the tab. */
export const MAX_SCORE_BYTES = 30_000_000;
export const MAX_AUDIO_BYTES = 200_000_000;

/** Throws the screen's message when a file is over the limit. */
export function checkSize(file: { size: number }, limit: number): void {
  if (file.size > limit) {
    throw new Error(
      t('This file is too large ({size} MB). The limit is {limit} MB.', {
        size: Math.round(file.size / 1e6),
        limit: Math.round(limit / 1e6),
      }),
    );
  }
}

/** Reads a score file (MusicXML, MuseScore, ABC or MIDI) for the review screen. */
export async function readScoreFile(file: Blob & { name: string }): Promise<Pending> {
  checkSize(file, MAX_SCORE_BYTES);
  const bytes = new Uint8Array(await file.arrayBuffer());
  // The importers (and the MuseScore reader inside them) load only when a file is imported.
  const { importAnyScore } = await import('@opentiles/importers');
  const base = await importAnyScore(file.name, bytes);
  return {
    fileName: file.name,
    bytes,
    base,
    title: base.title,
    settings: { ...DEFAULT_SETTINGS },
    approximate: false,
  };
}

/**
 * A PDF on its own: a sheet-only piece with an empty song, named after the file. Its `fileName` is
 * the PDF's, so a search by file name finds it; it has no file of notes yet.
 */
export function sheetOnlyPending(sheet: SheetFile): Pending {
  const title = titleFromFileName(sheet.fileName);
  return {
    fileName: sheet.fileName,
    bytes: new Uint8Array(0),
    base: sheetOnlySong(title),
    title,
    settings: { ...DEFAULT_SETTINGS },
    approximate: false,
    sheet,
  };
}

/** The piece's notes as saved: the review screen's settings applied and the title trimmed. */
export function pieceNotes(pending: Pending): PieceNotes {
  const song = {
    ...applySettings(pending.base, pending.settings),
    title: pending.title.trim() || t('Untitled'),
  };
  return {
    title: song.title.slice(0, 200),
    fileName: pending.fileName,
    format: song.format,
    bytes: pending.bytes,
    song,
    settings: pending.settings,
  };
}

/** What to tell the learner when IndexedDB refuses to save a piece. */
export function saveErrorMessage(e: unknown): string {
  // Most often the browser's storage is full, or blocked in a private window.
  const full = e instanceof DOMException && e.name === 'QuotaExceededError';
  return full
    ? t(
        'There is not enough storage left on this device to save this piece. Delete a piece you no longer need and try again.',
      )
    : t(
        'This piece could not be saved. Your browser may be blocking storage (a private window, for example).',
      );
}
