import { useState } from 'react';
import { BackupSection } from '../backup/BackupSection';
import { href } from '../lib/router';
import { KEYBOARD_SHORTCUTS, PEDAL_KEYS, pedalKeyLabel } from '../settings/model';
import type { AppSettings, PedalSettings, TriState } from '../settings/model';
import { updateAppSettings, useAppSettings } from '../settings/store';
import { syncServerUrl } from '../sync/config';
import { SyncSection } from '../sync/SyncSection';

/** Default export so the route can be lazy-loaded. */
export default function Settings() {
  const settings = useAppSettings();
  const set = (patch: Partial<AppSettings>) => void updateAppSettings(patch);
  return (
    <article className="stack settings" style={{ maxWidth: '72ch' }}>
      <h1>Settings</h1>
      <p className="lead">Settings are kept on this device.</p>

      <section aria-labelledby="language-title" className="stack">
        <h2 id="language-title">Language</h2>
        <label>
          Language
          <select
            value={settings.language}
            onChange={(e) => set({ language: e.target.value === 'de' ? 'de' : 'en' })}
          >
            <option value="en">English</option>
            <option value="de" lang="de">
              Deutsch
            </option>
          </select>
        </label>
        {settings.language === 'de' && (
          <p className="muted" lang="de">
            Die deutsche Übersetzung kommt bald. Bis dahin ist OpenTiles auf Englisch; die{' '}
            <a href={href({ name: 'privacy', lang: 'de' })}>Datenschutzerklärung</a> und das{' '}
            <a href={href({ name: 'impressum', lang: 'de' })}>Impressum</a> gibt es schon auf
            Deutsch.
          </p>
        )}
      </section>

      <Accessibility settings={settings} set={set} />
      <BackupSection />
      <SyncSection />
      <CrashReports settings={settings} set={set} />

      <section aria-labelledby="legal-title" className="stack">
        <h2 id="legal-title">Privacy and legal</h2>
        <ul>
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
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {description && <span className="muted"> — {description}</span>}
      </span>
    </label>
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
    <label>
      {label}
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
    </label>
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
    <section aria-labelledby="a11y-title" className="stack">
      <h2 id="a11y-title">Accessibility</h2>
      <Toggle
        label="Large print"
        description="bigger text, buttons and keyboard labels"
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
        description="practice controls on the left"
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
        <div className="stack">
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
        </div>
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
    <div className="row">
      <label>
        {label}
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {PEDAL_KEYS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
          {!known && <option value={value}>{pedalKeyLabel(value)}</option>}
        </select>
      </label>
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
    <section aria-labelledby="crash-title" className="stack">
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
