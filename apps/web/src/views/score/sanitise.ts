// The engraver turns text from the user's own file (title, composer, lyrics, marks) into SVG that
// is inserted into the page. Verovio escapes that text, and the Content-Security-Policy forbids
// inline scripts, so this is a second layer: it removes anything in the SVG that could run code or
// load something. Pure string work, so it is unit-tested in Node.

const BLOCKED_ELEMENTS =
  /<\s*(script|foreignObject|iframe|object|embed|link|meta|base|audio|video|set|animate\w*)\b[\s\S]*?(?:<\s*\/\s*\1\s*>|\/\s*>|$)/gi;
// A browser starts a new attribute after white space, after `/` (`<svg/onload=x>`) and straight
// after a closing quote (`a="b"onload=x`), so all of those count as the separator. The separator is
// kept, which also keeps the attribute before it intact. One character, not `\s+`, so a long run of
// white space cannot make the match slow.
const EVENT_HANDLERS = /([\s/"'])on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
// Engraved SVG only links inside itself (`<use xlink:href="#E0A4"/>`), so every link that does not
// start with `#` goes. That is stricter than listing script schemes, which spelling tricks such as
// `java&#x73;cript:` get past.
const EXTERNAL_LINKS =
  /([\s/"'])(?:xlink:)?href\s*=\s*(?:"(?!#)[^"]*"|'(?!#)[^']*'|(?!["'#])[^\s>]+)/gi;

/** The SVG without scripts, event handlers, external links and embedded foreign content. */
export function sanitiseSvg(svg: string): string {
  let out = svg;
  // Run until a pass changes nothing, so nested or split tags cannot rebuild a blocked one. Every
  // replacement deletes text, so each pass that changes the string makes it shorter and the loop
  // must end. No pass count: a fixed limit would leave crafted input with a survivor.
  for (;;) {
    const next = out
      .replace(BLOCKED_ELEMENTS, '')
      .replace(EVENT_HANDLERS, '$1')
      .replace(EXTERNAL_LINKS, '$1');
    if (next === out) return out;
    out = next;
  }
}
