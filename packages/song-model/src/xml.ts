// Small DOM helpers shared by the XML-based importers (MusicXML here, MuseScore in
// packages/importers). They only use the DOM Level 1 API, so they work with the browser's
// DOMParser and with @xmldom/xmldom in Node tests and workers alike.
import { ImportError } from './errors';

export interface DomParserLike {
  parseFromString(xml: string, type: string): Document;
}

/** Parses `xml` with the given parser, or the global DOMParser in browsers. */
export function parseXmlDocument(xml: string, domParser?: DomParserLike): Document {
  const parser: DomParserLike | undefined =
    domParser ?? (typeof DOMParser !== 'undefined' ? new DOMParser() : undefined);
  if (!parser) throw new ImportError('No XML parser is available in this environment.');
  let doc: Document;
  try {
    doc = parser.parseFromString(xml, 'application/xml');
  } catch {
    throw new ImportError('This file is not valid XML.');
  }
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new ImportError('This file is not valid XML.');
  }
  return doc;
}

/** Child elements of `parent`, optionally only those named `name`. */
export function xmlChildren(parent: Element | Document, name?: string): Element[] {
  const out: Element[] = [];
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (name === undefined || n.nodeName === name)) out.push(n as Element);
  }
  return out;
}

/** The first child element named `name`. */
export function xmlChild(parent: Element | undefined, name: string): Element | undefined {
  if (!parent) return undefined;
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.nodeName === name) return n as Element;
  }
  return undefined;
}

/** Follows a chain of first children: `xmlPath(note, 'notations', 'technical')`. */
export function xmlPath(parent: Element | undefined, ...names: string[]): Element | undefined {
  let el = parent;
  for (const n of names) {
    if (!el) return undefined;
    el = xmlChild(el, n);
  }
  return el;
}

/** Trimmed text content, or undefined when empty. */
export function xmlText(el: Element | undefined): string | undefined {
  const t = el?.textContent?.trim();
  return t === undefined || t === '' ? undefined : t;
}

/** Text content as a finite number, or undefined. */
export function xmlNumber(el: Element | undefined): number | undefined {
  const t = xmlText(el);
  if (t === undefined) return undefined;
  const v = Number(t);
  return Number.isFinite(v) ? v : undefined;
}
