import { href } from '../lib/router';

export function About() {
  return (
    <article className="stack" style={{ maxWidth: '70ch' }}>
      <h1>About OpenTiles</h1>
      <p className="lead">
        OpenTiles is a free, open-source piano trainer. There is no paid tier, no advertising and no
        tracking, now or later.
      </p>
      <h2>Your privacy</h2>
      <ul>
        <li>Files you import are converted in your browser and stored only on this device.</li>
        <li>
          Note detection from the microphone runs entirely in your browser; audio is never sent
          anywhere.
        </li>
        <li>There are no analytics, cookies or third-party requests.</li>
        <li>
          Read exactly what is stored, and what the optional sync server sees, in the{' '}
          <a href={href({ name: 'privacy', lang: 'en' })}>privacy policy</a> (
          <a href={href({ name: 'privacy', lang: 'de' })} lang="de">
            Datenschutzerklärung
          </a>
          ).
        </li>
        <li>
          Browsers can clear website data. On iPad and iPhone, add OpenTiles to your Home Screen so
          Safari keeps your library.
        </li>
      </ul>
      <h2>Music and copyright</h2>
      <p>
        The pieces listed on the home page are public domain or CC0, each with a recorded source and
        licence. Your library is private: OpenTiles has no way to share or publish its contents.
        Only import files you have the right to use for personal practice.
      </p>
      <p>
        To report a catalogue piece you believe is still protected, open an issue on the project's
        GitHub page or write to the notice-and-takedown address in the{' '}
        <a href={href({ name: 'impressum', lang: 'en' })}>Impressum</a>; pieces are removed within
        48 hours while the claim is checked.
      </p>
      <h2>Piano sound</h2>
      <p>
        The piano you hear is adapted from the{' '}
        <a href="https://archive.org/details/SalamanderGrandPianoV3" rel="noreferrer">
          Salamander Grand Piano V3
        </a>{' '}
        by Alexander Holm, used under the{' '}
        <a href="https://creativecommons.org/licenses/by/3.0/" rel="noreferrer">
          Creative Commons Attribution 3.0
        </a>{' '}
        licence. For OpenTiles the recordings were shortened, mixed to mono, evened out in level and
        converted to MP3: see <a href="samples/piano/README.md">where they come from</a> and the{' '}
        <a href="samples/piano/LICENSE.txt">licence text</a>. Until the samples have loaded, or if
        they cannot load, a simple built-in synthesiser plays instead.
      </p>
      <h2>Open source</h2>
      <p>
        The app is licensed under the GNU AGPL-3.0; catalogue metadata under CC0. Source code, plans
        and contribution guide:{' '}
        <a href="https://github.com/KunalGehlot/OpenTiles" rel="noreferrer">
          github.com/KunalGehlot/OpenTiles
        </a>
        .
      </p>
      <p>
        Want to help test microphone recognition? Try the{' '}
        <a href={href({ name: 'lab' })}>Detector Lab</a>.
      </p>
    </article>
  );
}
