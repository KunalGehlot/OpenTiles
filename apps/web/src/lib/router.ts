// A tiny hash router: static hosting needs no server rewrites, and the app works offline.
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'practice'; source: 'catalogue' | 'library'; id: string }
  | { name: 'lab' }
  | { name: 'about' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'library':
      return { name: 'library' };
    case 'practice':
      if ((parts[1] === 'catalogue' || parts[1] === 'library') && parts[2]) {
        return { name: 'practice', source: parts[1], id: parts[2] };
      }
      return { name: 'home' };
    case 'lab':
      return { name: 'lab' };
    case 'about':
      return { name: 'about' };
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
    default:
      return `#/${route.name}`;
  }
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
