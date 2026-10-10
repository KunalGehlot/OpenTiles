// Compressed MusicXML (.mxl): a zip whose META-INF/container.xml names the score file.
import { unzipSync } from 'fflate';
import { ImportError } from './errors';

/** Decodes XML bytes, honouring a UTF-16 byte-order mark (some exporters write UTF-16). */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  return new TextDecoder('utf-8').decode(bytes);
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Most entries, and most bytes in one entry or in all, that a score archive may expand to. */
export const ZIP_LIMITS = {
  entries: 200,
  entryBytes: 64 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
};

/**
 * Unzips a score archive, refusing one that would expand to an unreasonable size (a "zip bomb"
 * can be a few kilobytes). Sizes come from the archive's own directory, which fflate checks while
 * inflating, so a lying directory fails the unzip instead of using memory.
 */
export function unzipLimited(
  bytes: Uint8Array,
  skip?: (name: string) => boolean,
): Record<string, Uint8Array> {
  let entries = 0;
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (f) => {
        if (skip?.(f.name)) return false;
        entries += 1;
        total += f.originalSize;
        if (
          entries > ZIP_LIMITS.entries ||
          f.originalSize > ZIP_LIMITS.entryBytes ||
          total > ZIP_LIMITS.totalBytes
        ) {
          throw new ImportError('This file is too large to open.');
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError('This file could not be unzipped.');
  }
}

/** Returns the MusicXML text inside an .mxl file. */
export function unzipMxl(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipLimited(bytes);
  } catch (e) {
    if (e instanceof ImportError && /too large/.test(e.message)) throw e;
    throw new ImportError('This .mxl file could not be unzipped.');
  }
  const container = files['META-INF/container.xml'];
  let rootPath: string | undefined;
  if (container) {
    const match = /<rootfile[^>]*full-path\s*=\s*"([^"]+)"/i.exec(decodeXml(container));
    rootPath = match?.[1];
  }
  if (!rootPath || !files[rootPath]) {
    rootPath = Object.keys(files).find(
      (name) => !name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(name),
    );
  }
  const score = rootPath ? files[rootPath] : undefined;
  if (!score) throw new ImportError('No score was found inside this .mxl file.');
  return decodeXml(score);
}
