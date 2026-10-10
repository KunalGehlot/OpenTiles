// Where learners can find sheet music to import (MusicXML, MuseScore, MIDI or ABC): public-domain
// libraries, openly licensed collections and licensed shops. Plain links only: OpenTiles never
// fetches anything from these sites (docs/legal-guardrails.md: no import tools aimed at other
// sites, no third-party requests at runtime). Only legal sources are listed; downloaders that get
// round a site's paywall and collections of unlicensed arrangements are left out on purpose.
import { ExternalLink } from 'lucide-react';
import { href } from '../lib/router';
import { t } from '../i18n';

interface Source {
  name: string;
  url: string;
  description: string;
  /** File types the site offers that OpenTiles can import. */
  formats: string;
}

function publicDomain(): Source[] {
  return [
    {
      name: 'Mutopia Project',
      url: 'https://www.mutopiaproject.org/',
      description: t(
        'Classical pieces typeset by volunteers, most of them in the public domain or under Creative Commons. Every piece has a MIDI file, so it opens in OpenTiles straight away.',
      ),
      formats: 'MIDI',
    },
    {
      name: 'OpenScore',
      url: 'https://musescore.com/openscore',
      description: t(
        'Public-domain music transcribed by volunteers and released as CC0, published on MuseScore.com. Download MusicXML or MuseScore files.',
      ),
      formats: 'MusicXML, MuseScore',
    },
    {
      name: 'IMSLP – Petrucci Music Library',
      url: 'https://imslp.org/',
      description: t(
        'The largest library of public-domain scores. Most files are scanned PDFs, which OpenTiles cannot open; some pieces also have MusicXML or MIDI files. Check the copyright note on each file for your country.',
      ),
      formats: t('mostly PDF; some MusicXML and MIDI'),
    },
    {
      name: 'Musopen',
      url: 'https://musopen.org/',
      description: t('Public-domain sheet music and recordings, free to download.'),
      formats: t('mostly PDF'),
    },
    {
      name: 'ChoralWiki (CPDL)',
      url: 'https://www.cpdl.org/',
      description: t(
        'Free choral scores, many with a piano reduction, released under open licences by their editors.',
      ),
      formats: t('PDF, MusicXML, MIDI (varies)'),
    },
    {
      name: 'The Session',
      url: 'https://thesession.org/',
      description: t(
        'Traditional Irish and folk tunes written in ABC notation, which OpenTiles imports. Melody only.',
      ),
      formats: 'ABC',
    },
    {
      name: 'abcnotation.com',
      url: 'https://abcnotation.com/search',
      description: t('A search engine for folk and traditional tunes in ABC notation.'),
      formats: 'ABC',
    },
    {
      name: 'A Collection of Christmas Carols',
      url: 'https://acollectionofchristmascarols.com/',
      description: t('Traditional carols, with free arrangements for piano.'),
      formats: t('PDF, MIDI'),
    },
  ];
}

function openlyLicensed(): Source[] {
  return [
    {
      name: 'MuseScore.com',
      url: 'https://musescore.com/sheetmusic',
      description: t(
        'A large community library. Many scores are free, but the music in them is not always free: choose scores marked public domain or Creative Commons, or music that is out of copyright. Downloading needs an account.',
      ),
      formats: 'MuseScore, MusicXML, MIDI',
    },
    {
      name: 'Free-scores.com',
      url: 'https://www.free-scores.com/',
      description: t(
        'Free scores, including pieces by living composers who chose to share them. Each score shows its licence.',
      ),
      formats: t('PDF, MIDI (varies)'),
    },
    {
      name: '8notes',
      url: 'https://www.8notes.com/piano/',
      description: t(
        'Easy piano arrangements of classical and traditional pieces; some are free, others need a subscription.',
      ),
      formats: t('PDF, MIDI'),
    },
  ];
}

function licensed(): Source[] {
  return [
    {
      name: t('MuseScore.com official scores'),
      url: 'https://musescore.com/',
      description: t(
        'Licensed arrangements of current songs from music publishers, with a paid subscription. You may download them for your own practice.',
      ),
      formats: 'MuseScore, MusicXML, MIDI',
    },
    {
      name: 'Musicnotes',
      url: 'https://www.musicnotes.com/',
      description: t(
        'Licensed digital sheet music for current songs, sold one piece at a time. Files are PDFs, so use them as printed music beside OpenTiles.',
      ),
      formats: 'PDF',
    },
    {
      name: 'Sheet Music Plus',
      url: 'https://www.sheetmusicplus.com/',
      description: t(
        'A large shop for printed and digital sheet music from publishers, mostly as PDF.',
      ),
      formats: 'PDF',
    },
  ];
}

function tools(): Source[] {
  return [
    {
      name: 'MuseScore Studio',
      url: 'https://musescore.org/',
      description: t(
        'Free notation software. Open or write a score and export it as MusicXML or MIDI to practise it here.',
      ),
      formats: t('exports MusicXML, MIDI'),
    },
    {
      name: 'Audiveris',
      url: 'https://audiveris.github.io/audiveris/',
      description: t(
        'Free optical music recognition: turns a clean PDF score into MusicXML on your own computer. Check the result, as recognition makes mistakes.',
      ),
      formats: t('PDF → MusicXML'),
    },
  ];
}

function SourceList({ sources }: { sources: Source[] }) {
  return (
    <ul className="source-list">
      {sources.map((s) => (
        <li key={s.url} className="card source">
          <a className="source__name" href={s.url} target="_blank" rel="noopener noreferrer">
            {s.name}
            <ExternalLink aria-hidden="true" />
            <span className="visually-hidden"> {t('(opens in a new tab)')}</span>
          </a>
          <p className="source__description">{s.description}</p>
          <p className="source__formats muted">{t('Files: {formats}', { formats: s.formats })}</p>
        </li>
      ))}
    </ul>
  );
}

export function SheetMusic() {
  return (
    <article className="stack sheet-music">
      <h1>{t('Find sheet music')}</h1>
      <p className="lead">
        {t(
          'OpenTiles opens MusicXML, MuseScore, MIDI and ABC files. These sites offer free and licensed sheet music in those formats. Download a file, then import it in your library.',
        )}
      </p>
      <p className="notice">
        {t(
          'These sites are run by others; OpenTiles has no connection to them and sends them nothing. Check the licence of each score, and only import music you have the right to use for your own practice.',
        )}{' '}
        <a href={href({ name: 'library' })}>{t('Open my library')}</a>
      </p>

      <section aria-labelledby="pd-title">
        <h2 id="pd-title">{t('Public domain and free')}</h2>
        <p className="muted">
          {t(
            'Music whose composer died more than 70 years ago is free to use in most of Europe; in other countries the rules differ. A new arrangement of an old piece can still be protected.',
          )}
        </p>
        <SourceList sources={publicDomain()} />
      </section>

      <section aria-labelledby="open-title">
        <h2 id="open-title">{t('Shared under an open licence')}</h2>
        <SourceList sources={openlyLicensed()} />
      </section>

      <section aria-labelledby="licensed-title">
        <h2 id="licensed-title">{t('Licensed shops')}</h2>
        <p className="muted">
          {t(
            'For songs that are still under copyright. Buying a score gives you the right to use it yourself; it does not allow sharing it.',
          )}
        </p>
        <SourceList sources={licensed()} />
      </section>

      <section aria-labelledby="tools-title">
        <h2 id="tools-title">{t('Turning a score into a file OpenTiles can open')}</h2>
        <SourceList sources={tools()} />
      </section>
    </article>
  );
}
