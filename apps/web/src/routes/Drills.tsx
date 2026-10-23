// The drills: a hub with a card for each kind (P7-04), and their setup pages. Sight-reading
// (P5-05, ADR 0015): choose a clef, a key and how far from middle C the notes go, then read new
// notes from the staff. Chords (P7-04, ADR 0022) are in ChordDrills.tsx. Every drill is generated
// on this device; the choices are remembered for next time.
import { useEffect, useState } from 'react';
import { Music, Play, Piano } from 'lucide-react';
import {
  clefName,
  DEFAULT_DRILL_PREFS,
  DRILL_KEYS,
  drillRoute,
  keyName,
  loadDrillPrefs,
  saveDrillPrefs,
} from '../practice/drill';
import type { DrillPrefs } from '../practice/drill';
import { href } from '../lib/router';
import type { DrillPage } from '../lib/router';
import { BackToDrills, ChordDrills } from './ChordDrills';
import { Setting, Toggle } from '../ui/SettingRow';
import { t } from '../i18n';

export function Drills({ page }: { page?: DrillPage }) {
  if (page === 'sight-reading') return <SightReading />;
  if (page === 'chords') return <ChordDrills />;
  return (
    <div className="settings drills">
      <h1>{t('Drills')}</h1>
      <p className="lead">
        {t('Short exercises made on this device, new every time. Choose what to practise.')}
      </p>
      <div className="drill-cards">
        <a className="card drill-card" href={href({ name: 'drills', page: 'sight-reading' })}>
          <Music aria-hidden="true" />
          <h3>{t('Sight-reading')}</h3>
          <p className="muted">{t('Read single notes or short phrases from the staff.')}</p>
        </a>
        <a className="card drill-card" href={href({ name: 'drills', page: 'chords' })}>
          <Piano aria-hidden="true" />
          <h3>{t('Chords')}</h3>
          <p className="muted">
            {t('Random chords to find and press, on the sheet or as falling keys.')}
          </p>
        </a>
      </div>
    </div>
  );
}

function SightReading() {
  const [prefs, setPrefs] = useState<DrillPrefs | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDrillPrefs().then((p) => !cancelled && setPrefs(p));
    return () => {
      cancelled = true;
    };
  }, []);

  const p = prefs ?? DEFAULT_DRILL_PREFS;
  const set = (patch: Partial<DrillPrefs>) => {
    const next = { ...p, ...patch };
    setPrefs(next);
    void saveDrillPrefs(next);
  };

  return (
    <div className="settings drills">
      <BackToDrills />
      <h1>{t('Sight-reading')}</h1>
      <p className="lead">
        {t(
          'Read each note from the staff and play it. Every drill is new, made on this device. The falling notes stay hidden, and so do the keys to press unless you ask for them.',
        )}
      </p>
      <section aria-labelledby="drill-title">
        <h2 id="drill-title">{t('Your drill')}</h2>
        <Setting label={t('Clef')}>
          <select
            value={p.clef}
            onChange={(e) => set({ clef: e.target.value as DrillPrefs['clef'] })}
          >
            {(['treble', 'bass', 'both'] as const).map((c) => (
              <option key={c} value={c}>
                {clefName(c)}
              </option>
            ))}
          </select>
        </Setting>
        <Setting label={t('Key')}>
          <select value={p.fifths} onChange={(e) => set({ fifths: Number(e.target.value) })}>
            {DRILL_KEYS.map((k) => (
              <option key={k} value={k}>
                {keyName(k)}
              </option>
            ))}
          </select>
        </Setting>
        <Setting label={t('Notes')} hint={t('How far from middle C the notes go.')}>
          <select
            value={p.level}
            onChange={(e) => set({ level: Number(e.target.value) as DrillPrefs['level'] })}
          >
            <option value={1}>{t('Around middle C')}</option>
            <option value={2}>{t('The whole staff')}</option>
            <option value={3}>{t('With ledger lines')}</option>
          </select>
        </Setting>
        <Setting
          label={t('Drill')}
          hint={t('Single notes jump anywhere; phrases move mostly by step, like a tune.')}
        >
          <select
            value={p.kind}
            onChange={(e) => set({ kind: e.target.value === 'phrases' ? 'phrases' : 'notes' })}
          >
            <option value="notes">{t('Single notes')}</option>
            <option value="phrases">{t('Short phrases')}</option>
          </select>
        </Setting>
        <Toggle
          label={t('Note names under the notes')}
          description={t('Written as Settings → How note names are written says.')}
          checked={p.letters}
          onChange={(letters) => set({ letters })}
        />
        <Toggle
          label={t('Show the key to press')}
          description={t('A first step: the key lights up, as in the other pieces.')}
          checked={p.showKeys}
          onChange={(showKeys) => set({ showKeys })}
        />
        <Toggle
          label={t('Endless')}
          description={t('The next drill starts as soon as one ends.')}
          checked={p.endless}
          onChange={(endless) => set({ endless })}
        />
        <div className="row">
          <a className="button primary" href={href(drillRoute(p))}>
            <Play /> {t('Start a drill')}
          </a>
        </div>
      </section>
    </div>
  );
}
