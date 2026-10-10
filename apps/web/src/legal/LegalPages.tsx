// Privacy policy and Impressum (P2-17), in English and German. The German text of the Impressum
// is the one German law requires; the English one is a courtesy translation. Keep both versions
// and docs/legal/records-of-processing.md in step with what the code actually stores and sends.
import type { ReactNode } from 'react';
import { href } from '../lib/router';
import type { LegalLang } from '../lib/router';
import { syncServerUrl } from '../sync/config';

export const OPERATOR = {
  name: 'Kunal Gehlot',
  email: 'Kunal.gehlot@rwth-aachen.de',
  /** Must be filled in before the public launch (legal guardrails, P2-17). */
  postalAddress: '[postal address to be added]',
} as const;

const UPDATED = '2026-10-07';

function LangSwitch({ page, lang }: { page: 'privacy' | 'impressum'; lang: LegalLang }) {
  return (
    <p className="row" lang="en">
      <a href={href({ name: page, lang: 'en' })} aria-current={lang === 'en' ? 'page' : undefined}>
        English
      </a>
      <span aria-hidden="true">·</span>
      <a
        href={href({ name: page, lang: 'de' })}
        aria-current={lang === 'de' ? 'page' : undefined}
        lang="de"
      >
        Deutsch
      </a>
    </p>
  );
}

function Page({ lang, children }: { lang: LegalLang; children: ReactNode }) {
  return (
    <article className="stack prose legal" lang={lang}>
      {children}
    </article>
  );
}

function Mail() {
  return <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>;
}

export function Privacy({ lang }: { lang: LegalLang }) {
  const sync = syncServerUrl() !== null;
  return lang === 'de' ? <PrivacyDe sync={sync} /> : <PrivacyEn sync={sync} />;
}

function PrivacyEn({ sync }: { sync: boolean }) {
  return (
    <Page lang="en">
      <h1>Privacy policy</h1>
      <LangSwitch page="privacy" lang="en" />
      <p className="lead">
        OpenTiles works on your device. There is no tracking, no advertising, no analytics and no
        cookies, so there is no cookie banner. Last updated {UPDATED}.
      </p>

      <h2>Who is responsible</h2>
      <p>
        {OPERATOR.name}, {OPERATOR.postalAddress}, <Mail />. See the{' '}
        <a href={href({ name: 'impressum', lang: 'en' })}>Impressum</a>.
      </p>

      <h2>What is stored on your device</h2>
      <p>
        Everything below stays in your browser's storage on this device. OpenTiles cannot see it.
        You can delete it at any time by deleting pieces in your library or by clearing this site's
        data in your browser settings.
      </p>
      <ul>
        <li>
          <strong>Your library</strong> (IndexedDB): each file you import, the notes converted from
          it, its title and file name, the import choices (tempo, transposition, hands) and the date
          you added it.
        </li>
        <li>
          <strong>Progress</strong> (IndexedDB): for each piece your best accuracy, number of runs,
          when you last played it and time practised, plus minutes practised per day.
        </li>
        <li>
          <strong>Settings</strong> (IndexedDB, with a small copy in local storage): language,
          accessibility options, foot-pedal keys, keyboard and fingering choices, whether note names
          are shown, whether crash reports are on, that you confirmed the import terms, and what you
          last chose on the practice screen (mode, hands, tempo, metronome).
        </li>
        <li>
          <strong>A note in local storage</strong> that you closed the “Add to Home Screen” hint.
        </li>
        <li>
          <strong>The app itself</strong> (Cache Storage): program files, public-domain scores and
          piano sounds, so OpenTiles works offline.
        </li>
      </ul>
      <p>
        <strong>Microphone.</strong> When you use an acoustic piano, the sound is analysed in your
        browser while you play. It is never recorded, stored or sent anywhere.
      </p>
      <p>
        <strong>MIDI keyboards</strong> send note messages to the browser on this device only.
      </p>

      <h2>Requests to the internet</h2>
      <p>
        The app loads its own files from the website it is served from. That web host receives the
        usual technical request data (IP address, time, requested file, browser) to deliver the
        pages; this is needed to show the website at all (Art. 6(1)(f) GDPR). OpenTiles adds nothing
        to these requests and loads nothing from other companies: no fonts, scripts or images from
        third parties.
      </p>

      <h2>Backup files</h2>
      <p>
        A backup is an encrypted file that your device creates and downloads to you. It is never
        uploaded anywhere. Without your passphrase nobody can read it, including us.
      </p>

      <h2>Optional sync</h2>
      {!sync && <p>This copy of OpenTiles has no sync service; nothing is synced.</p>}
      <p>
        If you switch sync on, your library is encrypted on your device with a key protected by your
        passphrase before anything is uploaded. The sync server (hosted in the EU) stores:
      </p>
      <ul>
        <li>your email address, to sign you in and to send sign-in links;</li>
        <li>
          encrypted records and their size, version and time of change — it cannot read titles, file
          names, files, progress or settings;
        </li>
        <li>the encrypted (wrapped) copy of your library key;</li>
        <li>public keys of your passkeys, and when they and your sessions were last used.</li>
      </ul>
      <p>
        It never receives your passphrase, your recovery code or the library key. Your IP address is
        used only in memory to limit abuse and is not stored. Request logs hold the method, the
        route pattern, the status and the duration. Legal basis: providing the service you asked for
        (Art. 6(1)(b) GDPR). Deleting your account in Settings removes the account and every stored
        record at once; sessions expire 90 days after last use.
      </p>

      <h2>Crash reports (off unless you switch them on)</h2>
      <p>
        If you switch on crash reports in Settings, an error that stops the app is sent to the sync
        server: the error message and a stack trace of the app's code, the app version and a coarse
        platform such as “iOS / Safari”. Titles, file names, links with ids and email addresses are
        removed on your device first and again on the server. Reports are not linked to an account
        or an IP address, are timed to the hour, and are deleted after 30 days. Legal basis: your
        consent (Art. 6(1)(a) GDPR), which you can withdraw in Settings at any time.
      </p>

      <h2>Your rights</h2>
      <p>
        You have the right to access, correct and delete your data, to restrict or object to its
        processing, to data portability and to withdraw consent. Most of this you can do yourself in
        the app. For anything else, write to <Mail />. You may also complain to a data protection
        authority, for example the one for North Rhine-Westphalia (LDI NRW).
      </p>
    </Page>
  );
}

function PrivacyDe({ sync }: { sync: boolean }) {
  return (
    <Page lang="de">
      <h1>Datenschutzerklärung</h1>
      <LangSwitch page="privacy" lang="de" />
      <p className="lead">
        OpenTiles arbeitet auf deinem Gerät. Es gibt kein Tracking, keine Werbung, keine
        Analysedienste und keine Cookies – deshalb auch keinen Cookie-Banner. Stand: {UPDATED}.
      </p>

      <h2>Verantwortlicher</h2>
      <p>
        {OPERATOR.name}, {OPERATOR.postalAddress}, <Mail />. Siehe{' '}
        <a href={href({ name: 'impressum', lang: 'de' })}>Impressum</a>.
      </p>

      <h2>Was auf deinem Gerät gespeichert wird</h2>
      <p>
        Alles Folgende bleibt im Speicher deines Browsers auf diesem Gerät. OpenTiles kann es nicht
        einsehen. Du kannst es jederzeit löschen, indem du Stücke aus deiner Bibliothek entfernst
        oder die Websitedaten in den Browsereinstellungen löschst.
      </p>
      <ul>
        <li>
          <strong>Deine Bibliothek</strong> (IndexedDB): jede importierte Datei, die daraus
          umgewandelten Noten, Titel und Dateiname, die Importeinstellungen (Tempo, Transposition,
          Hände) und das Datum des Imports.
        </li>
        <li>
          <strong>Fortschritt</strong> (IndexedDB): je Stück deine beste Trefferquote, die Zahl der
          Durchgänge, wann du es zuletzt gespielt hast und die Übezeit, dazu die Übeminuten je Tag.
        </li>
        <li>
          <strong>Einstellungen</strong> (IndexedDB, mit einer kleinen Kopie im Local Storage):
          Sprache, Barrierefreiheit, Fußpedal-Tasten, Tastatur- und Fingersatzwahl, ob Notennamen
          angezeigt werden, ob Absturzberichte eingeschaltet sind, dass du den Importbedingungen
          zugestimmt hast und was du zuletzt im Übungsbildschirm gewählt hast (Modus, Hände, Tempo,
          Metronom).
        </li>
        <li>
          <strong>Ein Vermerk im Local Storage</strong>, dass du den Hinweis „Zum Home-Bildschirm“
          geschlossen hast.
        </li>
        <li>
          <strong>Die App selbst</strong> (Cache Storage): Programmdateien, gemeinfreie Noten und
          Klavierklänge, damit OpenTiles offline funktioniert.
        </li>
      </ul>
      <p>
        <strong>Mikrofon.</strong> Wenn du ein akustisches Klavier nutzt, wird der Klang während des
        Spielens in deinem Browser ausgewertet. Er wird nie aufgenommen, gespeichert oder
        übertragen.
      </p>
      <p>
        <strong>MIDI-Keyboards</strong> senden Notenbefehle nur an den Browser auf diesem Gerät.
      </p>

      <h2>Anfragen ins Internet</h2>
      <p>
        Die App lädt ihre Dateien von der Website, über die sie ausgeliefert wird. Dieser Webhoster
        erhält dabei die üblichen technischen Daten (IP-Adresse, Zeitpunkt, abgerufene Datei,
        Browser), um die Seiten auszuliefern; das ist für die Anzeige der Website erforderlich (Art.
        6 Abs. 1 lit. f DSGVO). OpenTiles fügt diesen Anfragen nichts hinzu und lädt nichts von
        anderen Unternehmen: keine Schriften, Skripte oder Bilder von Dritten.
      </p>

      <h2>Sicherungsdateien</h2>
      <p>
        Eine Sicherung ist eine verschlüsselte Datei, die dein Gerät erstellt und dir zum
        Herunterladen gibt. Sie wird nirgendwohin hochgeladen. Ohne deine Passphrase kann sie
        niemand lesen, auch wir nicht.
      </p>

      <h2>Optionale Synchronisierung</h2>
      {!sync && (
        <p>
          Diese Ausgabe von OpenTiles hat keinen Synchronisierungsdienst; nichts wird übertragen.
        </p>
      )}
      <p>
        Wenn du die Synchronisierung einschaltest, wird deine Bibliothek vor jedem Hochladen auf
        deinem Gerät verschlüsselt, mit einem Schlüssel, den deine Passphrase schützt. Der
        Synchronisierungsserver (in der EU) speichert:
      </p>
      <ul>
        <li>deine E-Mail-Adresse, für die Anmeldung und zum Versand von Anmeldelinks;</li>
        <li>
          verschlüsselte Datensätze mit Größe, Version und Änderungszeit – Titel, Dateinamen,
          Dateien, Fortschritt und Einstellungen kann er nicht lesen;
        </li>
        <li>die verschlüsselte Kopie deines Bibliotheksschlüssels;</li>
        <li>
          öffentliche Schlüssel deiner Passkeys und wann diese und deine Sitzungen zuletzt genutzt
          wurden.
        </li>
      </ul>
      <p>
        Deine Passphrase, deinen Wiederherstellungscode und den Bibliotheksschlüssel erhält er nie.
        Deine IP-Adresse wird nur im Arbeitsspeicher zur Missbrauchsabwehr genutzt und nicht
        gespeichert. Protokolle enthalten Methode, Routenmuster, Status und Dauer einer Anfrage.
        Rechtsgrundlage: Erbringung des von dir gewünschten Dienstes (Art. 6 Abs. 1 lit. b DSGVO).
        Wenn du dein Konto in den Einstellungen löschst, werden das Konto und alle gespeicherten
        Datensätze auf einmal entfernt; Sitzungen laufen 90 Tage nach der letzten Nutzung ab.
      </p>

      <h2>Absturzberichte (nur wenn du sie einschaltest)</h2>
      <p>
        Wenn du Absturzberichte in den Einstellungen einschaltest, wird ein Fehler, der die App
        stoppt, an den Synchronisierungsserver gesendet: die Fehlermeldung und ein Stacktrace des
        App-Codes, die App-Version und eine grobe Plattformangabe wie „iOS / Safari“. Titel,
        Dateinamen, Links mit Kennungen und E-Mail-Adressen werden vorher auf deinem Gerät und noch
        einmal auf dem Server entfernt. Berichte werden keinem Konto und keiner IP-Adresse
        zugeordnet, nur stundengenau datiert und nach 30 Tagen gelöscht. Rechtsgrundlage: deine
        Einwilligung (Art. 6 Abs. 1 lit. a DSGVO), die du jederzeit in den Einstellungen widerrufen
        kannst.
      </p>

      <h2>Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft, Berichtigung und Löschung, auf Einschränkung der
        Verarbeitung, auf Widerspruch, auf Datenübertragbarkeit und auf Widerruf einer Einwilligung.
        Vieles davon kannst du direkt in der App erledigen. Für alles andere schreib an <Mail />. Du
        kannst dich außerdem bei einer Datenschutzaufsichtsbehörde beschweren, zum Beispiel bei der
        Landesbeauftragten für Datenschutz und Informationsfreiheit NRW.
      </p>
    </Page>
  );
}

export function Impressum({ lang }: { lang: LegalLang }) {
  return lang === 'de' ? <ImpressumDe /> : <ImpressumEn />;
}

function Address() {
  return (
    <address style={{ fontStyle: 'normal' }}>
      {OPERATOR.name}
      <br />
      <span className="placeholder">{OPERATOR.postalAddress}</span>
      <br />
      <Mail />
    </address>
  );
}

function ImpressumEn() {
  return (
    <Page lang="en">
      <h1>Impressum (legal notice)</h1>
      <LangSwitch page="impressum" lang="en" />
      <p className="muted">
        Information under § 5 DDG (German Digital Services Act). The German version is the binding
        one.
      </p>
      <h2>Operator</h2>
      <Address />
      <h2>Responsible for content</h2>
      <p>
        {OPERATOR.name} (address as above), under § 18(2) MStV (German Interstate Media Treaty).
      </p>
      <h2>Notice and takedown</h2>
      <p>
        If you believe a piece in the public catalogue is still protected by copyright, or that
        anything else on this site infringes your rights, email <Mail /> with the piece's title or
        link and why you believe it is protected. We remove the piece within 48 hours while we check
        the claim. Private libraries are stored only on users' own devices; we cannot see, list or
        remove their contents.
      </p>
      <h2>Open source</h2>
      <p>
        OpenTiles is free software under the GNU AGPL-3.0. There is no paid tier and no advertising.
      </p>
      <p>
        <a href={href({ name: 'privacy', lang: 'en' })}>Privacy policy</a>
      </p>
    </Page>
  );
}

function ImpressumDe() {
  return (
    <Page lang="de">
      <h1>Impressum</h1>
      <LangSwitch page="impressum" lang="de" />
      <p className="muted">Angaben gemäß § 5 DDG.</p>
      <h2>Anbieter</h2>
      <Address />
      <h2>Verantwortlich für den Inhalt</h2>
      <p>{OPERATOR.name} (Anschrift wie oben), gemäß § 18 Abs. 2 MStV.</p>
      <h2>Meldung von Rechtsverletzungen (Notice and Takedown)</h2>
      <p>
        Wenn du glaubst, dass ein Stück im öffentlichen Katalog noch urheberrechtlich geschützt ist
        oder etwas anderes auf dieser Website deine Rechte verletzt, schreib an <Mail /> mit dem
        Titel oder Link des Stücks und der Begründung. Wir entfernen das Stück innerhalb von 48
        Stunden, während wir den Hinweis prüfen. Private Bibliotheken liegen nur auf den Geräten der
        Nutzer; wir können ihren Inhalt weder sehen noch auflisten oder entfernen.
      </p>
      <h2>Freie Software</h2>
      <p>
        OpenTiles ist freie Software unter der GNU AGPL-3.0. Es gibt keine kostenpflichtige Version
        und keine Werbung.
      </p>
      <p>
        <a href={href({ name: 'privacy', lang: 'de' })}>Datenschutzerklärung</a>
      </p>
    </Page>
  );
}
