// Scale drills (P7-19, ADR 0024): choose a level or a set of scales, the hands, how many octaves,
// how they are shown and the pace, then play random scales with their fingering. Every drill is
// generated on this device; the choices and the scale progress are remembered here.
import { useEffect, useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import {
  MAX_SCALE_TEMPO,
  MIN_SCALE_TEMPO,
  SCALE_LEVELS,
  SCALE_TEMPO_STEP,
  scaleTotals,
} from '@opentiles/practice';
import type { ScaleHands, ScaleLevel, ScaleStats } from '@opentiles/practice';
import {
  DEFAULT_SCALE_DRILL_PREFS,
  KINDS,
  loadScaleDrillPrefs,
  loadScaleStats,
  prefsForLevel,
  SCALE_COUNTS,
  scaleDrillRoute,
  scaleKindLabel,
  scaleKindName,
  scaleLevelName,
  saveScaleDrillPrefs,
  weakScaleFocus,
} from '../practice/scale-drill';
import type { ScaleDrillPrefs } from '../practice/scale-drill';
import { pitchClassName } from '../lib/notes';
import { href } from '../lib/router';
import { Setting, Toggle } from '../ui/SettingRow';
import { t } from '../i18n';
import { BackToDrills } from './ChordDrills';

const TONICS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** The tempos a drill offers, 40 to 160 crotchets a minute in steps of 5. */
const TEMPOS = Array.from(
  { length: (MAX_SCALE_TEMPO - MIN_SCALE_TEMPO) / SCALE_TEMPO_STEP + 1 },
  (_, i) => MIN_SCALE_TEMPO + i * SCALE_TEMPO_STEP,
);

export function ScaleDrills() {
  const [prefs, setPrefs] = useState<ScaleDrillPrefs | null>(null);
  const [stats, setStats] = useState<ScaleStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadScaleDrillPrefs().then((p) => !cancelled && setPrefs(p));
    void loadScaleStats().then((s) => !cancelled && setStats(s));
    return () => {
      cancelled = true;
    };
  }, []);

  const p = prefs ?? DEFAULT_SCALE_DRILL_PREFS;
  const save = (next: ScaleDrillPrefs) => {
    setPrefs(next);
    void saveScaleDrillPrefs(next);
  };
  const set = (patch: Partial<ScaleDrillPrefs>) => save({ ...p, ...patch });
  const setSet = (patch: Partial<ScaleDrillPrefs['set']>) => set({ set: { ...p.set, ...patch } });

  const focus = useMemo(() => (stats && p.weak ? weakScaleFocus(stats, p) : []), [stats, p]);
  const weakest = useMemo(() => (stats ? weakScaleFocus(stats, p) : []), [stats, p]);
  const totals = useMemo(
    () => new Map((stats ? scaleTotals(stats) : []).map((k) => [k.kind, k])),
    [stats],
  );
  const custom = p.level === 'custom';

  return (
    <div className="settings drills">
      <BackToDrills />
      <h1>{t('Scales')}</h1>
      <p className="lead">
        {t(
          'Play each scale up and back down, with the fingers written over the notes. Every drill is new, made on this device. Your results stay here.',
        )}
      </p>
      <section aria-labelledby="scales-title">
        <h2 id="scales-title">{t('Your scales')}</h2>
        <Setting label={t('Level')} hint={t('Each level adds to the ones before it.')}>
          <select
            value={String(p.level)}
            onChange={(e) => {
              const level =
                e.target.value === 'custom' ? 'custom' : (Number(e.target.value) as ScaleLevel);
              save(prefsForLevel(p, level));
            }}
          >
            {SCALE_LEVELS.map((l) => (
              <option key={l} value={l}>
                {t('Level {n}: {name}', { n: l, name: scaleLevelName(l) })}
              </option>
            ))}
            <option value="custom">{scaleLevelName('custom')}</option>
          </select>
        </Setting>
        {custom && (
          <div className="chord-set panel" role="group" aria-label={t('My own set')}>
            <p className="setting__label" id="scale-tonics">
              {t('Keys')}
            </p>
            <div className="chord-roots" role="group" aria-labelledby="scale-tonics">
              {TONICS.map((pc) => {
                const on = p.set.tonics.includes(pc);
                return (
                  <button
                    key={pc}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const tonics = on
                        ? p.set.tonics.filter((x) => x !== pc)
                        : [...p.set.tonics, pc];
                      if (tonics.length > 0) setSet({ tonics: tonics.sort((a, b) => a - b) });
                    }}
                  >
                    {pitchClassName(pc, 'common')}
                  </button>
                );
              })}
            </div>
            <fieldset className="chord-qualities">
              <legend className="setting__label">{t('Scales')}</legend>
              {KINDS.map((k) => {
                const on = p.set.kinds.includes(k);
                return (
                  <label key={k} className="check">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const kinds = on
                          ? p.set.kinds.filter((x) => x !== k)
                          : KINDS.filter((x) => x === k || p.set.kinds.includes(x));
                        if (kinds.length > 0) setSet({ kinds });
                      }}
                    />
                    {scaleKindName(k)}
                  </label>
                );
              })}
            </fieldset>
          </div>
        )}
        <Setting
          label={t('Hands')}
          hint={
            p.hands === 'contrary'
              ? t('Both hands start on the same key and move apart, then come back.')
              : undefined
          }
        >
          <select value={p.hands} onChange={(e) => set({ hands: e.target.value as ScaleHands })}>
            <option value="right">{t('Right hand')}</option>
            <option value="left">{t('Left hand')}</option>
            <option value="together">{t('Hands together')}</option>
            <option value="contrary">{t('Contrary motion')}</option>
          </select>
        </Setting>
        <Setting label={t('Octaves')}>
          <select
            value={p.octaves}
            onChange={(e) => set({ octaves: e.target.value === '2' ? 2 : 1 })}
          >
            <option value={1}>{t('One octave')}</option>
            <option value={2}>{t('Two octaves')}</option>
          </select>
        </Setting>
        <Setting
          label={t('Show')}
          hint={
            p.show === 'memory'
              ? t('The name and the key signature; the notes appear once you have played them.')
              : undefined
          }
        >
          <select
            value={p.show}
            onChange={(e) => set({ show: e.target.value as ScaleDrillPrefs['show'] })}
          >
            <option value="sheet">{t('Sheet')}</option>
            <option value="memory">{t('Name only, from memory')}</option>
            <option value="falling">{t('Falling keys')}</option>
          </select>
        </Setting>
        <Toggle
          label={t('Show the fingers')}
          description={t('The finger for each note, as scale books write it.')}
          checked={p.fingers}
          onChange={(fingers) => set({ fingers })}
        />
        {p.show === 'falling' ? (
          <Setting
            label={t('Keys lit')}
            hint={t('How much the keyboard shows as each note arrives.')}
          >
            <select
              value={p.hint}
              onChange={(e) => set({ hint: e.target.value as ScaleDrillPrefs['hint'] })}
            >
              <option value="level">{t('As the level says')}</option>
              <option value="all">{t('Every note')}</option>
              <option value="tonic">{t('The keynote only')}</option>
              <option value="none">{t('None')}</option>
            </select>
          </Setting>
        ) : (
          <Toggle
            label={t('Show the key to press')}
            description={t('A first step: the keys light up, as in the other pieces.')}
            checked={p.showKeys}
            onChange={(showKeys) => set({ showKeys })}
          />
        )}
        <Setting
          label={t('Pace')}
          hint={
            p.pace === 'wait'
              ? t('The next note comes when the last one is right.')
              : t('One note a beat (or two, in quavers), after a count-in.')
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
            <Setting label={t('Beats a minute')}>
              <select value={p.tempo} onChange={(e) => set({ tempo: Number(e.target.value) })}>
                {TEMPOS.map((bpm) => (
                  <option key={bpm} value={bpm}>
                    {bpm}
                  </option>
                ))}
              </select>
            </Setting>
            <Setting label={t('Notes')}>
              <select
                value={p.rhythm}
                onChange={(e) =>
                  set({ rhythm: e.target.value === 'quavers' ? 'quavers' : 'crotchets' })
                }
              >
                <option value="crotchets">{t('Crotchets, one a beat')}</option>
                <option value="quavers">{t('Quavers, two a beat')}</option>
              </select>
            </Setting>
            <Toggle
              label={t('Speed up as I improve')}
              description={t(
                'Five beats a minute faster after three rounds with 90 % right at the first try; slower after a round under 60 %.',
              )}
              checked={p.ladder}
              onChange={(ladder) => set({ ladder })}
            />
          </>
        )}
        <Setting label={t('Scales a round')}>
          <select value={p.count} onChange={(e) => set({ count: Number(e.target.value) })}>
            {SCALE_COUNTS.map((n) => (
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
        <Toggle
          label={t('Practise my weak scales')}
          description={
            weakest.length > 0
              ? t('More often: {scales}.', {
                  scales: weakest
                    .map((k) =>
                      t('{scale} {percent} %', {
                        scale: scaleKindLabel(k),
                        percent: Math.round((totals.get(k)?.share ?? 0) * 100),
                      }),
                    )
                    .join(', '),
                })
              : t(
                  'Scales under 80 % right at the first try come more often, once you have played a few rounds.',
                )
          }
          checked={p.weak}
          onChange={(weak) => set({ weak })}
        />
        <div className="row">
          <a className="button primary" href={href(scaleDrillRoute(p, focus))}>
            <Play /> {t('Start scales')}
          </a>
        </div>
      </section>
    </div>
  );
}
