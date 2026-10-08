import { useState } from 'react';
import { BackupSection } from '../backup/BackupSection';
import { href } from '../lib/router';
import { customKeyboard, KEYBOARD_PRESETS } from '@opentiles/practice';
import {
  KEYBOARD_SHORTCUTS,
  keyboardLabel,
  lowestKeyChoices,
  MIN_CUSTOM_KEYS,
  PEDAL_KEYS,
  pedalKeyLabel,
} from '../settings/model';
import type {
  AppSettings,
  FingeringDisplay,
  KeyboardSetting,
  PedalSettings,
  TriState,
} from '../settings/model';
import { updateAppSettings, useAppSettings } from '../settings/store';
import { syncServerUrl } from '../sync/config';
import { SyncSection } from '../sync/SyncSection';

/** Default export so the route can be lazy-loaded. */
export default function Settings() {
  const settings = useAppSettings();
  const set = (patch: Partial<AppSettings>) => void updateAppSettings(patch);
  return (
    <article className="settings">
      <h1>Settings</h1>
      <p className="lead">Settings are kept on this device.</p>

      <section aria-labelledby="language-title">
        <h2 id="language-title">Language</h2>
        <Setting label="Language">
          <select
            value={settings.language}
            onChange={(e) => set({ language: e.target.value === 'de' ? 'de' : 'en' })}
          >
            <option value="en">English</option>
            <option value="de" lang="de">
              Deutsch
            </option>
          </select>
        </Setting>
        {settings.language === 'de' && (
          <p className="muted" lang="de">
            Die deutsche Übersetzung kommt bald. Bis dahin ist OpenTiles auf Englisch; die{' '}
            <a href={href({ name: 'privacy', lang: 'de' })}>Datenschutzerklärung</a> und das{' '}
            <a href={href({ name: 'impressum', lang: 'de' })}>Impressum</a> gibt es schon auf
            Deutsch.
          </p>
        )}
      </section>

      <Practice settings={settings} set={set} />
      <Accessibility settings={settings} set={set} />
      <BackupSection />
      <SyncSection />
      <CrashReports settings={settings} set={set} />

      <section aria-labelledby="legal-title">
        <h2 id="legal-title">Privacy and legal</h2>
        <ul className="link-list">
          <li>
            <a href={href({ name: 'privacy', lang: 'en' })}>Privacy policy</a> ·{' '}
            <a href={href({ name: 'privacy', lang: 'de' })} lang="de">
              Datenschutzerklärung
            </a>
          </li>
          <li>
            <a href={href({ name: 'impressum', lang: 'en' })}>Impressum (legal notice)</a> ·{' '}
            <a href={href({ name: 'impressum', lang: 'de' })} lang="de">
              Impressum (Deutsch)
            </a>
          </li>
          <li>
            <a href={href({ name: 'about' })}>About OpenTiles</a>
          </li>
        </ul>
      </section>
    </article>
  );
}

/** One setting: its name (and a line of help) on the left, the control on the right. */
function Setting({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={className ? `setting ${className}` : 'setting'}>
      <span className="setting__text">
        <span className="setting__label">{label}</span>
        {hint && <span className="setting__hint">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <Setting label={label} hint={description} className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </Setting>
  );
}

function TriSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: TriState;
  onChange: (v: TriState) => void;
}) {
  return (
    <Setting label={label}>
      <select
        value={value}
        onChange={(e) =>
          onChange(e.target.value === 'on' ? 'on' : e.target.value === 'off' ? 'off' : 'system')
        }
      >
        <option value="system">Same as this device</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </Setting>
  );
}

const LOWEST_KEYS = lowestKeyChoices();

/** Your keyboard (P4-07) and fingering (P4-08). */
function Practice({
  settings,
  set,
}: {
  settings: AppSettings;
  set: (p: Partial<AppSettings>) => void;
}) {
  const k = settings.keyboard;
  const setKeyboard = (p: Partial<KeyboardSetting>) => set({ keyboard: { ...k, ...p } });
  const custom = customKeyboard(k.low, k.keys);
  const maxKeys = 108 - k.low + 1;
  return (
    <section aria-labelledby="practice-title">
      <h2 id="practice-title">Practice</h2>
      <h3>Your keyboard</h3>
      <p className="muted">
        The practice screen draws the keys your instrument has. A piece that goes beyond them is
        moved by octaves so you can still play it, and the screen says so.
      </p>
      <Setting label="Keyboard size">
        <select value={k.size} onChange={(e) => setKeyboard({ size: e.target.value })}>
          <option value="auto">Fit the keys to each piece</option>
          {KEYBOARD_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {keyboardLabel(p)}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </Setting>
      {k.size === 'custom' && (
        <>
          <Setting label="Lowest key">
            <select
              value={k.low}
              onChange={(e) => {
                const low = Number(e.target.value);
                setKeyboard({ low, keys: Math.min(k.keys, 108 - low + 1) });
              }}
            >
              {LOWEST_KEYS.map((c) => (
                <option key={c.pitch} value={c.pitch}>
                  {c.label}
                </option>
              ))}
            </select>
          </Setting>
          <KeyCountInput value={k.keys} max={maxKeys} onChange={(keys) => setKeyboard({ keys })} />
          <p className="muted" data-testid="custom-keyboard">
            {keyboardLabel(custom)}
          </p>
        </>
      )}

      <h3>Fingering</h3>
      <Setting
        label="Fingers to show"
        hint="Suggested fingers follow common piano fingering and keep any the score already has. They appear on the falling notes, the keys to play next and, lighter, in the score."
      >
        <select
          value={settings.fingering}
          onChange={(e) => set({ fingering: e.target.value as FingeringDisplay })}
        >
          <option value="suggested">Suggested where the score has none</option>
          <option value="written">Only those written in the score</option>
          <option value="off">None</option>
        </select>
      </Setting>
    </section>
  );
}

/** Number of keys, saved once it is a whole number in range; the field may hold a draft. */
function KeyCountInput({
  value,
  max,
  onChange,
}: {
  value: number;
  max: number;
  onChange: (keys: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // Changed elsewhere (another lowest key, a restored backup): show it.
    setLastValue(value);
    setDraft(String(value));
  }
  const n = Number(draft);
  const valid = Number.isInteger(n) && n >= MIN_CUSTOM_KEYS && n <= max;
  return (
    <Setting label="Number of keys">
      <input
        type="number"
        inputMode="numeric"
        min={MIN_CUSTOM_KEYS}
        max={max}
        value={draft}
        aria-invalid={!valid}
        onChange={(e) => {
          setDraft(e.target.value);
          const keys = Number(e.target.value);
          if (Number.isInteger(keys) && keys >= MIN_CUSTOM_KEYS && keys <= max) onChange(keys);
        }}
        onBlur={() => setDraft(String(value))}
      />
    </Setting>
  );
}

function Accessibility({
  settings,
  set,
}: {
  settings: AppSettings;
  set: (p: Partial<AppSettings>) => void;
}) {
  const pedal = settings.pedal;
  const setPedal = (p: Partial<PedalSettings>) => set({ pedal: { ...pedal, ...p } });
  return (
    <section aria-labelledby="a11y-title">
      <h2 id="a11y-title">Accessibility</h2>
      <Toggle
        label="Large print"
        description="Bigger text, buttons and keyboard labels."
        checked={settings.largePrint}
        onChange={(v) => set({ largePrint: v })}
      />
      <TriSelect
        label="High contrast"
        value={settings.highContrast}
        onChange={(v) => set({ highContrast: v })}
      />
      <TriSelect
        label="Reduce motion"
        value={settings.reducedMotion}
        onChange={(v) => set({ reducedMotion: v })}
      />
      <Toggle
        label="Left-handed layout"
        description="Practice controls on the left."
        checked={settings.leftHanded}
        onChange={(v) => set({ leftHanded: v })}
      />

      <h3>Foot pedal page turn</h3>
      <p className="muted">
        Bluetooth page-turn pedals connect like a keyboard. Choose the keys your pedal sends, or
        press the pedal while “Listen” is on.
      </p>
      <Toggle
        label="Turn pages with a foot pedal"
        checked={pedal.enabled}
        onChange={(v) => setPedal({ enabled: v })}
      />
      {pedal.enabled && (
        <>
          <PedalKey
            label="Next page"
            value={pedal.nextKey}
            onChange={(k) => setPedal({ nextKey: k })}
          />
          <PedalKey
            label="Previous page"
            value={pedal.previousKey}
            onChange={(k) => setPedal({ previousKey: k })}
          />
        </>
      )}

      <h3>Keyboard shortcuts</h3>
      <table className="shortcuts">
        <thead>
          <tr>
            <th scope="col">Keys</th>
            <th scope="col">What they do</th>
          </tr>
        </thead>
        <tbody>
          {KEYBOARD_SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td>
                <kbd>{s.keys}</kbd>
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function PedalKey({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (key: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const known = PEDAL_KEYS.some((k) => k.key === value);
  return (
    <div className="setting-pair">
      <Setting label={label}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {PEDAL_KEYS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
          {!known && <option value={value}>{pedalKeyLabel(value)}</option>}
        </select>
      </Setting>
      <button
        aria-pressed={listening}
        onClick={() => setListening(true)}
        onKeyDown={(e) => {
          if (!listening || e.key === 'Tab' || e.key === 'Escape') {
            if (e.key === 'Escape') setListening(false);
            return;
          }
          e.preventDefault();
          onChange(e.key);
          setListening(false);
        }}
        onBlur={() => setListening(false)}
      >
        {listening ? 'Press the pedal…' : 'Listen'}
      </button>
    </div>
  );
}

function CrashReports({
  settings,
  set,
}: {
  settings: AppSettings;
  set: (p: Partial<AppSettings>) => void;
}) {
  const available = syncServerUrl() !== null;
  return (
    <section aria-labelledby="crash-title">
      <h2 id="crash-title">Crash reports</h2>
      <p className="muted">
        Off unless you switch them on. When on, an error that stops the app sends the error message
        and where in the app's code it happened. Titles, file names, links and email addresses are
        removed first, and reports are not linked to you.{' '}
        <a href={href({ name: 'privacy', lang: 'en' })}>Details</a>.
      </p>
      {available ? (
        <Toggle
          label="Send anonymous crash reports"
          checked={settings.crashReports}
          onChange={(v) => set({ crashReports: v })}
        />
      ) : (
        <p className="muted">This copy of OpenTiles has no server to send reports to.</p>
      )}
    </section>
  );
}
