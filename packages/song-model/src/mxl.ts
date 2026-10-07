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

/** Returns the MusicXML text inside an .mxl file. */
export function unzipMxl(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
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
