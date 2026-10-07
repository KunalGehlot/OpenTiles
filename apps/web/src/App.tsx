import { About } from './routes/About';
import { DetectorLab } from './routes/DetectorLab';
import { Home } from './routes/Home';
import { Library } from './routes/Library';
import { Practice } from './routes/Practice';
import { href, useRoute } from './lib/router';
import type { Route } from './lib/router';

const NAV: { route: Route; label: string }[] = [
  { route: { name: 'home' }, label: 'Pieces' },
  { route: { name: 'library' }, label: 'My library' },
  { route: { name: 'lab' }, label: 'Detector Lab' },
  { route: { name: 'about' }, label: 'About' },
];

export function App() {
  const route = useRoute();
  const practising = route.name === 'practice';
  return (
    <div className={practising ? 'app app--practice' : 'app'}>
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
      <main>
        {route.name === 'home' && <Home />}
        {route.name === 'library' && <Library />}
        {route.name === 'practice' && <Practice source={route.source} id={route.id} />}
        {route.name === 'lab' && <DetectorLab />}
        {route.name === 'about' && <About />}
      </main>
    </div>
  );
}
