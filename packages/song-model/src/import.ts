// One entry point for every supported file: detects the format and returns a Song. Runs
// entirely on the device; nothing is uploaded (hard rule 3 in AGENTS.md).
import { midiToSong } from './midi';
import type { MidiImportOptions } from './midi';
import { decodeXml, isZip, unzipMxl } from './mxl';
import { ImportError, parseMusicXml } from './musicxml';
import type { DomParserLike } from './musicxml';
import type { Song } from './types';

export const SUPPORTED_EXTENSIONS = ['.musicxml', '.xml', '.mxl', '.mid', '.midi'] as const;

export interface ImportOptions extends MidiImportOptions {
  domParser?: DomParserLike;
}

function baseName(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Untitled';
}

export function importScore(
  fileName: string,
  bytes: Uint8Array,
  options: ImportOptions = {},
): Song {
  const lower = fileName.toLowerCase();
  const isMidi = bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64; // "MThd"
  if (isMidi || lower.endsWith('.mid') || lower.endsWith('.midi')) {
    return midiToSong(bytes, { fallbackTitle: baseName(fileName), ...options });
  }
  const xmlOptions = options.domParser ? { domParser: options.domParser } : {};
  if (isZip(bytes) || lower.endsWith('.mxl')) {
    const song = parseMusicXml(unzipMxl(bytes), { ...xmlOptions, format: 'mxl' });
    return song.title === 'Untitled' ? { ...song, title: baseName(fileName) } : song;
  }
  if (lower.endsWith('.mscz')) {
    throw new ImportError(
      'MuseScore files are not supported yet. Export as MusicXML in MuseScore.',
    );
  }
  const song = parseMusicXml(decodeXml(bytes), xmlOptions);
  return song.title === 'Untitled' ? { ...song, title: baseName(fileName) } : song;
}
