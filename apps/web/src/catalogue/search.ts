// Searching the piece list. Pure, so it is unit-tested in Node.

/** Lower case, accents removed ("Für Elise" → "fur elise"), punctuation turned into spaces. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface Searchable {
  title: string;
  composer?: string;
  variant?: string;
  slug?: string;
  tags?: readonly string[];
}

/** True when every word of the query occurs in the title, composer, level name or tags. */
export function matchesQuery(piece: Searchable, query: string): boolean {
  const words = normaliseText(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normaliseText(
    [piece.title, piece.composer, piece.variant, ...(piece.tags ?? [])].filter(Boolean).join(' '),
  );
  return words.every((w) => haystack.includes(w));
}
