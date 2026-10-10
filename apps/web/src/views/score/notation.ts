// What the score views can draw for a piece: the original MusicXML or ABC text, or nothing (with
// the reason shown next to the view switch). Pure; nothing leaves the device.
import { decodeXml, isZip, looksLikeAbc, unzipMxl } from '@opentiles/song-model';
import type { SongFormat } from '@opentiles/song-model';
import { t } from '../../i18n';

export type NotationSource =
  | {
      kind: 'musicxml' | 'abc';
      text: string;
      /** Semitones the song was transposed by on import; the score is drawn transposed too. */
      transpose: number;
    }
  | { kind: 'none'; reason: string };

/** Why a format has no score view, or null when it has one. */
function noScoreReason(format: SongFormat): string | null {
  switch (format) {
    case 'midi':
      return t('MIDI files have no printed score, so this piece is shown as falling notes.');
    case 'audio':
      return t(
        'Pieces made from a recording have no printed score, so they are shown as falling notes.',
      );
    case 'mscz':
      return t(
        'The score view cannot draw MuseScore files yet, so this piece is shown as falling notes.',
      );
    default:
      return null;
  }
}

/** The notation for a piece from its original file bytes. */
export function notationFor(
  format: SongFormat,
  bytes: Uint8Array | undefined,
  transpose = 0,
): NotationSource {
  const reason = noScoreReason(format);
  if (reason) return { kind: 'none', reason };
  if (!bytes || bytes.length === 0) {
    return {
      kind: 'none',
      reason: t('The original score file is missing, so only falling notes are shown.'),
    };
  }
  try {
    if (format === 'mxl' || isZip(bytes)) {
      return { kind: 'musicxml', text: unzipMxl(bytes), transpose };
    }
    if (format === 'abc') {
      return { kind: 'abc', text: new TextDecoder().decode(bytes), transpose };
    }
    const text = decodeXml(bytes);
    if (looksLikeAbc(text)) return { kind: 'abc', text, transpose };
    return { kind: 'musicxml', text, transpose };
  } catch {
    return { kind: 'none', reason: t('This score file could not be read for the score view.') };
  }
}

/** Format of a catalogue score from its path. */
export function formatOfPath(path: string): SongFormat {
  const lower = path.toLowerCase();
  if (lower.endsWith('.mxl')) return 'mxl';
  if (lower.endsWith('.abc')) return 'abc';
  if (lower.endsWith('.mid') || lower.endsWith('.midi')) return 'midi';
  return 'musicxml';
}
