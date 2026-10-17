// What the score views can draw for a piece: the original MusicXML or ABC text, a score written
// from the song for MIDI files (P5-13, ADR 0017), or nothing (with the reason shown next to the view
// switch). Pure; nothing leaves the device.
import { decodeXml, isZip, looksLikeAbc, songToMusicXml, unzipMxl } from '@opentiles/song-model';
import type { ScoreHints, Song, SongFormat } from '@opentiles/song-model';
import { t } from '../../i18n';

export type NotationSource =
  | {
      kind: 'musicxml' | 'abc';
      text: string;
      /** Semitones the song was transposed by on import; the score is drawn transposed too. */
      transpose: number;
      /** Written from the song rather than taken from a score file (MIDI). */
      generated?: boolean;
    }
  | { kind: 'none'; reason: string };

/** Why a format has no score view, or null when it has one. */
function noScoreReason(format: SongFormat): string | null {
  switch (format) {
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
function notationFor(
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

/**
 * The song to practise and the notation to draw for a piece. A MIDI file has no notation of its
 * own, so its score is written from the song, which is already transposed and has the hands as
 * reviewed on import; the song comes back with the glyph refs of that score. Other formats draw
 * their original file (`notationFor`).
 */
export function scoreFor(
  format: SongFormat,
  bytes: Uint8Array | undefined,
  song: Song,
  transpose = 0,
  /** How the learner's sheet-music PDF writes the song (P5-18), to engrave it the same way. */
  hints?: ScoreHints,
): { song: Song; notation: NotationSource } {
  if (format !== 'midi') return { song, notation: notationFor(format, bytes, transpose) };
  try {
    const written = songToMusicXml(song, hints);
    return {
      song: written.song,
      notation: { kind: 'musicxml', text: written.xml, transpose: 0, generated: true },
    };
  } catch {
    return {
      song,
      notation: {
        kind: 'none',
        reason: t('This score file could not be read for the score view.'),
      },
    };
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
