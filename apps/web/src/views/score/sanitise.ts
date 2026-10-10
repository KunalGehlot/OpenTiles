// The engraver turns text from the user's own file (title, composer, lyrics, marks) into SVG that
// is inserted into the page. Verovio escapes that text, and the Content-Security-Policy forbids
// inline scripts, so this is a second layer: it removes anything in the SVG that could run code or
// load something. Pure string work, so it is unit-tested in Node.

const BLOCKED_ELEMENTS =
  /<\s*(script|foreignObject|iframe|object|embed|link|meta|base|audio|video)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|\/\s*>|$)/gi;
const EVENT_HANDLERS = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const SCRIPT_URLS =
  /\s+(?:xlink:)?href\s*=\s*(?:"\s*(?:javascript|data|vbscript):[^"]*"|'\s*(?:javascript|data|vbscript):[^']*')/gi;

/** The SVG without scripts, event handlers, script URLs and embedded foreign content. */
export function sanitiseSvg(svg: string): string {
  let out = svg;
  // Run until stable, so nested or split tags cannot rebuild a blocked one.
  for (let i = 0; i < 4; i += 1) {
    const next = out
      .replace(BLOCKED_ELEMENTS, '')
      .replace(EVENT_HANDLERS, '')
      .replace(SCRIPT_URLS, '');
    if (next === out) break;
    out = next;
  }
  return out;
}
