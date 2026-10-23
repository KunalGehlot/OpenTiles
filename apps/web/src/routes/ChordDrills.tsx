// Chord drills (P7-04, P7-09, ADR 0022): choose a level or a set of chords, the hands, how they are
// shown and the pace, then find and press random chords. Every drill is generated on this device;
// the choices and the chord progress are remembered here.
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Play } from 'lucide-react';
import {
  CHORD_LEVELS,
  inversionsOf,
  kindTotals,
  MAX_CHORD_TEMPO,
  MIN_CHORD_TEMPO,
} from '@opentiles/practice';
import type { ChordHands, ChordLevel, ChordStats, LeftPart } from '@opentiles/practice';
import {
  CHORD_COUNTS,
  chordDrillRoute,
  DEFAULT_CHORD_DRILL_PREFS,
  handsForLevel,
  kindLabel,
  levelName,
  loadChordDrillPrefs,
  loadChordStats,
  QUALITIES,
  qualityName,
  saveChordDrillPrefs,
  weakFocus,
} from '../practice/chord-drill';
import type { ChordDrillPrefs } from '../practice/chord-drill';
import { pitchClassName } from '../lib/notes';
import { href } from '../lib/router';
import { Setting, Toggle } from '../ui/SettingRow';
import { t } from '../i18n';

const ROOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** A link back to the hub above a drill's setup page. */
export function BackToDrills() {
  return (
    <a className="back-link" href={href({ name: 'drills' })}>
      <ChevronLeft aria-hidden="true" /> {t('All drills')}
    </a>
  );
}

export function ChordDrills() {
  const [prefs, setPrefs] = useState<ChordDrillPrefs | null>(null);
  const [stats, setStats] = useState<ChordStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadChordDrillPrefs().then((p) => !cancelled && setPrefs(p));
    void loadChordStats().then((s) => !cancelled && setStats(s));
    return () => {
      cancelled = true;
    };
  }, []);

  const p = prefs ?? DEFAULT_CHORD_DRILL_PREFS;
  const set = (patch: Partial<ChordDrillPrefs>) => {
    const next = { ...p, ...patch };
    setPrefs(next);
    void saveChordDrillPrefs(next);
  };
  const setSet = (patch: Partial<ChordDrillPrefs['set']>) => set({ set: { ...p.set, ...patch } });

  const focus = useMemo(() => (stats && p.weak ? weakFocus(stats, p) : []), [stats, p]);
  const weakest = useMemo(() => (stats ? weakFocus(stats, p) : []), [stats, p]);
  const totals = useMemo(
    () => new Map((stats ? kindTotals(stats) : []).map((k) => [k.kind, k])),
    [stats],
  );
  const custom = p.level === 'custom';
  // Inversions are a choice from level 4 up, and in a set that has them.
  const inversions = custom
    ? p.set.inversions && p.set.qualities.some((q) => inversionsOf(q) > 1)
    : p.level >= 4;

  return (
    <div className="settings drills">
      <BackToDrills />
      <h1>{t('Chords')}</h1>
      <p className="lead">
        {t(
          'Find each chord and press all its notes together. Every drill is new, made on this device. Your results stay here.',
        )}
      </p>
      <section aria-labelledby="chords-title">
        <h2 id="chords-title">{t('Your chords')}</h2>
        <Setting label={t('Level')} hint={t('Each level adds to the ones before it.')}>
          <select
            value={String(p.level)}
            onChange={(e) => {
              const level =
                e.target.value === 'custom' ? 'custom' : (Number(e.target.value) as ChordLevel);
              set({ level, hands: handsForLevel(level) });
            }}
          >
            {CHORD_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t('Level {n}: {name}', { n: l, name: levelName(l) })}
              </option>
            ))}
            <option value="custom">{levelName('custom')}</option>
          </select>
        </Setting>
        {custom && (
          <div className="chord-set panel" role="group" aria-label={t('My own set')}>
            <p className="setting__label" id="chord-roots">
              {t('Roots')}
            </p>
            <div className="chord-roots" role="group" aria-labelledby="chord-roots">
              {ROOTS.map((pc) => {
                const on = p.set.roots.includes(pc);
                return (
                  <button
                    key={pc}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const roots = on ? p.set.roots.filter((r) => r !== pc) : [...p.set.roots, pc];
                      if (roots.length > 0) setSet({ roots: roots.sort((a, b) => a - b) });
                    }}
                  >
                    {pitchClassName(pc, 'common')}
                  </button>
                );
              })}
            </div>
            <fieldset className="chord-qualities">
              <legend className="setting__label">{t('Chords')}</legend>
              {QUALITIES.map((q) => {
                const on = p.set.qualities.includes(q);
                return (
                  <label key={q} className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const qualities = on
                          ? p.set.qualities.filter((x) => x !== q)
                          : QUALITIES.filter((x) => x === q || p.set.qualities.includes(x));
                        if (qualities.length > 0) setSet({ qualities });
                      }}
                    />
                    {qualityName(q)}
                  </label>
                );
              })}
            </fieldset>
            <Toggle
              label={t('Inversions')}
              description={t(
                'Triads and seventh chords also come with another note at the bottom.',
              )}
              checked={p.set.inversions}
              onChange={(on) => setSet({ inversions: on })}
            />
          </div>
        )}
        <Setting label={t('Hands')}>
          <select value={p.hands} onChange={(e) => set({ hands: e.target.value as ChordHands })}>
            <option value="right">{t('Right hand')}</option>
            <option value="left">{t('Left hand')}</option>
            <option value="both">{t('Both hands')}</option>
          </select>
        </Setting>
        {custom && p.hands === 'both' && (
          <Setting label={t('Left hand plays')}>
            <select
              value={p.set.left}
              onChange={(e) => setSet({ left: e.target.value as LeftPart })}
            >
              <option value="root">{t('The root')}</option>
              <option value="fifth">{t('Root and fifth')}</option>
              <option value="chord">{t('The chord, lower')}</option>
            </select>
          </Setting>
        )}
        {!custom && p.hands === 'both' && (
          <p className="setting__hint">
            {p.level === 8
              ? t('The left hand plays the root and fifth under each chord.')
              : t('The left hand plays the root under each chord.')}
          </p>
        )}
        <Setting label={t('Show')}>
          <select
            value={p.show}
            onChange={(e) => {
              const show = e.target.value === 'falling' ? 'falling' : 'sheet';
              set({
                show,
                names: show === 'falling' && p.names === 'name-only' ? 'shown' : p.names,
              });
            }}
          >
            <option value="sheet">{t('Sheet, no help')}</option>
            <option value="falling">{t('Falling keys')}</option>
          </select>
        </Setting>
        <Setting
          label={t('Chord names')}
          hint={
            p.names === 'name-only'
              ? t('Only the name is shown; the notes appear once you have played them.')
              : t('Written as Settings → How note names are written says.')
          }
        >
          <select
            value={p.names}
            onChange={(e) => set({ names: e.target.value as ChordDrillPrefs['names'] })}
          >
            <option value="shown">{t('Shown')}</option>
            <option value="hidden">{t('Hidden')}</option>
            {p.show === 'sheet' && <option value="name-only">{t('Name only')}</option>}
          </select>
        </Setting>
        {p.show === 'sheet' ? (
          <Toggle
            label={t('Show the key to press')}
            description={t('A first step: the keys light up, as in the other pieces.')}
            checked={p.showKeys}
            onChange={(showKeys) => set({ showKeys })}
          />
        ) : (
          <Setting
            label={t('Keys lit')}
            hint={t('How much the keyboard shows as the chord arrives.')}
          >
            <select
              value={p.hint}
              onChange={(e) => set({ hint: e.target.value as ChordDrillPrefs['hint'] })}
            >
              <option value="level">{t('As the level says')}</option>
              <option value="all">{t('Every key of the chord')}</option>
              <option value="root">{t('The root only')}</option>
              <option value="none">{t('None')}</option>
            </select>
          </Setting>
        )}
        <Setting
          label={t('Pace')}
          hint={
            p.pace === 'wait'
              ? t('The next chord comes when the last one is right.')
              : t('A chord every bar of four beats, after a count-in.')
          }
        >
          <select
            value={p.pace}
            onChange={(e) => set({ pace: e.target.value === 'tempo' ? 'tempo' : 'wait' })}
          >
            <option value="wait">{t('Wait for me')}</option>
            <option value="tempo">{t('At a tempo')}</option>
          </select>
        </Setting>
        {p.pace === 'tempo' && (
          <>
            <Setting label={t('Beats a minute')} hint={t('60 is a chord every four seconds.')}>
              <input
                type="number"
                inputMode="numeric"
                min={MIN_CHORD_TEMPO}
                max={MAX_CHORD_TEMPO}
                step={5}
                value={p.tempo}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    set({
                      tempo: Math.min(
                        MAX_CHORD_TEMPO,
                        Math.max(MIN_CHORD_TEMPO, Math.round(n / 5) * 5),
                      ),
                    });
                  }
                }}
              />
            </Setting>
            <Toggle
              label={t('Speed up as I improve')}
              description={t(
                'Five beats a minute faster after three rounds with 90 % right at the first try; slower after a round under 60 %.',
              )}
              checked={p.ladder}
              onChange={(ladder) => set({ ladder })}
            />
            <Toggle
              label={t('Strict chords')}
              description={t('All notes of a chord within 60 ms instead of 120 ms.')}
              checked={p.strict}
              onChange={(strict) => set({ strict })}
            />
          </>
        )}
        <Setting label={t('Chords a round')}>
          <select value={p.count} onChange={(e) => set({ count: Number(e.target.value) })}>
            {CHORD_COUNTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Setting>
        <Toggle
          label={t('Endless')}
          description={t('The next round starts as soon as one ends.')}
          checked={p.endless}
          onChange={(endless) => set({ endless })}
        />
        {inversions && (
          <Toggle
            label={t('Keep the hand close')}
            description={t(
              'Each chord comes in the inversion nearest the last one, as when playing a song.',
            )}
            checked={p.near}
            onChange={(near) => set({ near })}
          />
        )}
        <Toggle
          label={t('Practise my weak chords')}
          description={
            weakest.length > 0
              ? t('More often: {chords}.', {
                  chords: weakest
                    .map((k) =>
                      t('{chord} {percent} %', {
                        chord: kindLabel(k),
                        percent: Math.round((totals.get(k)?.share ?? 0) * 100),
                      }),
                    )
                    .join(', '),
                })
              : t(
                  'Chords under 80 % right at the first try come more often, once you have played a few rounds.',
                )
          }
          checked={p.weak}
          onChange={(weak) => set({ weak })}
        />
        <div className="row">
          <a className="button primary" href={href(chordDrillRoute(p, focus))}>
            <Play /> {t('Start chords')}
          </a>
        </div>
      </section>
    </div>
  );
}
