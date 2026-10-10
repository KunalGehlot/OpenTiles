// The app's two languages (P2-14). The English text is the key: `t('Practise')` returns the German
// in `de.ts` when German is chosen, and the English otherwise, so an untranslated string is never
// blank. `{name}` placeholders are filled from `vars`. test/i18n.test.ts checks that every `t()`
// call in the source has a German entry with the same placeholders.
import { de } from './de';

export type Lang = 'en' | 'de';

let current: Lang = 'en';

/** Called by the settings store when the language setting is read or changed. */
export function setLanguage(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    document.title = t('OpenTiles — free piano practice');
  }
}

export function language(): Lang {
  return current;
}

/** BCP 47 tag for Intl formatting in the current language. */
export function locale(): string {
  return current === 'de' ? 'de-DE' : 'en-GB';
}

export function t(text: string, vars?: Readonly<Record<string, string | number>>): string {
  const template = current === 'de' ? (de[text] ?? text) : text;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/** The language a first-time visitor probably wants, from the browser's preferences. */
export function browserLanguage(): Lang {
  const prefs =
    typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language];
  return prefs
    .find((l) => typeof l === 'string')
    ?.toLowerCase()
    .startsWith('de')
    ? 'de'
    : 'en';
}
