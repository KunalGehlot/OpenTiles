// A tiny hash router: static hosting needs no server rewrites, and the app works offline.
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  /** All the music, played on this device or the learner's keyboard (Phase 6, ADR 0019). */
  | { name: 'player' }
  /** `drill` ids are generated drill options, not stored pieces (P5-05). */
  | { name: 'practice'; source: 'catalogue' | 'library' | 'drill'; id: string }
  /**
   * Drills: the hub, or a drill's setup page: sight-reading (a clef, key and level, P5-05) or
   * chords (a level or a set, P7-04).
   */
  | { name: 'drills'; page?: DrillPage }
  | { name: 'lab' }
  | { name: 'about' }
  /** Where to find free and licensed sheet music to import. */
  | { name: 'sheet-music' }
  | { name: 'settings' }
  | { name: 'privacy'; lang: LegalLang }
  | { name: 'impressum'; lang: LegalLang }
  /** The sync service's email sign-in link (P3-03). */
  | { name: 'sign-in'; token: string };

export type DrillPage = 'sight-reading' | 'chords' | 'scales';

/** The legal pages are in English and German (P2-17). */
export type LegalLang = 'en' | 'de';

export function parseHash(hash: string): Route {
  // Sign-in links may carry the token as a bare fragment: `…#token=abc`.
  const bare = /^#token=([\w-]+)$/.exec(hash);
  if (bare?.[1]) return { name: 'sign-in', token: bare[1] };
  // A query after the page (`#/player?design=b`) is the page's own business.
  const parts = hash
    .replace(/^#\/?/, '')
    .replace(/\?.*$/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  switch (parts[0]) {
    case 'library':
      return { name: 'library' };
    case 'player':
      return { name: 'player' };
    case 'practice':
      if (
        (parts[1] === 'catalogue' || parts[1] === 'library' || parts[1] === 'drill') &&
        parts[2]
      ) {
        return { name: 'practice', source: parts[1], id: parts[2] };
      }
      return { name: 'home' };
    case 'drills':
      return parts[1] === 'sight-reading' || parts[1] === 'chords' || parts[1] === 'scales'
        ? { name: 'drills', page: parts[1] }
        : { name: 'drills' };
    case 'lab':
      return { name: 'lab' };
    case 'about':
      return { name: 'about' };
    case 'sheet-music':
      return { name: 'sheet-music' };
    case 'settings':
      return { name: 'settings' };
    case 'privacy':
    case 'impressum':
      return { name: parts[0], lang: parts[1] === 'de' ? 'de' : 'en' };
    case 'sign-in':
      return parts[1] ? { name: 'sign-in', token: parts[1] } : { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'practice':
      return `#/practice/${route.source}/${encodeURIComponent(route.id)}`;
    case 'privacy':
    case 'impressum':
      return route.lang === 'de' ? `#/${route.name}/de` : `#/${route.name}`;
    case 'sign-in':
      return `#/sign-in/${encodeURIComponent(route.token)}`;
    case 'drills':
      return route.page ? `#/drills/${route.page}` : '#/drills';
    default:
      return `#/${route.name}`;
  }
}

/** The full, stable link to a page, for copying (teacher links to catalogue pieces, P4-05). */
export function absoluteHref(route: Route, base = window.location.href): string {
  return new URL(href(route), base.split('#')[0]).href;
}

export function navigate(route: Route): void {
  window.location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
