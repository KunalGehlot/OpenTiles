import { href } from '../lib/router';
import { language } from '../i18n';

export function About() {
  return language() === 'de' ? <AboutDe /> : <AboutEn />;
}

function AboutEn() {
  return (
    <article className="stack prose">
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
        Only import files you have the right to use for personal practice.{' '}
        <a href={href({ name: 'sheet-music' })}>Where to find free sheet music</a>.
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
      <p>
        Scores are engraved on your device by{' '}
        <a href="https://www.verovio.org/" rel="noreferrer">
          Verovio
        </a>
        , used under the GNU LGPL-3.0 (or later).
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

function AboutDe() {
  return (
    <article className="stack prose" lang="de">
      <h1>Über OpenTiles</h1>
      <p className="lead">
        OpenTiles ist ein kostenloser, quelloffener Klaviertrainer. Es gibt keine Bezahlstufe, keine
        Werbung und kein Tracking – weder jetzt noch später.
      </p>
      <h2>Deine Privatsphäre</h2>
      <ul>
        <li>
          Importierte Dateien werden in deinem Browser umgewandelt und nur auf diesem Gerät
          gespeichert.
        </li>
        <li>
          Die Notenerkennung über das Mikrofon läuft vollständig in deinem Browser; Audio wird nie
          irgendwohin gesendet.
        </li>
        <li>Es gibt keine Analysedienste, keine Cookies und keine Anfragen an Dritte.</li>
        <li>
          Was genau gespeichert wird und was der optionale Sync-Server sieht, steht in der{' '}
          <a href={href({ name: 'privacy', lang: 'de' })}>Datenschutzerklärung</a> (
          <a href={href({ name: 'privacy', lang: 'en' })} lang="en">
            privacy policy
          </a>
          ).
        </li>
        <li>
          Browser können Website-Daten löschen. Füge OpenTiles auf iPad und iPhone zum
          Home-Bildschirm hinzu, damit Safari deine Bibliothek behält.
        </li>
      </ul>
      <h2>Musik und Urheberrecht</h2>
      <p>
        Die Stücke auf der Startseite sind gemeinfrei oder CC0, jeweils mit festgehaltener Quelle
        und Lizenz. Deine Bibliothek ist privat: OpenTiles kann ihren Inhalt weder teilen noch
        veröffentlichen. Importiere nur Dateien, die du zum persönlichen Üben verwenden darfst.{' '}
        <a href={href({ name: 'sheet-music' })}>Wo du kostenlose Noten findest</a>.
      </p>
      <p>
        Wenn du meinst, dass ein Katalogstück noch geschützt ist, eröffne ein Issue auf der
        GitHub-Seite des Projekts oder schreib an die Adresse für Hinweise im{' '}
        <a href={href({ name: 'impressum', lang: 'de' })}>Impressum</a>; Stücke werden innerhalb von
        48 Stunden entfernt, solange der Hinweis geprüft wird.
      </p>
      <h2>Klavierklang</h2>
      <p>
        Das Klavier, das du hörst, beruht auf dem{' '}
        <a href="https://archive.org/details/SalamanderGrandPianoV3" rel="noreferrer">
          Salamander Grand Piano V3
        </a>{' '}
        von Alexander Holm, verwendet unter der Lizenz{' '}
        <a href="https://creativecommons.org/licenses/by/3.0/deed.de" rel="noreferrer">
          Creative Commons Namensnennung 3.0
        </a>
        . Für OpenTiles wurden die Aufnahmen gekürzt, zu Mono gemischt, in der Lautstärke
        angeglichen und in MP3 umgewandelt: siehe <a href="samples/piano/README.md">Herkunft</a> und{' '}
        <a href="samples/piano/LICENSE.txt">Lizenztext</a> (beide auf Englisch). Bis die Klänge
        geladen sind, oder wenn sie nicht laden können, spielt ein einfacher eingebauter
        Synthesizer.
      </p>
      <p>
        Noten werden auf deinem Gerät von{' '}
        <a href="https://www.verovio.org/" rel="noreferrer">
          Verovio
        </a>{' '}
        gesetzt, verwendet unter der GNU LGPL-3.0 (oder später).
      </p>
      <h2>Open Source</h2>
      <p>
        Die App steht unter der GNU AGPL-3.0, die Katalog-Metadaten unter CC0. Quellcode, Pläne und
        Anleitung zum Mitmachen:{' '}
        <a href="https://github.com/KunalGehlot/OpenTiles" rel="noreferrer">
          github.com/KunalGehlot/OpenTiles
        </a>
        .
      </p>
      <p>
        Möchtest du beim Testen der Mikrofonerkennung helfen? Probier das{' '}
        <a href={href({ name: 'lab' })}>Detektor-Labor</a> aus.
      </p>
    </article>
  );
}
