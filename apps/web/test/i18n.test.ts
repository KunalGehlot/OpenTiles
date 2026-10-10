// Every string passed to t() has a German translation with the same placeholders (P2-14).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { setLanguage, t } from '../src/i18n';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    // iCloud conflict copies ("foo 2.ts") are not part of the app.
    if (/ \d+(\.|$)/.test(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** String literals passed directly as the first argument of t(…). */
function keysIn(code: string): string[] {
  const keys: string[] = [];
  const call = /(?<![\w.$])t\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;
  for (const m of code.matchAll(call)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    keys.push(raw.replace(/\\(.)/g, '$1'));
  }
  return keys;
}

/**
 * Messages that reach the screen from the shared packages (import errors and warnings). The app
 * shows them with t(message), so they need German entries too.
 */
function packageMessages(code: string): string[] {
  const out: string[] = [];
  const msg =
    /(?:new ImportError\(|warnings\.push\(|_WARNING = )\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (const m of code.matchAll(msg)) out.push((m[1] ?? m[2] ?? '').replace(/\\(.)/g, '$1'));
  return out;
}

const used = new Map<string, string>();
for (const file of sourceFiles(srcDir)) {
  for (const key of keysIn(readFileSync(file, 'utf8'))) used.set(key, file);
}
const packagesDir = fileURLToPath(new URL('../../../packages/', import.meta.url));
for (const pkg of readdirSync(packagesDir)) {
  const dir = join(packagesDir, pkg, 'src');
  if (!statSync(join(packagesDir, pkg)).isDirectory()) continue;
  let files: string[];
  try {
    files = sourceFiles(dir);
  } catch {
    continue;
  }
  for (const file of files) {
    for (const key of packageMessages(readFileSync(file, 'utf8'))) used.set(key, file);
  }
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('German translation', () => {
  it('finds the strings in the source', () => {
    expect(used.size).toBeGreaterThan(300);
  });

  it('has an entry for every string the app shows', () => {
    const missing = [...used.keys()].filter((k) => !(k in de));
    expect(missing).toEqual([]);
  });

  it('keeps the placeholders of every entry', () => {
    const wrong = Object.entries(de).filter(([en, ger]) => {
      return placeholders(en).join() !== placeholders(ger).join();
    });
    expect(wrong).toEqual([]);
  });

  it('has no entries the app no longer uses', () => {
    const unused = Object.keys(de).filter((k) => !used.has(k));
    expect(unused).toEqual([]);
  });

  it('translates and fills placeholders at run time', () => {
    setLanguage('de');
    expect(t('Settings')).toBe(de['Settings']);
    expect(t('No piece matches “{query}”.', { query: 'x' })).toContain('x');
    expect(t('a string with no translation')).toBe('a string with no translation');
    setLanguage('en');
    expect(t('{n} pieces found', { n: 3 })).toBe('3 pieces found');
  });
});
