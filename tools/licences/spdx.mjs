// SPDX licence expressions: parsing and evaluation against the OpenTiles allowlist (P2-16).
//
// The code is AGPL-3.0-or-later, so every dependency that ships must be under a licence that can be
// combined with it (docs/development.md hard rule 7). Media assets (samples, models) may additionally be
// under Creative Commons Attribution, which works for data files served next to the code but not
// for code linked into it.
//
// No dependencies: this runs in CI before anything is built.

/** Licences any shipped dependency may use. Keys are canonical SPDX identifiers. */
export const CODE_ALLOWLIST = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'Zlib',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'MPL-2.0',
  'LGPL-2.1-or-later',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  // "Version 2 or later" includes version 3, which is compatible with the AGPL (GPL-3.0 §13).
  'GPL-2.0-or-later',
  'GPL-3.0-only',
  'GPL-3.0-or-later',
  'AGPL-3.0-only',
  'AGPL-3.0-or-later',
  'Python-2.0',
]);

/** Licences allowed for vendored media assets only (samples, models, fonts), never for code. */
export const ASSET_ALLOWLIST = new Set([...CODE_ALLOWLIST, 'CC-BY-3.0', 'CC-BY-4.0']);

/**
 * SPDX licence exceptions that only grant extra permissions, so `X WITH e` is as acceptable as `X`.
 */
export const ALLOWED_EXCEPTIONS = new Set([
  'LLVM-exception',
  'Classpath-exception-2.0',
  'GCC-exception-3.1',
  'Autoconf-exception-3.0',
  'Bison-exception-2.2',
  'Font-exception-2.0',
]);

// Identifiers that SPDX has deprecated but that package manifests still use.
const DEPRECATED = new Map([
  ['GPL-2.0', 'GPL-2.0-only'],
  ['GPL-3.0', 'GPL-3.0-only'],
  ['LGPL-2.1', 'LGPL-2.1-only'],
  ['LGPL-3.0', 'LGPL-3.0-only'],
  ['AGPL-3.0', 'AGPL-3.0-only'],
]);

// Every identifier the evaluator knows, for case-insensitive lookup ("mit" -> "MIT").
const KNOWN_IDS = new Map(
  [
    ...ASSET_ALLOWLIST,
    'GPL-2.0-only',
    'LGPL-2.1-only',
    'CC-BY-SA-4.0',
    'CC-BY-NC-4.0',
    'SSPL-1.0',
    'BUSL-1.1',
    'EPL-2.0',
    'CDDL-1.0',
    'Unicode-3.0',
    'Unicode-DFS-2016',
    ...DEPRECATED.keys(),
  ].map((id) => [id.toLowerCase(), id]),
);
const KNOWN_EXCEPTIONS = new Map([...ALLOWED_EXCEPTIONS].map((id) => [id.toLowerCase(), id]));

/**
 * @typedef {{ type: 'licence', id: string }
 *   | { type: 'with', licence: Node, exception: string }
 *   | { type: 'and' | 'or', left: Node, right: Node }} Node
 */

/** Maps an identifier to its canonical spelling, resolving `+` and deprecated forms. */
export function canonicalId(raw) {
  let id = raw.trim();
  let orLater = false;
  if (id.endsWith('+')) {
    orLater = true;
    id = id.slice(0, -1);
  }
  id = KNOWN_IDS.get(id.toLowerCase()) ?? id;
  if (DEPRECATED.has(id)) {
    const only = /** @type {string} */ (DEPRECATED.get(id));
    return orLater ? only.replace(/-only$/, '-or-later') : only;
  }
  if (orLater && /-only$/.test(id)) return id.replace(/-only$/, '-or-later');
  // "Apache-2.0+" lets us pick 2.0 itself.
  return id;
}

function tokenize(expression) {
  // Old Cargo manifests write "MIT/Apache-2.0" for "MIT OR Apache-2.0".
  const normalised = expression.replace(/\s*\/\s*/g, ' OR ');
  const tokens = [];
  const re = /\s*(\(|\)|[^\s()]+)/g;
  let match;
  while ((match = re.exec(normalised)) !== null) tokens.push(match[1]);
  return tokens;
}

/**
 * Parses an SPDX expression. Precedence follows the SPDX spec: WITH binds tightest, then AND,
 * then OR. Operators are case-insensitive, as many manifests write "and"/"or".
 * @param {string} expression
 * @returns {Node}
 */
export function parseSpdx(expression) {
  if (typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('empty licence expression');
  }
  const tokens = tokenize(expression);
  let pos = 0;
  const peek = () => tokens[pos];
  const isOp = (tok, op) => tok !== undefined && tok.toUpperCase() === op;

  const parseOr = () => {
    let left = parseAnd();
    while (isOp(peek(), 'OR')) {
      pos++;
      left = { type: 'or', left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = () => {
    let left = parseWith();
    while (isOp(peek(), 'AND')) {
      pos++;
      left = { type: 'and', left, right: parseWith() };
    }
    return left;
  };
  const parseWith = () => {
    const licence = parseAtom();
    if (isOp(peek(), 'WITH')) {
      pos++;
      const exception = tokens[pos++];
      if (exception === undefined || exception === '(' || exception === ')') {
        throw new Error(`missing exception after WITH in "${expression}"`);
      }
      return {
        type: 'with',
        licence,
        exception: KNOWN_EXCEPTIONS.get(exception.toLowerCase()) ?? exception,
      };
    }
    return licence;
  };
  const parseAtom = () => {
    const tok = tokens[pos++];
    if (tok === undefined) throw new Error(`unexpected end of "${expression}"`);
    if (tok === '(') {
      const inner = parseOr();
      if (tokens[pos++] !== ')') throw new Error(`missing ")" in "${expression}"`);
      return inner;
    }
    if (tok === ')' || ['AND', 'OR', 'WITH'].includes(tok.toUpperCase())) {
      throw new Error(`unexpected "${tok}" in "${expression}"`);
    }
    return { type: 'licence', id: canonicalId(tok) };
  };

  const tree = parseOr();
  if (pos !== tokens.length) throw new Error(`unexpected "${tokens[pos]}" in "${expression}"`);
  return tree;
}

/**
 * @typedef {{ allowed: boolean, relied: string[], problems: string[] }} Verdict
 * `relied` lists the licences the decision rests on (for OR, the first acceptable branch);
 * `problems` lists the identifiers that are unknown or not allowed.
 */

/**
 * @param {Node} node
 * @param {Set<string>} allowlist
 * @returns {Verdict}
 */
function evaluate(node, allowlist) {
  switch (node.type) {
    case 'licence':
      return allowlist.has(node.id)
        ? { allowed: true, relied: [node.id], problems: [] }
        : { allowed: false, relied: [], problems: [node.id] };
    case 'with': {
      const inner = evaluate(node.licence, allowlist);
      if (!ALLOWED_EXCEPTIONS.has(node.exception)) {
        return { allowed: false, relied: [], problems: [...inner.problems, node.exception] };
      }
      return inner.allowed
        ? {
            allowed: true,
            relied: inner.relied.map((id) => `${id} WITH ${node.exception}`),
            problems: [],
          }
        : inner;
    }
    case 'and': {
      const left = evaluate(node.left, allowlist);
      const right = evaluate(node.right, allowlist);
      return left.allowed && right.allowed
        ? { allowed: true, relied: [...left.relied, ...right.relied], problems: [] }
        : { allowed: false, relied: [], problems: [...left.problems, ...right.problems] };
    }
    case 'or': {
      const left = evaluate(node.left, allowlist);
      if (left.allowed) return left;
      const right = evaluate(node.right, allowlist);
      if (right.allowed) return right;
      return { allowed: false, relied: [], problems: [...left.problems, ...right.problems] };
    }
  }
}

/**
 * Checks a licence expression as reported by a package manager.
 * @param {string | null | undefined} expression
 * @param {{ asset?: boolean }} [options] `asset: true` also allows the Creative Commons licences.
 * @returns {Verdict & { error?: string }}
 */
export function checkExpression(expression, options = {}) {
  const allowlist = options.asset ? ASSET_ALLOWLIST : CODE_ALLOWLIST;
  if (expression === null || expression === undefined || String(expression).trim() === '') {
    return { allowed: false, relied: [], problems: [], error: 'no licence declared' };
  }
  let tree;
  try {
    tree = parseSpdx(String(expression));
  } catch (error) {
    return {
      allowed: false,
      relied: [],
      problems: [],
      error: `not a valid SPDX expression (${/** @type {Error} */ (error).message})`,
    };
  }
  return evaluate(tree, allowlist);
}
