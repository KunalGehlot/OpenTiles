import { About } from './routes/About';
import { DetectorLab } from './routes/DetectorLab';
import { Home } from './routes/Home';
import { Library } from './routes/Library';
import { Player } from './routes/Player';
import { Practice } from './routes/Practice';
import { Impressum, Privacy } from './legal/LegalPages';
import { lazy, Suspense } from 'react';
import { href, useRoute } from './lib/router';
import type { Route } from './lib/router';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { language, t } from './i18n';
import { SheetMusic } from './routes/SheetMusic';
import { Drills } from './routes/Drills';
import { MiniPlayer } from './player/MiniPlayer';

// Settings pulls in the encryption code (Argon2id, zip, sync client); load it only when opened.
const Settings = lazy(() => import('./routes/Settings'));
const SignInLink = lazy(() =>
  import('./sync/SyncSection').then((m) => ({ default: m.SignInLink })),
);

/** Built on each render so the labels follow the language. */
function nav(): { route: Route; label: string }[] {
  return [
    { route: { name: 'home' }, label: t('Pieces') },
    { route: { name: 'library' }, label: t('My library') },
    { route: { name: 'player' }, label: t('Player') },
    { route: { name: 'drills' }, label: t('Drills') },
    { route: { name: 'sheet-music' }, label: t('Find sheet music') },
    { route: { name: 'lab' }, label: t('Detector Lab') },
    { route: { name: 'about' }, label: t('About') },
    { route: { name: 'settings' }, label: t('Settings') },
  ];
}

export function App() {
  const route = useRoute();
  const practising = route.name === 'practice';
  const className = practising
    ? 'app app--practice'
    : route.name === 'player'
      ? 'app app--player'
      : 'app';
  return (
    <div className={className}>
      {/* The practice screen has its own slim header (routes/Practice.tsx): the canvas needs the room. */}
      {!practising && (
        <header className="topbar">
          <a className="brand" href={href({ name: 'home' })}>
            <img src="./icon.svg" alt="" width={28} height={28} />
            <span>OpenTiles</span>
          </a>
          <nav aria-label={t('Main')}>
            {nav().map((n) => (
              <a
                key={n.route.name}
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
          {route.name === 'player' && <Player />}
          {route.name === 'practice' && <Practice source={route.source} id={route.id} />}
          {route.name === 'drills' && <Drills page={route.page} />}
          {route.name === 'lab' && <DetectorLab />}
          {route.name === 'about' && <About />}
          {route.name === 'sheet-music' && <SheetMusic />}
          {(route.name === 'settings' || route.name === 'sign-in') && (
            <Suspense fallback={<p className="muted">{t('Loading…')}</p>}>
              {route.name === 'settings' ? <Settings /> : <SignInLink token={route.token} />}
            </Suspense>
          )}
          {route.name === 'privacy' && <Privacy lang={route.lang} />}
          {route.name === 'impressum' && <Impressum lang={route.lang} />}
        </ErrorBoundary>
      </main>
      {!practising && (
        <footer className="footer">
          <nav aria-label={t('Legal')}>
            <a href={href({ name: 'privacy', lang: language() })}>{t('Privacy')}</a>
            <a href={href({ name: 'impressum', lang: language() })}>Impressum</a>
            <a href={href({ name: 'sheet-music' })}>{t('Find sheet music')}</a>
            <a href={href({ name: 'settings' })}>{t('Settings')}</a>
            <a href={href({ name: 'about' })}>{t('About')}</a>
          </nav>
          <span className="muted">{t('Free and open source · no tracking · no cookies')}</span>
        </footer>
      )}
      {/* The Player keeps playing on other pages (P6-09); practice has stopped it. */}
      {!practising && route.name !== 'player' && <MiniPlayer />}
    </div>
  );
}
