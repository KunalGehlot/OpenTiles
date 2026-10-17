// German strings for the app (P2-14), keyed by the English text. Informal "du", as in the privacy
// policy. Keep the placeholders ({n}, {title}, …) exactly as in the English key.
export const de: Readonly<Record<string, string>> = {
  // App shell
  Pieces: 'Stücke',
  'My library': 'Meine Bibliothek',
  'Find sheet music': 'Noten finden',
  'Detector Lab': 'Detektor-Labor',
  About: 'Über',
  Settings: 'Einstellungen',
  Main: 'Hauptmenü',
  'Loading…': 'Wird geladen …',
  Legal: 'Rechtliches',
  Privacy: 'Datenschutz',
  'Free and open source · no tracking · no cookies':
    'Frei und quelloffen · kein Tracking · keine Cookies',
  'OpenTiles opens in its own tab.': 'OpenTiles öffnet sich in einem eigenen Tab.',
  'Open OpenTiles': 'OpenTiles öffnen',
  // Home and catalogue
  'First steps': 'Erste Schritte',
  Beginner: 'Anfänger',
  Elementary: 'Grundstufe',
  Intermediate: 'Mittelstufe',
  Advanced: 'Fortgeschritten',
  Melody: 'Melodie',
  'Two hands': 'Zwei Hände',
  Full: 'Vollständig',
  'Right hand': 'Rechte Hand',
  'Could not load the catalogue ({status}).': 'Der Katalog konnte nicht geladen werden ({status}).',
  'This piece is not in the catalogue.': 'Dieses Stück ist nicht im Katalog.',
  'Could not load the score ({status}).': 'Die Noten konnten nicht geladen werden ({status}).',
  'Free piano practice': 'Kostenlos Klavier üben',
  'Pick a public-domain piece or bring your own MusicXML or MIDI file, then play it on a MIDI keyboard, an acoustic piano (microphone) or the on-screen keys. No account, no payment — your files never leave this device.':
    'Wähle ein gemeinfreies Stück oder bring deine eigene MusicXML- oder MIDI-Datei mit und spiel es auf einem MIDI-Keyboard, einem akustischen Klavier (Mikrofon) oder der Bildschirmtastatur. Kein Konto, keine Kosten – deine Dateien verlassen dieses Gerät nie.',
  Continue: 'Weiter',
  'Start here': 'Hier beginnen',
  'Level {n}': 'Stufe {n}',
  Practise: 'Üben',
  'Your practice': 'Dein Üben',
  'day streak': 'Tage in Folge',
  'min today': 'Min. heute',
  'piece mastered': 'Stück gemeistert',
  'pieces mastered': 'Stücke gemeistert',
  'Your path through the public-domain pieces': 'Dein Weg durch die gemeinfreien Stücke',
  'Start at first steps and work upwards. A level is complete when every piece in it reaches {percent} %.':
    'Fang bei den ersten Schritten an und arbeite dich nach oben. Eine Stufe ist geschafft, wenn jedes Stück darin {percent} % erreicht.',
  'Search pieces': 'Stücke suchen',
  'Search by title, composer or level': 'Nach Titel, Komponist oder Stufe suchen',
  'No piece matches “{query}”.': 'Kein Stück passt zu „{query}“.',
  '1 piece found': '1 Stück gefunden',
  '{n} pieces found': '{n} Stücke gefunden',
  'No reviewed pieces yet. Every catalogue piece is checked by a person before it appears here — you can help review pieces on GitHub.':
    'Noch keine geprüften Stücke. Jedes Katalogstück wird von einem Menschen geprüft, bevor es hier erscheint – du kannst auf GitHub beim Prüfen helfen.',
  'Difficulty path': 'Schwierigkeitsweg',
  complete: 'geschafft',
  '{mastered} of {total} mastered · {played} played':
    '{mastered} von {total} gemeistert · {played} gespielt',
  'Level {n} progress': 'Fortschritt Stufe {n}',
  'Your own music': 'Deine eigene Musik',
  'Import a MusicXML, MuseScore, ABC or MIDI file into your private library. It is converted and stored on this device only.':
    'Importiere eine MusicXML-, MuseScore-, ABC- oder MIDI-Datei in deine private Bibliothek. Sie wird nur auf diesem Gerät umgewandelt und gespeichert.',
  'Where to find free sheet music': 'Wo du kostenlose Noten findest',
  'Open my library': 'Meine Bibliothek öffnen',
  'Not played yet': 'Noch nicht gespielt',
  'Best {percent} %': 'Bestwert {percent} %',
  'Awaiting review': 'Wartet auf Prüfung',
  'Other levels of this song': 'Andere Stufen dieses Lieds',
  '{title}, level {n}': '{title}, Stufe {n}',
  'level {n}': 'Stufe {n}',
  'Copy link to {title}': 'Link zu {title} kopieren',
  'Link copied': 'Link kopiert',
  'Copy link': 'Link kopieren',
  'Link to {title}': 'Link zu {title}',
  // Library
  'Loading the note detector…': 'Notenerkennung wird geladen …',
  'Reading the recording…': 'Aufnahme wird gelesen …',
  'Listening for notes…': 'Noten werden herausgehört …',
  'This file is too large ({size} MB). The limit is {limit} MB.':
    'Diese Datei ist zu groß ({size} MB). Die Grenze liegt bei {limit} MB.',
  Untitled: 'Ohne Titel',
  'There is not enough storage left on this device to save this piece. Delete a piece you no longer need and try again.':
    'Auf diesem Gerät ist nicht mehr genug Speicher frei, um dieses Stück zu sichern. Lösche ein Stück, das du nicht mehr brauchst, und versuch es noch einmal.',
  'This piece could not be saved. Your browser may be blocking storage (a private window, for example).':
    'Dieses Stück konnte nicht gespeichert werden. Vielleicht blockiert dein Browser den Speicher (zum Beispiel in einem privaten Fenster).',
  'Your own scores, stored only on this device. Nothing here can be sent to anyone: OpenTiles has no way to share or publish your files.':
    'Deine eigenen Noten, nur auf diesem Gerät gespeichert. Nichts davon kann an jemanden gesendet werden: OpenTiles kann deine Dateien weder teilen noch veröffentlichen.',
  'Add a score, sheet music or a recording': 'Noten, ein Notenblatt oder eine Aufnahme hinzufügen',
  'MusicXML, MuseScore, ABC or MIDI, a PDF of the sheet music, or a recording of a piano. Pick or drop several files at once.':
    'MusicXML, MuseScore, ABC oder MIDI, ein PDF der Noten oder eine Klavieraufnahme. Du kannst mehrere Dateien auf einmal auswählen oder hierher ziehen.',
  'Import a file…': 'Datei importieren …',
  'Which files can I import?': 'Welche Dateien kann ich importieren?',
  'MusicXML (.musicxml, .xml, .mxl), MuseScore (.mscz, .mscx), ABC (.abc) or MIDI (.mid). You can also import a recording (.wav, .mp3, .m4a, .ogg, .flac); its notes are detected on this device and are only approximate.':
    'MusicXML (.musicxml, .xml, .mxl), MuseScore (.mscz, .mscx), ABC (.abc) oder MIDI (.mid). Du kannst auch eine Aufnahme importieren (.wav, .mp3, .m4a, .ogg, .flac); ihre Noten werden auf diesem Gerät erkannt und sind nur ungefähr.',
  'Importing a recording': 'Aufnahme wird importiert',
  'Recording import progress': 'Fortschritt des Aufnahme-Imports',
  'Notes detected from a recording are approximate: some may be missing or wrong, and the rhythm is a guess. You can check them on the next screen.':
    'Aus einer Aufnahme erkannte Noten sind ungefähr: Manche können fehlen oder falsch sein, und der Rhythmus ist geschätzt. Du kannst sie im nächsten Schritt prüfen.',
  Cancel: 'Abbrechen',
  'To keep your library safe on iPad and iPhone, tap Share → Add to Home Screen and open OpenTiles from there. Safari may otherwise clear site data after a week without a visit.':
    'Damit deine Bibliothek auf iPad und iPhone sicher bleibt, tippe auf Teilen → Zum Home-Bildschirm und öffne OpenTiles von dort. Sonst kann Safari Website-Daten nach einer Woche ohne Besuch löschen.',
  'Search your library': 'Deine Bibliothek durchsuchen',
  'Search by title, file name or tag': 'Nach Titel, Dateiname oder Schlagwort suchen',
  'No piece in your library matches “{query}”.':
    'Kein Stück in deiner Bibliothek passt zu „{query}“.',
  'Nothing here yet.': 'Noch nichts hier.',
  'Pieces you import appear here and stay on this device. They are never added to the public catalogue.':
    'Importierte Stücke erscheinen hier und bleiben auf diesem Gerät. Sie kommen nie in den öffentlichen Katalog.',
  'added {date}': 'hinzugefügt am {date}',
  'Delete “{title}” from this device?': '„{title}“ von diesem Gerät löschen?',
  Delete: 'Löschen',
  'Before your first import': 'Vor deinem ersten Import',
  'Your library is private: files stay on this device and OpenTiles has no way to share them. Please only import music you have the right to use for your own practice — for example scores you bought, wrote or transcribed yourself, or public-domain music.':
    'Deine Bibliothek ist privat: Dateien bleiben auf diesem Gerät und OpenTiles kann sie nicht teilen. Bitte importiere nur Musik, die du zum eigenen Üben verwenden darfst – zum Beispiel gekaufte, selbst geschriebene oder selbst abgeschriebene Noten oder gemeinfreie Musik.',
  'I only import files I have the right to use for personal practice.':
    'Ich importiere nur Dateien, die ich zum persönlichen Üben verwenden darf.',
  'Check the import': 'Import prüfen',
  Approximate: 'Ungefähr',
  'Transcribed from a recording on this device.':
    'Auf diesem Gerät aus einer Aufnahme herausgehört.',
  Title: 'Titel',
  '{notes} notes in {bars} bars · right hand {right}, left hand {left}':
    '{notes} Noten in {bars} Takten · rechte Hand {right}, linke Hand {left}',
  'range {low}–{high}': 'Umfang {low}–{high}',
  'Estimated from speed, rhythm, chords, hand stretch, key and hand independence':
    'Geschätzt aus Tempo, Rhythmus, Akkorden, Handspanne, Tonart und Unabhängigkeit der Hände',
  'Estimated level {n} of 5': 'Geschätzte Stufe {n} von 5',
  Tempo: 'Tempo',
  'beats per minute': 'Schläge pro Minute',
  Transpose: 'Transponieren',
  '{n} semitones': '{n} Halbtöne',
  Hands: 'Hände',
  'Swap hands': 'Hände tauschen',
  'Hand split point': 'Teilungspunkt der Hände',
  'Save to my library': 'In meiner Bibliothek speichern',
  // Import messages from the shared packages
  'No notes were detected in this recording.': 'In dieser Aufnahme wurden keine Noten erkannt.',
  'This .mscz file could not be unzipped.': 'Diese .mscz-Datei konnte nicht entpackt werden.',
  'No score was found inside this .mscz file.':
    'In dieser .mscz-Datei wurden keine Noten gefunden.',
  'This does not look like a MuseScore file.': 'Das sieht nicht nach einer MuseScore-Datei aus.',
  'Files from MuseScore 1 are not supported. Open the file in a current MuseScore and save it again, or export it as MusicXML.':
    'Dateien aus MuseScore 1 werden nicht unterstützt. Öffne die Datei in einem aktuellen MuseScore und speichere sie neu oder exportiere sie als MusicXML.',
  'This MuseScore file contains no score.': 'Diese MuseScore-Datei enthält keine Noten.',
  'This MuseScore file contains no music.': 'Diese MuseScore-Datei enthält keine Musik.',
  'This does not look like ABC notation (no X: or K: field).':
    'Das sieht nicht nach ABC-Notation aus (kein X:- oder K:-Feld).',
  'MuseScore files are opened with the MuseScore importer.':
    'MuseScore-Dateien werden mit dem MuseScore-Import geöffnet.',
  'This file is empty.': 'Diese Datei ist leer.',
  'Timewise MusicXML is not supported yet. Export as partwise MusicXML.':
    'Timewise-MusicXML wird noch nicht unterstützt. Exportiere als partwise-MusicXML.',
  'This does not look like a MusicXML score.': 'Das sieht nicht nach MusicXML-Noten aus.',
  'This score has no parts.': 'Diese Noten haben keine Stimmen.',
  'This file is too large to open.': 'Diese Datei ist zu groß zum Öffnen.',
  'This file could not be unzipped.': 'Diese Datei konnte nicht entpackt werden.',
  'This .mxl file could not be unzipped.': 'Diese .mxl-Datei konnte nicht entpackt werden.',
  'No score was found inside this .mxl file.': 'In dieser .mxl-Datei wurden keine Noten gefunden.',
  'This MIDI file is cut short.': 'Diese MIDI-Datei ist unvollständig.',
  'This MIDI file has a malformed length.': 'Diese MIDI-Datei hat eine fehlerhafte Längenangabe.',
  'This is not a MIDI file.': 'Das ist keine MIDI-Datei.',
  'MIDI files with SMPTE timing are not supported.':
    'MIDI-Dateien mit SMPTE-Zeitbasis werden nicht unterstützt.',
  'This MIDI file is malformed (running status).':
    'Diese MIDI-Datei ist fehlerhaft (Running Status).',
  'No piano parts were found, so all non-drum instruments were kept.':
    'Es wurden keine Klavierstimmen gefunden, daher wurden alle Instrumente außer Schlagzeug behalten.',
  'Drums and non-piano instruments were left out.':
    'Schlagzeug und andere Instrumente als Klavier wurden weggelassen.',
  'This MIDI file contains no notes to play.': 'Diese MIDI-Datei enthält keine spielbaren Noten.',
  'No XML parser is available in this environment.':
    'In dieser Umgebung ist kein XML-Parser verfügbar.',
  'This file is not valid XML.': 'Diese Datei ist kein gültiges XML.',
  // Practice screen
  'This piece is not in your library on this device.':
    'Dieses Stück ist nicht in deiner Bibliothek auf diesem Gerät.',
  'Back to pieces': 'Zurück zu den Stücken',
  'Microphone: {message}': 'Mikrofon: {message}',
  'The microphone could not be started.': 'Das Mikrofon konnte nicht gestartet werden.',
  'A MIDI keyboard is connected': 'Ein MIDI-Keyboard ist verbunden',
  'no device connected': 'kein Gerät verbunden',
  'Measure keyboard delay': 'Verzögerung des Keyboards messen',
  'Calibrate timing': 'Timing kalibrieren',
  'Connect MIDI keyboard': 'MIDI-Keyboard verbinden',
  'Microphone listening': 'Mikrofon hört zu',
  'Set up microphone': 'Mikrofon einrichten',
  'Starting…': 'Wird gestartet …',
  'Use microphone': 'Mikrofon verwenden',
  Options: 'Optionen',
  'Keyboard size': 'Tastaturgröße',
  'Fit piece': 'Ans Stück anpassen',
  'Custom ({n})': 'Eigene ({n})',
  Fingers: 'Finger',
  Fingering: 'Fingersatz',
  Suggested: 'Vorgeschlagen',
  'As written': 'Wie notiert',
  Off: 'Aus',
  'The on-screen keys and the computer keys A–; always play. Pieces are moved by octaves to fit the keyboard you choose.':
    'Die Bildschirmtasten und die Computertasten A–Ö spielen immer. Stücke werden um Oktaven verschoben, damit sie auf die gewählte Tastatur passen.',
  'All settings': 'Alle Einstellungen',
  Mode: 'Modus',
  Wait: 'Warten',
  Listen: 'Anhören',
  'Play along': 'Mitspielen',
  Stop: 'Stopp',
  Play: 'Abspielen',
  Start: 'Start',
  Restart: 'Neu starten',
  Left: 'Links',
  Both: 'Beide',
  Right: 'Rechts',
  'Play other hand': 'Andere Hand mitspielen',
  'Loop a range of bars (or drag across the falling notes)':
    'Takte in Schleife üben (oder über die fallenden Noten ziehen)',
  Loop: 'Schleife',
  'Practice tempo': 'Übungstempo',
  'Step {step}/{count}': 'Schritt {step}/{count}',
  'Falling notes and piano keyboard': 'Fallende Noten und Klaviertastatur',
  'Well played!': 'Gut gespielt!',
  'Accuracy {percent} %': 'Genauigkeit {percent} %',
  accuracy: 'Genauigkeit',
  'timing ±{ms} ms': 'Timing ±{ms} ms',
  '{hit} on time, {early} early, {late} late, {missed} missed':
    '{hit} pünktlich, {early} zu früh, {late} zu spät, {missed} verpasst',
  '{n} extra': '{n} zusätzlich',
  'Hardest bars: {bars}': 'Schwierigste Takte: {bars}',
  'Held well: {good} of {count}': 'Gut gehalten: {good} von {count}',
  '{n} too short': '{n} zu kurz',
  '{n} too long': '{n} zu lang',
  'Play again': 'Noch einmal spielen',
  'Choose another piece': 'Anderes Stück wählen',
  // Settings model
  'Right arrow': 'Pfeil nach rechts',
  'Left arrow': 'Pfeil nach links',
  'Down arrow': 'Pfeil nach unten',
  'Up arrow': 'Pfeil nach oben',
  'Page Down': 'Bild ab',
  'Page Up': 'Bild auf',
  Space: 'Leertaste',
  Enter: 'Eingabetaste',
  '{n} keys ({low}–{high})': '{n} Tasten ({low}–{high})',
  '1 note moved by octaves to fit your {keys}-key keyboard.':
    '1 Note wurde um Oktaven verschoben, damit sie auf deine Tastatur mit {keys} Tasten passt.',
  '{n} notes moved by octaves to fit your {keys}-key keyboard.':
    '{n} Noten wurden um Oktaven verschoben, damit sie auf deine Tastatur mit {keys} Tasten passen.',
  'Moved up an octave to fit your {keys}-key keyboard':
    'Eine Oktave nach oben verschoben, damit es auf deine Tastatur mit {keys} Tasten passt',
  'Moved down an octave to fit your {keys}-key keyboard':
    'Eine Oktave nach unten verschoben, damit es auf deine Tastatur mit {keys} Tasten passt',
  'Moved up {octaves} octaves to fit your {keys}-key keyboard':
    '{octaves} Oktaven nach oben verschoben, damit es auf deine Tastatur mit {keys} Tasten passt',
  'Moved down {octaves} octaves to fit your {keys}-key keyboard':
    '{octaves} Oktaven nach unten verschoben, damit es auf deine Tastatur mit {keys} Tasten passt',
  '1 note was also moved into range.': '1 Note wurde zusätzlich in den Tastenumfang verschoben.',
  '{n} notes were also moved into range.':
    '{n} Noten wurden zusätzlich in den Tastenumfang verschoben.',
  'Start or pause playback (not in wait mode)':
    'Wiedergabe starten oder pausieren (nicht im Wartemodus)',
  'Start the piece again': 'Stück von vorn beginnen',
  'Play notes from C upwards, like piano keys': 'Noten ab C aufwärts spielen, wie Klaviertasten',
  'Move the computer-keyboard octave down / up':
    'Oktave der Computertastatur nach unten / oben verschieben',
  'Tab / Shift+Tab': 'Tab / Umschalt+Tab',
  'Move between buttons and controls': 'Zwischen Schaltflächen und Bedienelementen wechseln',
  'Pedal keys': 'Pedaltasten',
  'Turn the page forward / back when the foot pedal is switched on':
    'Vor- / zurückblättern, wenn das Fußpedal eingeschaltet ist',
  // Settings page
  'Settings are kept on this device.': 'Einstellungen werden auf diesem Gerät gespeichert.',
  Language: 'Sprache',
  'Privacy and legal': 'Datenschutz und Rechtliches',
  'About OpenTiles': 'Über OpenTiles',
  'Same as this device': 'Wie dieses Gerät',
  On: 'An',
  Practice: 'Üben',
  'Your keyboard': 'Deine Tastatur',
  'The practice screen draws the keys your instrument has. A piece that goes beyond them is moved by octaves so you can still play it, and the screen says so.':
    'Der Übungsbildschirm zeigt die Tasten, die dein Instrument hat. Geht ein Stück darüber hinaus, wird es um Oktaven verschoben, damit du es trotzdem spielen kannst – und der Bildschirm sagt es dir.',
  'Fit the keys to each piece': 'Tasten an jedes Stück anpassen',
  Custom: 'Eigene',
  'Lowest key': 'Tiefste Taste',
  'Fingers to show': 'Angezeigte Finger',
  'Suggested fingers follow common piano fingering and keep any the score already has. They appear on the falling notes, the keys to play next and, lighter, in the score.':
    'Vorgeschlagene Finger folgen gängigem Klavierfingersatz und behalten die, die schon in den Noten stehen. Sie erscheinen auf den fallenden Noten, auf den nächsten Tasten und, heller, in den Noten.',
  'Suggested where the score has none': 'Vorgeschlagen, wo die Noten keine haben',
  'Only those written in the score': 'Nur die in den Noten',
  None: 'Keine',
  'Note names': 'Notennamen',
  'Sound could not be started in this browser, so the microphone cannot listen. Check that a sound output is connected and try again.':
    'Der Ton konnte in diesem Browser nicht gestartet werden, deshalb kann das Mikrofon nicht zuhören. Prüfe, ob ein Audioausgang angeschlossen ist, und versuche es noch einmal.',
  'Show the name of each note at the top of the falling notes and on the keys to play. The fingers stay where they are.':
    'Den Namen jeder Note oben auf den fallenden Noten und auf den Tasten zeigen, die zu spielen sind. Die Finger bleiben, wo sie sind.',
  'How note names are written': 'Schreibweise der Notennamen',
  'On the falling notes, the keys and everywhere else the app names a note. Middle C is C4 (Do4) in every style.':
    'Auf den fallenden Noten, den Tasten und überall sonst, wo die App eine Note nennt. Das mittlere C heißt in jeder Schreibweise C4 (Do4).',
  'As the language: {names}': 'Wie die Sprache: {names}',
  'Letters: C D E F G A B': 'Englisch: C D E F G A B',
  'German: C D E F G A H, with B for B♭': 'Deutsch: C D E F G A H, B für B♭',
  'Fixed do: Do Re Mi Fa Sol La Si': 'Solmisation (festes Do): Do Re Mi Fa Sol La Si',
  'Black keys': 'Schwarze Tasten',
  'How the black keys are named on the falling notes and the keys: as the key signature has them, or always with sharps or flats.':
    'Wie die schwarzen Tasten auf den fallenden Noten und den Tasten heißen: wie in der Tonart oder immer mit Kreuz oder b.',
  'As the key': 'Wie die Tonart',
  'Sharps (♯)': 'Mit Kreuz (♯)',
  'Flats (♭)': 'Mit b (♭)',
  'Down a semitone': 'Einen Halbton tiefer',
  'Up a semitone': 'Einen Halbton höher',
  'Transposed up a semitone.': 'Einen Halbton höher transponiert.',
  'Transposed down a semitone.': 'Einen Halbton tiefer transponiert.',
  'Transposed up {n} semitones.': 'Um {n} Halbtöne höher transponiert.',
  'Transposed down {n} semitones.': 'Um {n} Halbtöne tiefer transponiert.',
  'Number of keys': 'Anzahl der Tasten',
  Accessibility: 'Barrierefreiheit',
  'Large print': 'Große Schrift',
  'Bigger text, buttons and keyboard labels.':
    'Größere Schrift, Schaltflächen und Tastenbeschriftungen.',
  Appearance: 'Darstellung',
  Light: 'Hell',
  Dark: 'Dunkel',
  'High contrast': 'Hoher Kontrast',
  'Reduce motion': 'Bewegung reduzieren',
  'Left-handed layout': 'Linkshänder-Anordnung',
  'Practice controls on the left.': 'Übungs-Bedienelemente links.',
  'Foot pedal page turn': 'Umblättern mit Fußpedal',
  'Bluetooth page-turn pedals connect like a keyboard. Choose the keys your pedal sends, or press the pedal after “Detect key”.':
    'Bluetooth-Umblätterpedale verbinden sich wie eine Tastatur. Wähle die Tasten, die dein Pedal sendet, oder tritt das Pedal nach „Taste erkennen“.',
  'Turn pages with a foot pedal': 'Mit einem Fußpedal umblättern',
  'Next page': 'Nächste Seite',
  'Previous page': 'Vorige Seite',
  'Keyboard shortcuts': 'Tastenkürzel',
  Keys: 'Tasten',
  'What they do': 'Was sie tun',
  'Press the pedal…': 'Pedal treten …',
  'Detect key': 'Taste erkennen',
  'Crash reports': 'Absturzberichte',
  "Off unless you switch them on. When on, an error that stops the app sends the error message and where in the app's code it happened. Titles, file names, links and email addresses are removed first, and reports are not linked to you.":
    'Aus, solange du sie nicht einschaltest. Wenn sie an sind, sendet ein Fehler, der die App stoppt, die Fehlermeldung und die Stelle im Code der App. Titel, Dateinamen, Links und E-Mail-Adressen werden vorher entfernt, und Berichte werden nicht mit dir verknüpft.',
  Details: 'Details',
  'Send anonymous crash reports': 'Anonyme Absturzberichte senden',
  // Loop and phrases
  'Loop a section': 'Abschnitt in Schleife üben',
  'Loop bars': 'Takte in Schleife',
  'From bar': 'Von Takt',
  to: 'bis',
  'To bar': 'Bis Takt',
  'Whole piece': 'Ganzes Stück',
  'After every run with no wrong or missed notes, play 5 % faster, up to 100 %':
    'Nach jedem Durchgang ohne falsche oder verpasste Noten 5 % schneller spielen, bis 100 %',
  'Speed up after clean runs': 'Nach fehlerfreien Durchgängen schneller werden',
  'Phrase by phrase': 'Phrase für Phrase',
  Phrase: 'Phrase',
  'Previous phrase': 'Vorige Phrase',
  'Phrase {n} of {count}': 'Phrase {n} von {count}',
  'Next phrase': 'Nächste Phrase',
  'Looping bars {from}–{to}': 'Takte {from}–{to} in Schleife',
  'Run {n}: {result}': 'Durchgang {n}: {result}',
  clean: 'fehlerfrei',
  'tempo up to {tempo}': 'Tempo auf {tempo} erhöht',
  'That phrase is secure.': 'Diese Phrase sitzt.',
  'Every phrase is secure. Try the whole piece!':
    'Jede Phrase sitzt. Versuch jetzt das ganze Stück!',
  // Listen back and metronome
  'as played': 'wie gespielt',
  polished: 'geglättet',
  'Could not make the file: {message}': 'Die Datei konnte nicht erstellt werden: {message}',
  'Could not make the file.': 'Die Datei konnte nicht erstellt werden.',
  'Listen to your performance': 'Dein Spiel anhören',
  'Listen to your performance:': 'Dein Spiel anhören:',
  Version: 'Fassung',
  'As played': 'Wie gespielt',
  Polished: 'Geglättet',
  'Exactly what you played, wrong notes and all':
    'Genau das, was du gespielt hast, mit allen falschen Noten',
  'Your notes and dynamics, exactly in time and held for their full length':
    'Deine Noten und Lautstärken, genau im Takt und in voller Länge gehalten',
  'Making the file…': 'Datei wird erstellt …',
  'Save as WAV': 'Als WAV speichern',
  'Metronome on: clicks on every beat, accented on the first beat of the bar':
    'Metronom an: klickt auf jedem Schlag, betont auf dem ersten Schlag des Takts',
  'Metronome off': 'Metronom aus',
  Metronome: 'Metronom',
  'Click volume': 'Lautstärke des Klicks',
  // Microphone set-up
  'The level is good.': 'Der Pegel ist gut.',
  'The piano sounds quiet. Move the device closer to the piano if notes are missed.':
    'Das Klavier klingt leise. Stell das Gerät näher ans Klavier, wenn Noten überhört werden.',
  'The piano is very loud for this microphone. Move the device a little further away.':
    'Das Klavier ist für dieses Mikrofon sehr laut. Stell das Gerät etwas weiter weg.',
  'The room is noisy. Notes may be missed or misheard; a quieter room helps.':
    'Der Raum ist laut. Noten können überhört oder falsch erkannt werden; ein ruhigerer Raum hilft.',
  'No keys were heard, so the level could not be checked.':
    'Es wurden keine Tasten gehört, daher konnte der Pegel nicht geprüft werden.',
  'middle C': 'das mittlere C',
  'the low {note}': 'das tiefe {note}',
  'the high {note}': 'das hohe {note}',
  'Microphone set-up': 'Mikrofon einrichten',
  'Set up the microphone': 'Mikrofon einrichten',
  'About 10 seconds: first stay quiet for 2 seconds, then play three keys when asked. This tunes note detection to your piano and room.':
    'Etwa 10 Sekunden: Sei zuerst 2 Sekunden still, dann spiel drei Tasten, wenn du dazu aufgefordert wirst. So wird die Notenerkennung auf dein Klavier und deinen Raum abgestimmt.',
  Skip: 'Überspringen',
  'Stay quiet for 2 seconds…': '2 Sekunden still sein …',
  'Play {key} ({note}) and let it ring.': 'Spiel {key} ({note}) und lass ihn klingen.',
  'Key {n} of {count}': 'Taste {n} von {count}',
  'heard {notes}': 'gehört: {notes}',
  'Skip this key': 'Diese Taste überspringen',
  'Skip set-up': 'Einrichtung überspringen',
  'Optional: check the delay of the microphone. Turn the speakers up; the app plays 8 clicks and listens for them (5 seconds).':
    'Optional: die Verzögerung des Mikrofons prüfen. Dreh die Lautsprecher auf; die App spielt 8 Klicks und hört auf sie (5 Sekunden).',
  'Check delay': 'Verzögerung prüfen',
  'Not now': 'Jetzt nicht',
  'Listening for the clicks… keep quiet.': 'Hört auf die Klicks … bitte still sein.',
  'Piano tuning: {cents} cents from A = 440 Hz':
    'Stimmung des Klaviers: {cents} Cent gegenüber A = 440 Hz',
  'Microphone delay: {ms} ms': 'Verzögerung des Mikrofons: {ms} ms',
  'Saved for this microphone on this device.': 'Für dieses Mikrofon auf diesem Gerät gespeichert.',
  Done: 'Fertig',
  // Keyboard timing
  'MIDI latency': 'MIDI-Verzögerung',
  'Keyboard timing': 'Timing des Keyboards',
  'The app plays {n} clicks. Press any key on your keyboard exactly on each click. This measures the delay between your keyboard and this device, so play-along can judge your timing fairly.':
    'Die App spielt {n} Klicks. Drück bei jedem Klick genau gleichzeitig eine beliebige Taste auf deinem Keyboard. So wird die Verzögerung zwischen deinem Keyboard und diesem Gerät gemessen, damit das Mitspielen dein Timing fair beurteilt.',
  'Press any key on each click.': 'Drück bei jedem Klick eine Taste.',
  '{n} key presses': '{n} Tastendrücke',
  'Only {matched} of {n} clicks were answered. Try again and press a key on each click.':
    'Nur {matched} von {n} Klicks wurden beantwortet. Versuch es noch einmal und drück bei jedem Klick eine Taste.',
  'Your keyboard is about {ms} ms behind the clicks ({matched} of {n} clicks). Play-along will allow for this on this keyboard.':
    'Dein Keyboard liegt etwa {ms} ms hinter den Klicks ({matched} von {n} Klicks). Beim Mitspielen wird das für dieses Keyboard berücksichtigt.',
  Save: 'Speichern',
  'Try again': 'Noch einmal',
  // Score views
  'Pieces made from a recording have no printed score, so they are shown as falling notes.':
    'Aus einer Aufnahme erstellte Stücke haben keine gedruckten Noten, daher werden sie als fallende Noten gezeigt.',
  'The score view cannot draw MuseScore files yet, so this piece is shown as falling notes.':
    'Die Notenansicht kann MuseScore-Dateien noch nicht darstellen, daher wird dieses Stück als fallende Noten gezeigt.',
  'The original score file is missing, so only falling notes are shown.':
    'Die ursprüngliche Notendatei fehlt, daher werden nur fallende Noten gezeigt.',
  'This score file could not be read for the score view.':
    'Diese Notendatei konnte für die Notenansicht nicht gelesen werden.',
  View: 'Ansicht',
  'Falling notes': 'Fallende Noten',
  Score: 'Noten',
  'The score could not be drawn on this device. The falling-notes view still works.':
    'Die Noten konnten auf diesem Gerät nicht gezeichnet werden. Die Ansicht mit fallenden Noten funktioniert weiterhin.',
  'Score, page view': 'Noten, Seitenansicht',
  'Score, scrolling': 'Noten, fortlaufend',
  'Drawing the score…': 'Noten werden gezeichnet …',
  'The score is shown, but its notes could not be matched to the music, so they are not coloured.':
    'Die Noten werden angezeigt, konnten aber nicht der Musik zugeordnet werden, daher sind sie nicht eingefärbt.',
  'Page {n} of {count}': 'Seite {n} von {count}',
  // The learner's own sheet music (ADR 0018)
  Sheet: 'Notenblatt',
  'Your sheet music': 'Deine Noten',
  'Zoom out': 'Verkleinern',
  'Zoom in': 'Vergrößern',
  'Fit the page to the width': 'Seite an die Breite anpassen',
  'Opening the sheet music…': 'Noten werden geöffnet …',
  'The sheet music could not be opened on this device.':
    'Die Noten konnten auf diesem Gerät nicht geöffnet werden.',
  'Finding the bars…': 'Takte werden gesucht …',
  'The bars of this sheet could not be found.':
    'Die Takte dieser Noten konnten nicht gefunden werden.',
  'No bars were found on this sheet, so the highlight cannot follow the music. The pages can still be read.':
    'Auf diesem Notenblatt wurden keine Takte gefunden, daher kann die Markierung der Musik nicht folgen. Die Seiten lassen sich trotzdem lesen.',
  'Adjust bars': 'Takte anpassen',
  'Fix where the highlight goes': 'Korrigieren, wo die Markierung steht',
  'Tap a bar to go to it. Tap a wrong barline to remove it. For a missing barline, tap where it belongs, then Add a barline here.':
    'Tippe auf einen Takt, um dorthin zu gehen. Tippe auf einen falschen Taktstrich, um ihn zu entfernen. Für einen fehlenden Taktstrich tippe an die Stelle, an die er gehört, dann auf „Taktstrich hier einfügen“.',
  'Add a barline here': 'Taktstrich hier einfügen',
  Undo: 'Rückgängig',
  'From this bar on, the highlight is': 'Ab diesem Takt ist die Markierung',
  'a bar ahead': 'einen Takt voraus',
  'a bar behind': 'einen Takt zurück',
  'Find the bars again': 'Takte neu suchen',
  'Add the MIDI file of this piece to practise it with falling notes and feedback.':
    'Füge die MIDI-Datei dieses Stücks hinzu, um es mit fallenden Noten und Rückmeldung zu üben.',
  'This score was made from the MIDI file and may differ from the printed music.':
    'Diese Noten wurden aus der MIDI-Datei erstellt und können von der gedruckten Ausgabe abweichen.',
  // Canvas, app notices and errors
  early: 'zu früh',
  late: 'zu spät',
  'hold longer': 'länger halten',
  'let go': 'loslassen',
  'Add OpenTiles to your Home Screen': 'OpenTiles zum Home-Bildschirm hinzufügen',
  'Add OpenTiles to your Home Screen.': 'Füge OpenTiles zum Home-Bildschirm hinzu.',
  'Tap the Share button, then Add to Home Screen, and open OpenTiles from its icon. It then opens full screen, works offline and keeps your library and progress safe on this {device}. In a normal browser tab, Safari may delete them after seven days without a visit.':
    'Tippe auf die Teilen-Taste, dann auf „Zum Home-Bildschirm“, und öffne OpenTiles über sein Symbol. Dann läuft es im Vollbild, funktioniert offline und hält deine Bibliothek und deinen Fortschritt auf diesem {device} sicher. In einem normalen Browser-Tab kann Safari sie nach sieben Tagen ohne Besuch löschen.',
  'Got it': 'Verstanden',
  'Update available': 'Update verfügbar',
  'Reloading…': 'Wird neu geladen …',
  Reload: 'Neu laden',
  Dismiss: 'Schließen',
  'Something went wrong on this screen': 'Auf diesem Bildschirm ist etwas schiefgegangen',
  'Your pieces and settings are safe on this device. Reloading usually fixes it, for example after OpenTiles was updated while this page was open.':
    'Deine Stücke und Einstellungen sind auf diesem Gerät sicher. Neu laden hilft meistens, zum Beispiel wenn OpenTiles aktualisiert wurde, während diese Seite offen war.',
  'That passphrase or recovery code does not open this. Check it and try again.':
    'Diese Passphrase oder dieser Wiederherstellungscode öffnet das nicht. Prüf die Eingabe und versuch es noch einmal.',
  'This file is damaged or is not an OpenTiles backup.':
    'Diese Datei ist beschädigt oder keine OpenTiles-Sicherung.',
  'This was made by a newer version of OpenTiles. Update the app and try again.':
    'Das wurde mit einer neueren Version von OpenTiles erstellt. Aktualisiere die App und versuch es noch einmal.',
  'The recovery code looks mistyped: {problem}.':
    'Der Wiederherstellungscode scheint falsch eingegeben: {problem}.',
  'The passphrase must be at least 8 characters long.':
    'Die Passphrase muss mindestens 8 Zeichen lang sein.',
  'The request was cancelled.': 'Die Anfrage wurde abgebrochen.',
  'Could not reach the server. Check your connection and try again.':
    'Der Server ist nicht erreichbar. Prüf deine Verbindung und versuch es noch einmal.',
  'Untitled recording': 'Aufnahme ohne Titel',
  'This browser has no MIDI support.': 'Dieser Browser unterstützt kein MIDI.',
  'This browser does not support Web Audio.': 'Dieser Browser unterstützt kein Web Audio.',
  'This browser cannot render audio files.': 'Dieser Browser kann keine Audiodateien erzeugen.',
  // Find sheet music
  'Classical pieces typeset by volunteers, most of them in the public domain or under Creative Commons. Every piece has a MIDI file, so it opens in OpenTiles straight away.':
    'Klassische Stücke, von Freiwilligen gesetzt, die meisten gemeinfrei oder unter Creative Commons. Zu jedem Stück gibt es eine MIDI-Datei, die sich direkt in OpenTiles öffnen lässt.',
  'Public-domain music transcribed by volunteers and released as CC0, published on MuseScore.com. Download MusicXML or MuseScore files.':
    'Gemeinfreie Musik, von Freiwilligen übertragen und als CC0 veröffentlicht, auf MuseScore.com. Lade MusicXML- oder MuseScore-Dateien herunter.',
  'The largest library of public-domain scores. Most files are scanned PDFs: OpenTiles can keep one with a piece and show it as your sheet music, but the notes come from a MIDI or score file, which some pieces also have. Check the copyright note on each file for your country.':
    'Die größte Bibliothek gemeinfreier Noten. Die meisten Dateien sind eingescannte PDFs: OpenTiles kann eines mit einem Stück speichern und dir als Notenblatt zeigen, die Noten kommen aber aus einer MIDI- oder Notendatei, die es zu manchen Stücken auch gibt. Prüf den Urheberrechtshinweis jeder Datei für dein Land.',
  'mostly PDF; some MusicXML and MIDI': 'meist PDF; teils MusicXML und MIDI',
  'Public-domain sheet music and recordings, free to download.':
    'Gemeinfreie Noten und Aufnahmen zum kostenlosen Herunterladen.',
  'mostly PDF': 'meist PDF',
  'Free choral scores, many with a piano reduction, released under open licences by their editors.':
    'Kostenlose Chornoten, viele mit Klavierauszug, von ihren Herausgebern unter offenen Lizenzen veröffentlicht.',
  'PDF, MusicXML, MIDI (varies)': 'PDF, MusicXML, MIDI (unterschiedlich)',
  'Traditional Irish and folk tunes written in ABC notation, which OpenTiles imports. Melody only.':
    'Traditionelle irische Melodien und Volkslieder in ABC-Notation, die OpenTiles importiert. Nur die Melodie.',
  'A search engine for folk and traditional tunes in ABC notation.':
    'Eine Suchmaschine für Volks- und traditionelle Melodien in ABC-Notation.',
  'Traditional carols, with free arrangements for piano.':
    'Traditionelle Weihnachtslieder mit kostenlosen Klaviersätzen.',
  'PDF, MIDI': 'PDF, MIDI',
  'A large community library. Many scores are free, but the music in them is not always free: choose scores marked public domain or Creative Commons, or music that is out of copyright. Downloading needs an account.':
    'Eine große Bibliothek der Community. Viele Noten sind kostenlos, die Musik darin aber nicht immer frei: Wähle Noten, die als gemeinfrei oder Creative Commons gekennzeichnet sind, oder Musik, deren Schutz abgelaufen ist. Zum Herunterladen brauchst du ein Konto.',
  'Free scores, including pieces by living composers who chose to share them. Each score shows its licence.':
    'Kostenlose Noten, auch von lebenden Komponistinnen und Komponisten, die sie teilen möchten. Bei jeder Note steht ihre Lizenz.',
  'PDF, MIDI (varies)': 'PDF, MIDI (unterschiedlich)',
  'Easy piano arrangements of classical and traditional pieces; some are free, others need a subscription.':
    'Leichte Klaviersätze klassischer und traditioneller Stücke; manche sind kostenlos, andere brauchen ein Abo.',
  'MuseScore.com official scores': 'Offizielle Noten auf MuseScore.com',
  'Licensed arrangements of current songs from music publishers, with a paid subscription. You may download them for your own practice.':
    'Lizenzierte Bearbeitungen aktueller Songs von Musikverlagen, mit einem kostenpflichtigen Abo. Du darfst sie für dein eigenes Üben herunterladen.',
  'Licensed digital sheet music for current songs, sold one piece at a time. Files are PDFs, so use them as printed music beside OpenTiles.':
    'Lizenzierte digitale Noten aktueller Songs, einzeln zu kaufen. Die Dateien sind PDFs – nutze sie also als Noten neben OpenTiles.',
  'A large shop for printed and digital sheet music from publishers, mostly as PDF.':
    'Ein großer Shop für gedruckte und digitale Noten von Verlagen, meist als PDF.',
  'Free notation software. Open or write a score and export it as MusicXML or MIDI to practise it here.':
    'Kostenloses Notensatzprogramm. Öffne oder schreib Noten und exportiere sie als MusicXML oder MIDI, um sie hier zu üben.',
  'exports MusicXML, MIDI': 'exportiert MusicXML, MIDI',
  'Free optical music recognition: turns a clean PDF score into MusicXML on your own computer. Check the result, as recognition makes mistakes.':
    'Kostenlose Notenerkennung: macht aus einer sauberen PDF-Partitur auf deinem eigenen Computer MusicXML. Prüf das Ergebnis, die Erkennung macht Fehler.',
  'PDF → MusicXML': 'PDF → MusicXML',
  '(opens in a new tab)': '(öffnet in einem neuen Tab)',
  'Files: {formats}': 'Dateien: {formats}',
  'OpenTiles opens MusicXML, MuseScore, MIDI and ABC files. These sites offer free and licensed sheet music in those formats. Download a file, then import it in your library.':
    'OpenTiles öffnet MusicXML-, MuseScore-, MIDI- und ABC-Dateien. Diese Websites bieten kostenlose und lizenzierte Noten in diesen Formaten an. Lade eine Datei herunter und importiere sie dann in deine Bibliothek.',
  'These sites are run by others; OpenTiles has no connection to them and sends them nothing. Check the licence of each score, and only import music you have the right to use for your own practice.':
    'Diese Websites werden von anderen betrieben; OpenTiles hat keine Verbindung zu ihnen und sendet ihnen nichts. Prüf die Lizenz jeder Note und importiere nur Musik, die du zum eigenen Üben verwenden darfst.',
  'Public domain and free': 'Gemeinfrei und kostenlos',
  'Music whose composer died more than 70 years ago is free to use in most of Europe; in other countries the rules differ. A new arrangement of an old piece can still be protected.':
    'Musik, deren Komponist vor mehr als 70 Jahren gestorben ist, ist in den meisten Ländern Europas frei; anderswo gelten andere Regeln. Eine neue Bearbeitung eines alten Stücks kann trotzdem geschützt sein.',
  'Shared under an open licence': 'Unter einer offenen Lizenz geteilt',
  'Licensed shops': 'Lizenzierte Shops',
  'For songs that are still under copyright. Buying a score gives you the right to use it yourself; it does not allow sharing it.':
    'Für Songs, die noch urheberrechtlich geschützt sind. Mit dem Kauf darfst du die Noten selbst nutzen, aber nicht weitergeben.',
  'Turning a score into a file OpenTiles can open':
    'Noten in eine Datei umwandeln, die OpenTiles öffnen kann',
  // Backup
  'Too short': 'Zu kurz',
  'Use at least {n} characters. Four or five random words work well.':
    'Nimm mindestens {n} Zeichen. Vier oder fünf zufällige Wörter funktionieren gut.',
  Weak: 'Schwach',
  'This contains a very common word or pattern. Add a few unrelated words.':
    'Das enthält ein sehr häufiges Wort oder Muster. Füg ein paar Wörter hinzu, die nichts miteinander zu tun haben.',
  Strong: 'Stark',
  'Good. Keep it somewhere safe.': 'Gut. Bewahr sie sicher auf.',
  Fair: 'Mittel',
  'Fair. One or two more words would make it strong.':
    'Mittel. Ein oder zwei weitere Wörter machen sie stark.',
  'Easy to guess. Make it longer, for example four or five random words.':
    'Leicht zu erraten. Mach sie länger, zum Beispiel vier oder fünf zufällige Wörter.',
  'Collecting your library…': 'Deine Bibliothek wird gesammelt …',
  'Protecting the key with your passphrase…':
    'Der Schlüssel wird mit deiner Passphrase geschützt …',
  'Encrypting…': 'Wird verschlüsselt …',
  'Checking the passphrase and decrypting…': 'Passphrase wird geprüft und entschlüsselt …',
  'Adding to this device…': 'Wird zu diesem Gerät hinzugefügt …',
  'Done.': 'Fertig.',
  'Backup progress': 'Fortschritt der Sicherung',
  Backup: 'Sicherung',
  'Save your library, progress and settings in one encrypted file that you keep. It never leaves this device unless you move it yourself. Without the passphrase nobody can open it, not even the OpenTiles project — so write the passphrase down.':
    'Speichere deine Bibliothek, deinen Fortschritt und deine Einstellungen in einer verschlüsselten Datei, die du behältst. Sie verlässt dieses Gerät nur, wenn du sie selbst verschiebst. Ohne die Passphrase kann sie niemand öffnen, auch nicht das OpenTiles-Projekt – schreib die Passphrase also auf.',
  'Export backup…': 'Sicherung exportieren …',
  'Export an encrypted backup': 'Verschlüsselte Sicherung exportieren',
  Passphrase: 'Passphrase',
  'Passphrase again': 'Passphrase wiederholen',
  'The two passphrases are different.': 'Die beiden Passphrasen sind verschieden.',
  'Download backup': 'Sicherung herunterladen',
  Close: 'Schließen',
  'Restore from a backup…': 'Aus einer Sicherung wiederherstellen …',
  'Backup file': 'Sicherungsdatei',
  'Restore {name}': '{name} wiederherstellen',
  'Made on {date}. Pieces already on this device are kept and not added twice.':
    'Erstellt am {date}. Stücke, die schon auf diesem Gerät sind, bleiben erhalten und werden nicht doppelt hinzugefügt.',
  'Recovery code': 'Wiederherstellungscode',
  'Backup passphrase': 'Passphrase der Sicherung',
  'Use a recovery code instead': 'Stattdessen einen Wiederherstellungscode verwenden',
  Restore: 'Wiederherstellen',
  'Restored:': 'Wiederhergestellt:',
  '1 piece added': '1 Stück hinzugefügt',
  '{n} pieces added': '{n} Stücke hinzugefügt',
  '{n} already here': '{n} schon vorhanden',
  '1 progress entry merged': '1 Fortschrittseintrag zusammengeführt',
  '{n} progress entries merged': '{n} Fortschrittseinträge zusammengeführt',
  // Sync
  Sync: 'Synchronisierung',
  'Keep your library on several devices. Everything is encrypted on this device with your sync passphrase before it is uploaded; the server stores only your email address and data it cannot read.':
    'Halte deine Bibliothek auf mehreren Geräten. Alles wird auf diesem Gerät mit deiner Sync-Passphrase verschlüsselt, bevor es hochgeladen wird; der Server speichert nur deine E-Mail-Adresse und Daten, die er nicht lesen kann.',
  'Sign in': 'Anmelden',
  'Sign in with a passkey': 'Mit einem Passkey anmelden',
  'Email address': 'E-Mail-Adresse',
  'Email me a sign-in link': 'Anmeldelink per E-Mail senden',
  'We sent a link and an 8-digit code to {email}. Open the link on this device, or type the code here — on iPad, the code is easier if you added OpenTiles to the Home Screen.':
    'Wir haben einen Link und einen 8-stelligen Code an {email} geschickt. Öffne den Link auf diesem Gerät oder gib den Code hier ein – auf dem iPad ist der Code einfacher, wenn du OpenTiles zum Home-Bildschirm hinzugefügt hast.',
  Code: 'Code',
  'Choose a sync passphrase': 'Sync-Passphrase wählen',
  'You type it once on each new device. It never leaves this device. If you forget it and lose the recovery code, the synced copy cannot be opened by anyone.':
    'Du gibst sie auf jedem neuen Gerät einmal ein. Sie verlässt dieses Gerät nie. Wenn du sie vergisst und den Wiederherstellungscode verlierst, kann niemand die synchronisierte Kopie öffnen.',
  'Sync passphrase': 'Sync-Passphrase',
  'Turn on sync': 'Synchronisierung einschalten',
  'Sign out': 'Abmelden',
  'Your recovery code': 'Dein Wiederherstellungscode',
  'This is shown only once.': 'Er wird nur einmal angezeigt.',
  'Write it down or print it and keep it somewhere safe. If you forget your passphrase, this code is the only way to open your synced library. Nobody else can recover it for you.':
    'Schreib ihn auf oder druck ihn aus und bewahr ihn sicher auf. Wenn du deine Passphrase vergisst, ist dieser Code der einzige Weg, deine synchronisierte Bibliothek zu öffnen. Niemand sonst kann sie für dich wiederherstellen.',
  Print: 'Drucken',
  Copy: 'Kopieren',
  'I have written down or saved my recovery code.':
    'Ich habe meinen Wiederherstellungscode aufgeschrieben oder gespeichert.',
  'Sync is not set up for this account yet.':
    'Für dieses Konto ist die Synchronisierung noch nicht eingerichtet.',
  'Unlock sync on this device': 'Synchronisierung auf diesem Gerät entsperren',
  'Signed in as {email}.': 'Angemeldet als {email}.',
  'Signed in.': 'Angemeldet.',
  'Enter the sync passphrase you chose on your first device.':
    'Gib die Sync-Passphrase ein, die du auf deinem ersten Gerät gewählt hast.',
  'Use the recovery code instead': 'Stattdessen den Wiederherstellungscode verwenden',
  'Unlocking…': 'Wird entsperrt …',
  Unlock: 'Entsperren',
  'Sync is on for {email}.': 'Die Synchronisierung ist an für {email}.',
  'Sync is on.': 'Die Synchronisierung ist an.',
  'Syncing…': 'Wird synchronisiert …',
  'Not synced yet.': 'Noch nicht synchronisiert.',
  'Last attempt failed: {error}': 'Letzter Versuch fehlgeschlagen: {error}',
  'Last synced {date}.': 'Zuletzt synchronisiert am {date}.',
  'Sync now': 'Jetzt synchronisieren',
  'Sync automatically while OpenTiles is open':
    'Automatisch synchronisieren, solange OpenTiles offen ist',
  'Add a passkey for faster sign-in': 'Passkey für schnellere Anmeldung hinzufügen',
  'Passkey added.': 'Passkey hinzugefügt.',
  'Sign out on this device': 'Auf diesem Gerät abmelden',
  'Delete sync account': 'Sync-Konto löschen',
  'This deletes your account and every encrypted copy on the server, at once. Your library on this device stays. Type “{word}” to confirm.':
    'Das löscht dein Konto und jede verschlüsselte Kopie auf dem Server, sofort. Deine Bibliothek auf diesem Gerät bleibt. Tippe „{word}“ zur Bestätigung.',
  delete: 'löschen',
  Confirm: 'Bestätigen',
  'Delete account and server data': 'Konto und Serverdaten löschen',
  'This copy of OpenTiles has no sync service.':
    'Diese Kopie von OpenTiles hat keinen Sync-Dienst.',
  'Signing in…': 'Anmeldung läuft …',
  'Back to Settings': 'Zurück zu den Einstellungen',
  // Detector Lab
  'Listening for 8 clicks… keep the room quiet.':
    'Hört auf 8 Klicks … bitte den Raum still halten.',
  'No clicks were heard. Turn the volume up and try again.':
    'Es wurden keine Klicks gehört. Dreh die Lautstärke auf und versuch es noch einmal.',
  'Speaker → microphone → detector onset: median {ms} ms over {n}/8 clicks (output + input latency).':
    'Lautsprecher → Mikrofon → Einsatz im Detektor: Median {ms} ms über {n}/8 Klicks (Ausgabe- plus Eingabeverzögerung).',
  'Running…': 'Läuft …',
  '{perHop} ms per 5.3 ms hop on average ({ms} ms for {seconds} s of audio, {events} events). Target ≤ 2 ms on an older iPad.':
    'Im Mittel {perHop} ms pro 5,3-ms-Schritt ({ms} ms für {seconds} s Audio, {events} Ereignisse). Ziel: ≤ 2 ms auf einem älteren iPad.',
  'Try microphone note recognition on a real piano. Tell the detector which notes you are about to play, play them (or something else) and watch its decisions. This is the Phase 0 test bench; everything runs on this device.':
    'Probier die Notenerkennung über das Mikrofon an einem echten Klavier aus. Sag dem Detektor, welche Noten du gleich spielst, spiel sie (oder etwas anderes) und sieh dir seine Entscheidungen an. Das ist der Prüfstand aus Phase 0; alles läuft auf diesem Gerät.',
  'Stop microphone': 'Mikrofon stoppen',
  'Start microphone': 'Mikrofon starten',
  'Wait mode': 'Wartemodus',
  'Input level': 'Eingangspegel',
  '{rate} Hz · base latency {ms} ms': '{rate} Hz · Grundverzögerung {ms} ms',
  'Expected notes': 'Erwartete Noten',
  Set: 'Setzen',
  'generation {n}': 'Generation {n}',
  Thresholds: 'Schwellen',
  'Measure room noise (2 s)': 'Raumgeräusch messen (2 s)',
  'noise {db} dB per bin': 'Rauschen {db} dB pro Band',
  'Estimate tuning': 'Stimmung schätzen',
  '{cents} cents from A = 440 Hz': '{cents} Cent gegenüber A = 440 Hz',
  Apply: 'Übernehmen',
  Decisions: 'Entscheidungen',
  '{accepted} accepted · {rejected} rejected · {wrong} wrong notes · {onsets} onsets':
    '{accepted} angenommen · {rejected} abgelehnt · {wrong} falsche Noten · {onsets} Einsätze',
  'decision {ms} ms after onset (median)': 'Entscheidung {ms} ms nach dem Einsatz (Median)',
  'Nothing yet.': 'Noch nichts.',
  Clear: 'Leeren',
  'Test-set recorder and latency': 'Testaufnahmen und Verzögerung',
  'Records exactly what the detector hears, as a WAV file saved to this device, for the Phase 0 test set. Only record public-domain or your own music.':
    'Nimmt genau das auf, was der Detektor hört, als WAV-Datei auf diesem Gerät, für die Testaufnahmen aus Phase 0. Nimm nur gemeinfreie oder eigene Musik auf.',
  'Stop recording': 'Aufnahme stoppen',
  Record: 'Aufnehmen',
  'Save {name}': '{name} speichern',
  'Latency test (speaker clicks)': 'Verzögerungstest (Lautsprecherklicks)',
  'Benchmark detector speed': 'Geschwindigkeit des Detektors messen',
  // Document
  'OpenTiles — free piano practice': 'OpenTiles – kostenlos Klavier üben',
  // MIDI help
  'MIDI keyboards only work on a secure page. Open OpenTiles over https, or as localhost on this computer.':
    'MIDI-Keyboards funktionieren nur auf einer sicheren Seite. Öffne OpenTiles über https oder als localhost auf diesem Computer.',
  'This browser cannot connect to MIDI keyboards. Use Chrome, Edge or Firefox, or the microphone.':
    'Dieser Browser kann sich nicht mit MIDI-Keyboards verbinden. Nutze Chrome, Edge oder Firefox oder das Mikrofon.',
  'The browser did not allow MIDI for this site. Click the icon at the left of the address bar, allow MIDI devices (Chrome lists them under Site settings), then press Connect again.':
    'Der Browser hat MIDI für diese Website nicht erlaubt. Klick auf das Symbol links in der Adressleiste, erlaube MIDI-Geräte (Chrome führt sie unter Website-Einstellungen) und tippe dann noch einmal auf Verbinden.',
  'Your browser is asking whether this site may use MIDI devices. Choose Allow in the box by the address bar. If you closed it, press Connect again, or click the icon at the left of the address bar and allow MIDI devices.':
    'Dein Browser fragt, ob diese Website MIDI-Geräte nutzen darf. Wähle „Zulassen“ im Fenster an der Adressleiste. Wenn du es geschlossen hast, tippe noch einmal auf Verbinden oder klick auf das Symbol links in der Adressleiste und erlaube MIDI-Geräte.',
  'Firefox is asking whether this site may use MIDI devices (on a website it offers a small “site permission” add-on). Accept it in the box by the address bar. If you don’t see the box, click the icon at the left of the address bar.':
    'Firefox fragt, ob diese Website MIDI-Geräte nutzen darf (auf einer Website bietet es dafür ein kleines „Website-Berechtigungs“-Add-on an). Nimm es im Fenster an der Adressleiste an. Wenn du das Fenster nicht siehst, klick auf das Symbol links in der Adressleiste.',
  'Waiting for the browser…': 'Warte auf den Browser …',
  'MIDI keyboard': 'MIDI-Keyboard',
  'Plug in your keyboard and switch it on; it appears here by itself.':
    'Steck dein Keyboard an und schalte es ein; es erscheint hier von selbst.',
  // MIDI help (iPad and Safari)
  'Web pages on iPad and iPhone cannot read MIDI keyboards: Safari and every other browser there use Apple’s WebKit engine, which has no Web MIDI. App Store apps such as Flowkey use Apple’s CoreMIDI instead, and so does the OpenTiles iPad app. In the browser, use the microphone: it listens to your piano. Many digital pianos also work as a USB audio interface: plugged in, they play the iPad’s sound, the app’s notes included, through their own speakers.':
    'Webseiten auf iPad und iPhone können keine MIDI-Keyboards lesen: Safari und alle anderen Browser dort nutzen Apples WebKit-Engine, die kein Web MIDI hat. Apps aus dem App Store wie Flowkey nutzen stattdessen Apples CoreMIDI, genau wie die OpenTiles-App für das iPad. Im Browser nimm das Mikrofon: Es hört deinem Klavier zu. Viele Digitalpianos sind auch ein USB-Audio-Interface: Angesteckt spielen sie den Klang des iPads, auch die Noten der App, über ihre eigenen Lautsprecher.',
  'Safari cannot read MIDI keyboards: its WebKit engine has no Web MIDI (native apps use Apple’s CoreMIDI instead). Open OpenTiles in Chrome, Edge or Firefox on this Mac, or use the microphone.':
    'Safari kann keine MIDI-Keyboards lesen: Seine WebKit-Engine hat kein Web MIDI (Apps nutzen stattdessen Apples CoreMIDI). Öffne OpenTiles auf diesem Mac in Chrome, Edge oder Firefox oder nutze das Mikrofon.',
  // MIDI keyboard settings
  'Firefox did not give this page access to MIDI. Firefox only sees keyboards that were connected and switched on when it started: connect the keyboard, quit Firefox completely and open it again, then click “Connect MIDI keyboard” and allow access. On a website (not localhost) Firefox also asks to add a small “site permission” add-on: accept it. If you declined before, allow MIDI again under Settings → Privacy & Security → Permissions.':
    'Firefox hat dieser Seite keinen Zugriff auf MIDI gegeben. Firefox sieht nur Keyboards, die beim Start schon verbunden und eingeschaltet waren: Verbinde das Keyboard, beende Firefox ganz und öffne es wieder, dann klick auf „MIDI-Keyboard verbinden“ und erlaube den Zugriff. Auf einer Website (nicht localhost) fragt Firefox außerdem, ob ein kleines „Website-Berechtigungs“-Add-on hinzugefügt werden darf: Stimme zu. Wenn du vorher abgelehnt hast, erlaube MIDI wieder unter Einstellungen → Datenschutz & Sicherheit → Berechtigungen.',
  'Firefox found no MIDI keyboard. It only sees keyboards that were connected and switched on when it started: quit Firefox completely, check the keyboard is on, and open Firefox again.':
    'Firefox hat kein MIDI-Keyboard gefunden. Es sieht nur Keyboards, die beim Start schon verbunden und eingeschaltet waren: Beende Firefox ganz, prüf, ob das Keyboard an ist, und öffne Firefox wieder.',
  'No MIDI keyboard found. Connect it and switch it on; it appears here by itself.':
    'Kein MIDI-Keyboard gefunden. Verbinde es und schalte es ein; es erscheint hier von selbst.',
  'App’s notes play on': 'Noten der App spielen auf',
  'This device': 'Diesem Gerät',
  'My keyboard': 'Meinem Keyboard',
  'Play my MIDI keys on this device': 'Meine MIDI-Tasten auf diesem Gerät spielen',
  'The notes you play on the keyboard also sound from this computer or tablet: for a keyboard without speakers, or to listen in headphones on this device. Turn the keyboard’s own volume down if you hear both.':
    'Die Noten, die du auf dem Keyboard spielst, klingen auch aus diesem Computer oder Tablet: für ein Keyboard ohne Lautsprecher oder zum Hören mit Kopfhörern an diesem Gerät. Dreh die Lautstärke des Keyboards herunter, wenn du beides hörst.',
  'Listen mode, the other hand and listening back; also under “Plays on” in practice. “My keyboard” plays them with the keyboard’s own sound; the metronome stays on this device.':
    'Anhören, die andere Hand und das Nachhören; auch unter „Spielt auf“ beim Üben. „Meinem Keyboard“ spielt sie mit dem Klang des Keyboards; das Metronom bleibt auf diesem Gerät.',
  'This keyboard sends the app’s notes back (MIDI thru). OpenTiles ignores those copies, so they don’t count as yours.':
    'Dieses Keyboard schickt die Noten der App zurück (MIDI Thru). OpenTiles übergeht diese Kopien, damit sie nicht als deine zählen.',
  // Touch (P6-11)
  'How the app plays': 'Wie die App spielt',
  Touch: 'Anschlag',
  'For pieces whose file has no loudness of its own, such as the catalogue: natural brings out the melody and the strong beats, even plays every note alike. MIDI files keep their own.':
    'Für Stücke, deren Datei keine eigene Lautstärke hat, etwa im Katalog: Natürlich hebt die Melodie und die betonten Zählzeiten hervor, gleichmäßig spielt jede Note gleich laut. MIDI-Dateien behalten ihre eigene.',
  Natural: 'Natürlich',
  Even: 'Gleichmäßig',
  // The iPad app (P6-12)
  'Bluetooth MIDI keyboard': 'Bluetooth-MIDI-Keyboard',
  'On the iPad, a Bluetooth MIDI keyboard is paired here, not in the iPad’s own Bluetooth settings. Once paired it works like a keyboard plugged in by USB.':
    'Auf dem iPad wird ein Bluetooth-MIDI-Keyboard hier gekoppelt, nicht in den Bluetooth-Einstellungen des iPads. Danach funktioniert es wie ein per USB angestecktes Keyboard.',
  'Pair a Bluetooth MIDI keyboard': 'Bluetooth-MIDI-Keyboard koppeln',
  // Plays on (P6-01)
  'Plays on': 'Spielt auf',
  Connect: 'Verbinden',
  'The app’s notes play on {name}': 'Die Noten der App spielen auf {name}',
  'The app’s notes play on this device': 'Die Noten der App spielen auf diesem Gerät',
  'Your keyboard’s MIDI output': 'MIDI-Ausgang deines Keyboards',
  'The metronome and count-in stay on this device.':
    'Metronom und Einzählen bleiben auf diesem Gerät.',
  'This browser cannot play on a MIDI keyboard, so the app’s notes play on this device.':
    'Dieser Browser kann nicht auf einem MIDI-Keyboard spielen, deshalb spielen die Noten der App auf diesem Gerät.',
  'Your keyboard isn’t connected, so the app’s notes play on this device.':
    'Dein Keyboard ist nicht verbunden, deshalb spielen die Noten der App auf diesem Gerät.',
  'No MIDI keyboard is connected, so the app’s notes play on this device. Plug it in and switch it on; the notes move to it by themselves.':
    'Kein MIDI-Keyboard ist verbunden, deshalb spielen die Noten der App auf diesem Gerät. Steck es an und schalte es ein; die Noten wechseln von selbst dorthin.',
  'Your keyboard sends notes but offers no MIDI output here, so the app’s notes play on this device.':
    'Dein Keyboard sendet Noten, bietet hier aber keinen MIDI-Ausgang, deshalb spielen die Noten der App auf diesem Gerät.',
  'Choose which MIDI output is your keyboard under “Plays on”; until then the app’s notes play on this device.':
    'Wähl unter „Spielt auf“, welcher MIDI-Ausgang dein Keyboard ist; bis dahin spielen die Noten der App auf diesem Gerät.',
  'Here the app’s notes play on this device. Many digital pianos also work as a USB audio interface: plugged into the iPad or iPhone, they play its sound, the app’s notes included, through their own speakers.':
    'Hier spielen die Noten der App auf diesem Gerät. Viele Digitalpianos sind auch ein USB-Audio-Interface: Am iPad oder iPhone angesteckt, spielen sie dessen Klang, auch die Noten der App, über ihre eigenen Lautsprecher.',
  'Here the app’s notes play on this device. To play them on a MIDI keyboard, open OpenTiles in Chrome, Edge or Firefox.':
    'Hier spielen die Noten der App auf diesem Gerät. Um sie auf einem MIDI-Keyboard zu spielen, öffne OpenTiles in Chrome, Edge oder Firefox.',
  'Here the app’s notes play on this device: this browser cannot reach MIDI keyboards.':
    'Hier spielen die Noten der App auf diesem Gerät: Dieser Browser erreicht keine MIDI-Keyboards.',
  'Test your keyboard': 'Keyboard testen',
  'Connect the keyboard and switch it on, then press Test and play a key. The note shows here, so you can see that this browser hears it.':
    'Verbinde das Keyboard und schalte es ein, dann drück auf Testen und spiel eine Taste. Die Note erscheint hier – so siehst du, dass dieser Browser sie hört.',
  'Test again': 'Noch einmal testen',
  Test: 'Testen',
  'Play a test note on it': 'Testnote darauf spielen',
  'Keyboards: {names}': 'Keyboards: {names}',
  'none found': 'keines gefunden',
  'Last note: {note}': 'Letzte Note: {note}',
  'none yet — play a key': 'noch keine – spiel eine Taste',
  'Play the app’s notes on': 'Noten der App spielen auf',
  'The connected keyboard': 'Dem verbundenen Keyboard',
  'Overview of the piece': 'Überblick über das Stück',
  'Live stats': 'Live-Statistik',
  perfect: 'perfekt',
  good: 'gut',
  missed: 'verpasst',
  wrong: 'falsch',
  streak: 'Serie',
  'best {n}': 'beste {n}',
  'Tap a bar to go there; drag along the strip to loop bars.':
    'Tippe auf einen Takt, um dorthin zu springen; ziehe über den Streifen, um Takte zu wiederholen.',
  'Bar {bar}: {n} mistakes': 'Takt {bar}: {n} Fehler',
  'Loop starts at bar': 'Wiederholung beginnt bei Takt',
  'Loop ends at bar': 'Wiederholung endet bei Takt',
  'Sight-reading': 'Blattspiel',
  'Bass clef': 'Bassschlüssel',
  'Both clefs': 'Beide Schlüssel',
  'Treble clef': 'Violinschlüssel',
  'E♭ major': 'Es-Dur',
  'B♭ major': 'B-Dur',
  'F major': 'F-Dur',
  'C major': 'C-Dur',
  'G major': 'G-Dur',
  'D major': 'D-Dur',
  'A major': 'A-Dur',
  'Read each note from the staff and play it. Every drill is new, made on this device. The falling notes stay hidden, and so do the keys to press unless you ask for them.':
    'Lies jede Note aus dem Notensystem und spiele sie. Jede Übung ist neu und wird auf diesem Gerät erzeugt. Die fallenden Noten bleiben verborgen, die zu spielenden Tasten auch, außer du willst sie sehen.',
  'Your drill': 'Deine Übung',
  Clef: 'Schlüssel',
  Key: 'Tonart',
  Notes: 'Noten',
  'How far from middle C the notes go.': 'Wie weit die Noten vom mittleren C entfernt sind.',
  'Around middle C': 'Um das mittlere C',
  'The whole staff': 'Das ganze Notensystem',
  'With ledger lines': 'Mit Hilfslinien',
  Drill: 'Übung',
  'Single notes jump anywhere; phrases move mostly by step, like a tune.':
    'Einzelne Noten springen überallhin; Phrasen gehen meist schrittweise, wie eine Melodie.',
  'Single notes': 'Einzelne Noten',
  'Short phrases': 'Kurze Phrasen',
  'Note names under the notes': 'Notennamen unter den Noten',
  'Written as Settings → How note names are written says.':
    'Geschrieben, wie es unter Einstellungen → Schreibweise der Notennamen steht.',
  'Show the key to press': 'Die zu spielende Taste zeigen',
  'A first step: the key lights up, as in the other pieces.':
    'Für den Anfang: Die Taste leuchtet auf, wie bei den anderen Stücken.',
  Endless: 'Endlos',
  'The next drill starts as soon as one ends.': 'Die nächste Übung beginnt, sobald eine endet.',
  'Start a drill': 'Übung starten',
  '{n} notes a minute': '{n} Noten pro Minute',
  '{percent} % at the first try': '{percent} % beim ersten Versuch',
  'Next drill': 'Nächste Übung',
  'Change the drill': 'Übung ändern',
  'The next drill starts in a moment.': 'Die nächste Übung beginnt gleich.',
  // Sheet-music PDFs kept with a piece (P5-15, ADR 0018).
  'A PDF (.pdf) is kept as the sheet music of a piece: pick it together with the MIDI or score file of the same name, or add it to a piece later. OpenTiles shows your PDF but does not read notes from it, so a PDF on its own can be read but not practised.':
    'Ein PDF (.pdf) wird als Notenblatt eines Stücks gespeichert: Wähle es zusammen mit der MIDI- oder Notendatei gleichen Namens aus oder füge es später einem Stück hinzu. OpenTiles zeigt dein PDF, liest aber keine Noten daraus. Ein PDF allein kannst du daher lesen, aber nicht üben.',
  'Is this PDF the sheet music of this piece?': 'Ist dieses PDF das Notenblatt zu diesem Stück?',
  'The names differ: “{notes}” and “{sheet}”.':
    'Die Namen sind verschieden: „{notes}“ und „{sheet}“.',
  'Yes, one piece': 'Ja, ein Stück',
  'No, two pieces': 'Nein, zwei Stücke',
  'Sheet only — add the MIDI file to practise':
    'Nur Notenblatt – füge die MIDI-Datei hinzu, um zu üben',
  Open: 'Öffnen',
  'Replace sheet music': 'Notenblatt ersetzen',
  Replace: 'Ersetzen',
  'Remove sheet music': 'Notenblatt entfernen',
  Remove: 'Entfernen',
  'Remove the sheet music from “{title}”?': 'Das Notenblatt von „{title}“ entfernen?',
  'Add sheet music (PDF)': 'Notenblatt hinzufügen (PDF)',
  'Sheet music: {name}': 'Notenblatt: {name}',
  'Leave out the sheet music': 'Notenblatt weglassen',
  'Piece {n} of {total}': 'Stück {n} von {total}',
  'This PDF has no notes OpenTiles can follow. You can read it now, and practise it once you add the MIDI or score file of the same piece.':
    'Diesem PDF kann OpenTiles keine Noten entnehmen. Du kannst es jetzt lesen und üben, sobald du die MIDI- oder Notendatei desselben Stücks hinzufügst.',
  'Choose a MIDI or score file. A recording cannot be paired with sheet music.':
    'Wähle eine MIDI- oder Notendatei. Eine Aufnahme lässt sich nicht mit einem Notenblatt verbinden.',
  'Add the MIDI or score file': 'MIDI- oder Notendatei hinzufügen',
  'This PDF is too large ({size} MB). The limit is {limit} MB.':
    'Dieses PDF ist zu groß ({size} MB). Die Grenze liegt bei {limit} MB.',
  '“{name}” is not a PDF file, so it cannot be kept as sheet music.':
    '„{name}“ ist keine PDF-Datei und kann daher nicht als Notenblatt gespeichert werden.',
  'sheet music added to {n} of them': 'bei {n} davon das Notenblatt ergänzt',
};
