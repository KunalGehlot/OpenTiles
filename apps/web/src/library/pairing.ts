// Which of the files picked or dropped together make one piece (ADR 0018 §2). Score-sharing sites
// name a piece's PDF and MIDI file alike (`… - Title.pdf`, `… - Title.mid`), so a score file and a
// PDF with the same base name become one piece with its sheet music. Pure: tested in Node.
import { isAudioFile } from '../lib/audio-import';

/**
 * `sheet`: a PDF, kept and drawn but never read for notes. `recording`: transcribed, approximate
 * notes, never paired with a sheet. `score`: everything else; the importer decides by content and
 * says what it cannot read.
 */
export type FileRole = 'sheet' | 'score' | 'recording';

export function fileRole(name: string, type = ''): FileRole {
  if (/\.pdf$/i.test(name) || type === 'application/pdf') return 'sheet';
  if (isAudioFile(name, type)) return 'recording';
  return 'score';
}

/** The name two files must share to be paired: no folders or extension, any case or spacing. */
export function pairKey(fileName: string): string {
  return fileName
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export interface ImportGroup<F> {
  /** The score or recording that gives the notes; absent for a sheet-only piece. */
  notes?: F;
  /** The sheet-music PDF kept with the piece. */
  sheet?: F;
}

export interface ImportPlan<F> {
  /** One entry per piece, in the order the files came. */
  groups: ImportGroup<F>[];
  /**
   * Exactly one score file and one PDF were picked, under different names: the learner is asked
   * whether they are one piece rather than the app guessing. Neither file is in `groups` then.
   */
  ask: { notes: F; sheet: F } | null;
}

/**
 * Groups files into pieces. A score file and a PDF with the same `pairKey` are one piece; when a
 * name has several of either, the first of each pairs and the rest are pieces of their own.
 * Recordings are never paired. A PDF with no score file is a sheet-only piece.
 */
export function planImport<F extends { name: string; type?: string }>(
  files: readonly F[],
): ImportPlan<F> {
  const roles = files.map((f) => fileRole(f.name, f.type));
  if (files.length === 2 && roles.includes('score') && roles.includes('sheet')) {
    const notes = files[roles.indexOf('score')];
    const sheet = files[roles.indexOf('sheet')];
    if (notes && sheet && pairKey(notes.name) !== pairKey(sheet.name)) {
      return { groups: [], ask: { notes, sheet } };
    }
  }

  const firstScore = new Map<string, F>();
  const firstSheet = new Map<string, F>();
  files.forEach((f, i) => {
    const key = pairKey(f.name);
    if (roles[i] === 'score' && !firstScore.has(key)) firstScore.set(key, f);
    if (roles[i] === 'sheet' && !firstSheet.has(key)) firstSheet.set(key, f);
  });

  const groups: ImportGroup<F>[] = [];
  files.forEach((f, i) => {
    const key = pairKey(f.name);
    const score = firstScore.get(key);
    const sheet = firstSheet.get(key);
    const paired = score !== undefined && sheet !== undefined;
    if (roles[i] !== 'sheet') {
      groups.push(paired && score === f ? { notes: f, sheet } : { notes: f });
    } else if (!(paired && sheet === f)) {
      // A paired PDF is already in its score file's group.
      groups.push({ sheet: f });
    }
  });
  return { groups, ask: null };
}
