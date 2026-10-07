// Turns the raw licence findings into a verdict: SPDX evaluation, reviewed exceptions, and the
// coverage and licence-text checks for vendored assets (P2-16). Pure functions; the CLI in
// tools/check-licences.mjs does the I/O.

import { checkExpression } from './spdx.mjs';

/**
 * @typedef {'npm' | 'cargo' | 'asset'} Ecosystem
 * @typedef {{ ecosystem: Ecosystem, name: string, version: string, licence: string | null,
 *   where?: string }} Finding
 * @typedef {{ ecosystem: Ecosystem, name: string, version?: string, licence: string,
 *   reason: string }} Exception
 * @typedef {Finding & { status: 'allowed' | 'excepted' | 'rejected', detail: string }} Result
 */

/**
 * Checks an exceptions file's contents and returns the entries. Every entry needs a reason, so a
 * reviewer can see why it was accepted.
 * @param {unknown} data
 * @returns {Exception[]}
 */
export function validateExceptions(data) {
  if (typeof data !== 'object' || data === null || !Array.isArray(data.exceptions)) {
    throw new Error('exceptions file must be an object with an "exceptions" array');
  }
  return data.exceptions.map((entry, i) => {
    const where = `exceptions[${i}]`;
    if (typeof entry !== 'object' || entry === null) throw new Error(`${where} is not an object`);
    for (const key of ['ecosystem', 'name', 'licence', 'reason']) {
      if (typeof entry[key] !== 'string' || entry[key].trim() === '') {
        throw new Error(`${where} needs a non-empty "${key}"`);
      }
    }
    if (!['npm', 'cargo', 'asset'].includes(entry.ecosystem)) {
      throw new Error(`${where}.ecosystem must be npm, cargo or asset`);
    }
    if (entry.version !== undefined && typeof entry.version !== 'string') {
      throw new Error(`${where}.version must be a string when present`);
    }
    return entry;
  });
}

/**
 * An exception matches only the exact licence string it was reviewed for, so a dependency that
 * changes its licence is flagged again. Without a version it covers every version.
 * @param {Exception} exception
 * @param {Finding} finding
 */
function matches(exception, finding) {
  return (
    exception.ecosystem === finding.ecosystem &&
    exception.name === finding.name &&
    exception.licence === (finding.licence ?? '') &&
    (exception.version === undefined || exception.version === finding.version)
  );
}

/**
 * @param {Finding[]} findings
 * @param {Exception[]} exceptions
 * @returns {{ results: Result[], unusedExceptions: Exception[] }}
 */
export function evaluateFindings(findings, exceptions) {
  const used = new Set();
  const results = findings.map((finding) => {
    const verdict = checkExpression(finding.licence, { asset: finding.ecosystem === 'asset' });
    if (verdict.allowed) {
      return { ...finding, status: 'allowed', detail: verdict.relied.join(' AND ') };
    }
    const exception = exceptions.find((e) => matches(e, finding));
    if (exception) {
      used.add(exception);
      return { ...finding, status: 'excepted', detail: exception.reason };
    }
    const detail =
      verdict.error ??
      `not on the allowlist: ${[...new Set(verdict.problems)].join(', ') || finding.licence}`;
    return { ...finding, status: 'rejected', detail };
  });
  return { results, unusedExceptions: exceptions.filter((e) => !used.has(e)) };
}

/** Phrases that identify a licence text, to confirm a vendored LICENSE file says what we claim. */
const LICENCE_TEXT_MARKERS = {
  'Apache-2.0': /Apache License\s+Version 2\.0/i,
  'CC-BY-3.0': /Attribution 3\.0/i,
  'CC-BY-4.0': /Attribution 4\.0 International/i,
  'CC0-1.0': /CC0 1\.0 Universal/i,
  MIT: /Permission is hereby granted, free of charge/i,
  'BSD-3-Clause': /Neither the name of/i,
  'MPL-2.0': /Mozilla Public License,?\s+(?:Version|v\.)\s*2\.0/i,
  'AGPL-3.0-or-later': /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/i,
};

/**
 * Checks that a licence file's text matches the licence an asset is declared under.
 * @param {string} licence SPDX identifier from assets.json
 * @param {string} text the licence file's contents
 * @returns {string | null} a problem description, or null when the text matches
 */
export function licenceTextProblem(licence, text) {
  const marker = LICENCE_TEXT_MARKERS[licence];
  if (!marker) return `cannot recognise a ${licence} licence text; add a marker in policy.mjs`;
  return marker.test(text) ? null : `licence file does not look like ${licence}`;
}

/**
 * @typedef {{ path: string, licence: string, licenceFile?: string, source: string }} AssetEntry
 */

/**
 * Finds the declared asset entry covering a file path (the longest matching path wins), so every
 * vendored file must be accounted for in assets.json.
 * @param {string} file path relative to the repository root, with forward slashes
 * @param {AssetEntry[]} entries
 * @returns {AssetEntry | undefined}
 */
export function coveringAsset(file, entries) {
  let best;
  for (const entry of entries) {
    const covers = file === entry.path || file.startsWith(`${entry.path.replace(/\/$/, '')}/`);
    if (covers && (!best || entry.path.length > best.path.length)) best = entry;
  }
  return best;
}
