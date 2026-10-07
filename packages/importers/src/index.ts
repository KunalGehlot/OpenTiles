// One entry point for every file the app accepts. Formats that need a larger reader (MuseScore
// today; OMR and audio later) are loaded only when such a file is imported, so they never weigh
// down the main bundle. Everything runs on the device; nothing is uploaded.
import { unzipSync } from 'fflate';
import { decodeXml, importScore, isZip } from '@opentiles/song-model';
import type { ImportOptions, Song } from '@opentiles/song-model';

export { SUPPORTED_EXTENSIONS } from '@opentiles/song-model';
export type { ImportOptions } from '@opentiles/song-model';

/** Names of the entries in a zip file, without decompressing anything. */
function zipEntryNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    // Not a readable zip; the format-specific reader reports the error.
  }
  return names;
}

/** True for MuseScore files, by extension or, for other names, by content. */
export function isMuseScoreFile(fileName: string, bytes: Uint8Array): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.mscz') || lower.endsWith('.mscx')) return true;
  if (isZip(bytes)) return zipEntryNames(bytes).some((n) => /\.mscx$/i.test(n));
  return /<museScore[\s>]/.test(decodeXml(bytes.subarray(0, 512)));
}

/** Reads any supported score file (MusicXML, .mxl, MIDI, ABC, MuseScore) into a Song. */
export async function importAnyScore(
  fileName: string,
  bytes: Uint8Array,
  options: ImportOptions = {},
): Promise<Song> {
  if (isMuseScoreFile(fileName, bytes)) {
    const { readMuseScore } = await import('./musescore');
    return readMuseScore(
      fileName,
      bytes,
      options.domParser ? { domParser: options.domParser } : {},
    );
  }
  return importScore(fileName, bytes, options);
}
