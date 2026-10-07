// One entry point for the formats this package reads: detects the format and returns a Song.
// Runs entirely on the device; nothing is uploaded (hard rule 3 in AGENTS.md). MuseScore files
// are read by the lazy-loaded reader in @opentiles/importers (`importAnyScore`).
import { looksLikeAbc, parseAbc } from './abc';
import { ImportError } from './errors';
import { midiToSong } from './midi';
import type { MidiImportOptions } from './midi';
import { decodeXml, isZip, unzipMxl } from './mxl';
import { parseMusicXml } from './musicxml';
import type { Song } from './types';
import type { DomParserLike } from './xml';

/** Every file extension the app accepts, including MuseScore (read by @opentiles/importers). */
export const SUPPORTED_EXTENSIONS = [
  '.musicxml',
  '.xml',
  '.mxl',
  '.mid',
  '.midi',
  '.abc',
  '.mscz',
  '.mscx',
] as const;

export interface ImportOptions extends MidiImportOptions {
  domParser?: DomParserLike;
}

/**
 * Text of an ABC file. Older ABC files are often Latin-1 rather than UTF-8, so bytes that are not
 * valid UTF-8 are read as Windows-1252 (a superset of Latin-1).
 */
function decodeAbc(bytes: Uint8Array): string {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return decodeXml(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** File name without folders and extension, for songs whose file has no title. */
export function baseName(fileName: string): string {
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
  if (lower.endsWith('.mscz') || lower.endsWith('.mscx')) {
    throw new ImportError('MuseScore files are opened with the MuseScore importer.');
  }
  const xmlOptions = options.domParser ? { domParser: options.domParser } : {};
  if (isZip(bytes) || lower.endsWith('.mxl')) {
    const song = parseMusicXml(unzipMxl(bytes), { ...xmlOptions, format: 'mxl' });
    return song.title === 'Untitled' ? { ...song, title: baseName(fileName) } : song;
  }
  const text = decodeXml(bytes);
  if (lower.endsWith('.abc') || looksLikeAbc(text)) {
    return parseAbc(decodeAbc(bytes), { fallbackTitle: baseName(fileName) });
  }
  const song = parseMusicXml(text, xmlOptions);
  return song.title === 'Untitled' ? { ...song, title: baseName(fileName) } : song;
}
