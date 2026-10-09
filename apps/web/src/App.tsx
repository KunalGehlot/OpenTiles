import { About } from './routes/About';
import { DetectorLab } from './routes/DetectorLab';
import { Home } from './routes/Home';
import { Library } from './routes/Library';
import { Practice } from './routes/Practice';
import { Impressum, Privacy } from './legal/LegalPages';
import { lazy, Suspense } from 'react';
import { href, useRoute } from './lib/router';
import type { Route } from './lib/router';
import { ErrorBoundary } from './ui/ErrorBoundary';

// Settings pulls in the encryption code (Argon2id, zip, sync client); load it only when opened.
const Settings = lazy(() => import('./routes/Settings'));
const SignInLink = lazy(() =>
  import('./sync/SyncSection').then((m) => ({ default: m.SignInLink })),
);

const NAV: { route: Route; label: string }[] = [
  { route: { name: 'home' }, label: 'Pieces' },
  { route: { name: 'library' }, label: 'My library' },
  { route: { name: 'lab' }, label: 'Detector Lab' },
  { route: { name: 'about' }, label: 'About' },
  { route: { name: 'settings' }, label: 'Settings' },
];

export function App() {
  const route = useRoute();
  const practising = route.name === 'practice';
  return (
    <div className={practising ? 'app app--practice' : 'app'}>
      {/* The practice screen has its own slim header (routes/Practice.tsx): the canvas needs the room. */}
      {!practising && (
        <header className="topbar">
          <a className="brand" href={href({ name: 'home' })}>
            <img src="./icon.svg" alt="" width={28} height={28} />
            <span>OpenTiles</span>
          </a>
          <nav aria-label="Main">
            {NAV.map((n) => (
              <a
                key={n.label}
                href={href(n.route)}
                aria-current={n.route.name === route.name ? 'page' : undefined}
              >
                {n.label}
              </a>
            ))}
          </nav>
        </header>
      )}
      <main>
        <ErrorBoundary resetKey={JSON.stringify(route)}>
          {route.name === 'home' && <Home />}
          {route.name === 'library' && <Library />}
          {route.name === 'practice' && <Practice source={route.source} id={route.id} />}
          {route.name === 'lab' && <DetectorLab />}
          {route.name === 'about' && <About />}
          {(route.name === 'settings' || route.name === 'sign-in') && (
            <Suspense fallback={<p className="muted">Loading…</p>}>
              {route.name === 'settings' ? <Settings /> : <SignInLink token={route.token} />}
            </Suspense>
          )}
          {route.name === 'privacy' && <Privacy lang={route.lang} />}
          {route.name === 'impressum' && <Impressum lang={route.lang} />}
        </ErrorBoundary>
      </main>
      {!practising && (
        <footer className="footer">
          <nav aria-label="Legal">
            <a href={href({ name: 'privacy', lang: 'en' })}>Privacy</a>
            <a href={href({ name: 'impressum', lang: 'en' })}>Impressum</a>
            <a href={href({ name: 'settings' })}>Settings</a>
            <a href={href({ name: 'about' })}>About</a>
          </nav>
          <span className="muted">Free and open source · no tracking · no cookies</span>
        </footer>
      )}
    </div>
  );
}
