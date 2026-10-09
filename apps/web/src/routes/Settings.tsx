import { useEffect, useState } from 'react';
import { BackupSection } from '../backup/BackupSection';
import { href } from '../lib/router';
import { customKeyboard, KEYBOARD_PRESETS } from '@opentiles/practice';
import {
  keyboardLabel,
  keyboardShortcuts,
  lowestKeyChoices,
  MIN_CUSTOM_KEYS,
  PEDAL_KEYS,
  pedalKeyLabel,
} from '../settings/model';
import type {
  AppSettings,
  FingeringDisplay,
  KeyboardSetting,
  MidiPlayback,
  PedalSettings,
  TriState,
} from '../settings/model';
import { updateAppSettings, useAppSettings } from '../settings/store';
import { syncServerUrl } from '../sync/config';
import { SyncSection } from '../sync/SyncSection';
import { language, t } from '../i18n';
import { now, unlockAudio } from '../audio/context';
import { MidiOutInstrument } from '../audio/midi-out';
import {
  createMidiInput,
  describeMidiError,
  midiSupported,
  midiUnavailableMessage,
  midiUnavailableReason,
  noKeyboardMessage,
  pickOutput,
} from '../input/midi-input';
import type { MidiKeyboardInput } from '../input/midi-input';
import { labelStyleFor, noteLabel } from '../lib/notes';
import type { NoteLabelSetting } from '../lib/notes';

/** Default export so the route can be lazy-loaded. */
export default function Settings() {
  const settings = useAppSettings();
  const set = (patch: Partial<AppSettings>) => void updateAppSettings(patch);
  return (
    <article className="settings">
      <h1>{t('Settings')}</h1>
      <p className="lead">{t('Settings are kept on this device.')}</p>

      <section aria-labelledby="language-title">
        <h2 id="language-title">{t('Language')}</h2>
        <Setting label={t('Language')}>
          <select
            value={settings.language}
            onChange={(e) => set({ language: e.target.value === 'de' ? 'de' : 'en' })}
          >
            <option value="en" lang="en">
              English
            </option>
            <option value="de" lang="de">
              Deutsch
            </option>
          </select>
        </Setting>
      </section>

      <Practice settings={settings} set={set} />
      <MidiSection settings={settings} set={set} />
      <Accessibility settings={settings} set={set} />
      <BackupSection />
      <SyncSection />
      <CrashReports settings={settings} set={set} />

      <section aria-labelledby="legal-title">
        <h2 id="legal-title">{t('Privacy and legal')}</h2>
        <ul className="link-list">
          <li>
            <a href={href({ name: 'privacy', lang: 'en' })} lang="en">
              Privacy policy
            </a>{' '}
            ·{' '}
            <a href={href({ name: 'privacy', lang: 'de' })} lang="de">
              Datenschutzerklärung
            </a>
          </li>
          <li>
            <a href={href({ name: 'impressum', lang: 'en' })} lang="en">
              Impressum (legal notice)
            </a>{' '}
            ·{' '}
            <a href={href({ name: 'impressum', lang: 'de' })} lang="de">
              Impressum (Deutsch)
            </a>
          </li>
          <li>
            <a href={href({ name: 'about' })}>{t('About OpenTiles')}</a>
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
        <option value="system">{t('Same as this device')}</option>
        <option value="on">{t('On')}</option>
        <option value="off">{t('Off')}</option>
      </select>
    </Setting>
  );
}

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
      <h2 id="practice-title">{t('Practice')}</h2>
      <h3>{t('Your keyboard')}</h3>
      <p className="muted">
        {t(
          'The practice screen draws the keys your instrument has. A piece that goes beyond them is moved by octaves so you can still play it, and the screen says so.',
        )}
      </p>
      <Setting label={t('Keyboard size')}>
        <select value={k.size} onChange={(e) => setKeyboard({ size: e.target.value })}>
          <option value="auto">{t('Fit the keys to each piece')}</option>
          {KEYBOARD_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {keyboardLabel(p)}
            </option>
          ))}
          <option value="custom">{t('Custom')}</option>
        </select>
      </Setting>
      {k.size === 'custom' && (
        <>
          <Setting label={t('Lowest key')}>
            <select
              value={k.low}
              onChange={(e) => {
                const low = Number(e.target.value);
                setKeyboard({ low, keys: Math.min(k.keys, 108 - low + 1) });
              }}
            >
              {lowestKeyChoices().map((c) => (
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

      <h3>{t('Fingering')}</h3>
      <Setting
        label={t('Fingers to show')}
        hint={t(
          'Suggested fingers follow common piano fingering and keep any the score already has. They appear on the falling notes, the keys to play next and, lighter, in the score.',
        )}
      >
        <select
          value={settings.fingering}
          onChange={(e) => set({ fingering: e.target.value as FingeringDisplay })}
        >
          <option value="suggested">{t('Suggested where the score has none')}</option>
          <option value="written">{t('Only those written in the score')}</option>
          <option value="off">{t('None')}</option>
        </select>
      </Setting>
      <Toggle
        label={t('Note names')}
        description={t(
          'Show the name of each note at the top of the falling notes and on the keys to play. The fingers stay where they are.',
        )}
        checked={settings.noteNames}
        onChange={(noteNames) => set({ noteNames })}
      />
      <Setting
        label={t('How note names are written')}
        hint={t(
          'On the falling notes, the keys and everywhere else the app names a note. Middle C is C4 (Do4) in every style.',
        )}
      >
        <select
          value={settings.noteLabels}
          onChange={(e) => set({ noteLabels: e.target.value as NoteLabelSetting })}
        >
          <option value="auto">
            {t('As the language: {names}', {
              names:
                labelStyleFor('auto', settings.language) === 'german'
                  ? 'C D E F G A H'
                  : 'C D E F G A B',
            })}
          </option>
          <option value="letters">{t('Letters: C D E F G A B')}</option>
          <option value="german">{t('German: C D E F G A H, with B for B♭')}</option>
          <option value="fixed-do">{t('Fixed do: Do Re Mi Fa Sol La Si')}</option>
        </select>
      </Setting>
    </section>
  );
}

/**
 * MIDI keyboard: where notes sound, which output to play on, and a live test that shows what the
 * keyboard sends, so a learner can tell at once whether this browser hears it.
 */
function MidiSection({
  settings,
  set,
}: {
  settings: AppSettings;
  set: (p: Partial<AppSettings>) => void;
}) {
  const m = settings.midi;
  const setMidi = (p: Partial<AppSettings['midi']>) => set({ midi: { ...m, ...p } });
  const [input, setInput] = useState<MidiKeyboardInput | null>(null);
  const [devices, setDevices] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[]>([]);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => () => input?.stop(), [input]);

  const test = async () => {
    setError(null);
    try {
      const next = createMidiInput();
      next.onNote = (e) => setLastNote(`${noteLabel(e.pitch)} (${e.velocity ?? 0})`);
      next.onDevicesChanged = (names) => {
        setDevices(names);
        setOutputs(next.outputNames);
      };
      await next.start();
      setInput(next);
      setDevices(next.deviceNames);
      setOutputs(next.outputNames);
      if (next.deviceNames.length === 0) setError(noKeyboardMessage(navigator.userAgent));
    } catch (e) {
      setError(describeMidiError(e, navigator.userAgent));
    }
  };

  const sendTestNote = async () => {
    const sink = input?.output(m.output);
    if (!sink) return;
    await unlockAudio();
    const out = new MidiOutInstrument(sink, now);
    out.play(60, now(), 0.6, 90);
  };

  const supported = midiSupported();
  const chosen = pickOutput(outputs, devices, m.output);
  return (
    <section aria-labelledby="midi-title">
      <h2 id="midi-title">{t('MIDI keyboard')}</h2>
      {!supported && (
        <p className="notice">
          {midiUnavailableMessage(
            midiUnavailableReason({
              userAgent: navigator.userAgent,
              maxTouchPoints: navigator.maxTouchPoints,
              secure: window.isSecureContext,
            }),
          )}
        </p>
      )}
      <Toggle
        label={t('Play my MIDI keys on this device')}
        description={t(
          'The notes you play on the keyboard also sound from this computer or tablet: for a keyboard without speakers, or to listen in headphones on this device. Turn the keyboard’s own volume down if you hear both.',
        )}
        checked={m.echo}
        onChange={(echo) => setMidi({ echo })}
      />
      <Setting
        label={t('App’s notes play on')}
        hint={t(
          'Listen mode, the other hand and listening back. “My MIDI keyboard” plays them with the keyboard’s own sound; the metronome stays on this device.',
        )}
      >
        <select
          value={m.playback}
          onChange={(e) => setMidi({ playback: e.target.value as MidiPlayback })}
        >
          <option value="device">{t('This device')}</option>
          <option value="keyboard">{t('My MIDI keyboard')}</option>
          <option value="both">{t('Both')}</option>
        </select>
      </Setting>
      {supported && (
        <>
          <h3>{t('Test your keyboard')}</h3>
          <p className="muted">
            {t(
              'Connect the keyboard and switch it on, then press Test and play a key. The note shows here, so you can see that this browser hears it.',
            )}
          </p>
          <div className="row">
            <button onClick={() => void test()}>{input ? t('Test again') : t('Test')}</button>
            {input && chosen && (
              <button onClick={() => void sendTestNote()}>{t('Play a test note on it')}</button>
            )}
          </div>
          {input && (
            <ul className="muted" data-testid="midi-test">
              <li>{t('Keyboards: {names}', { names: devices.join(', ') || t('none found') })}</li>
              <li>{t('Last note: {note}', { note: lastNote ?? t('none yet — play a key') })}</li>
            </ul>
          )}
          {input && outputs.length > 1 && (
            <Setting label={t('Play the app’s notes on')}>
              <select value={m.output} onChange={(e) => setMidi({ output: e.target.value })}>
                <option value="">{t('The connected keyboard')}</option>
                {outputs.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Setting>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
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
    <Setting label={t('Number of keys')}>
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
      <h2 id="a11y-title">{t('Accessibility')}</h2>
      <Toggle
        label={t('Large print')}
        description={t('Bigger text, buttons and keyboard labels.')}
        checked={settings.largePrint}
        onChange={(v) => set({ largePrint: v })}
      />
      <TriSelect
        label={t('High contrast')}
        value={settings.highContrast}
        onChange={(v) => set({ highContrast: v })}
      />
      <TriSelect
        label={t('Reduce motion')}
        value={settings.reducedMotion}
        onChange={(v) => set({ reducedMotion: v })}
      />
      <Toggle
        label={t('Left-handed layout')}
        description={t('Practice controls on the left.')}
        checked={settings.leftHanded}
        onChange={(v) => set({ leftHanded: v })}
      />

      <h3>{t('Foot pedal page turn')}</h3>
      <p className="muted">
        {t(
          'Bluetooth page-turn pedals connect like a keyboard. Choose the keys your pedal sends, or press the pedal after “Detect key”.',
        )}
      </p>
      <Toggle
        label={t('Turn pages with a foot pedal')}
        checked={pedal.enabled}
        onChange={(v) => setPedal({ enabled: v })}
      />
      {pedal.enabled && (
        <>
          <PedalKey
            label={t('Next page')}
            value={pedal.nextKey}
            onChange={(k) => setPedal({ nextKey: k })}
          />
          <PedalKey
            label={t('Previous page')}
            value={pedal.previousKey}
            onChange={(k) => setPedal({ previousKey: k })}
          />
        </>
      )}

      <h3>{t('Keyboard shortcuts')}</h3>
      <table className="shortcuts">
        <thead>
          <tr>
            <th scope="col">{t('Keys')}</th>
            <th scope="col">{t('What they do')}</th>
          </tr>
        </thead>
        <tbody>
          {keyboardShortcuts().map((s) => (
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
  const known = PEDAL_KEYS.includes(value);
  return (
    <div className="setting-pair">
      <Setting label={label}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {PEDAL_KEYS.map((k) => (
            <option key={k} value={k}>
              {pedalKeyLabel(k)}
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
        {listening ? t('Press the pedal…') : t('Detect key')}
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
      <h2 id="crash-title">{t('Crash reports')}</h2>
      <p className="muted">
        {t(
          "Off unless you switch them on. When on, an error that stops the app sends the error message and where in the app's code it happened. Titles, file names, links and email addresses are removed first, and reports are not linked to you.",
        )}{' '}
        <a href={href({ name: 'privacy', lang: language() })}>{t('Details')}</a>.
      </p>
      {available ? (
        <Toggle
          label={t('Send anonymous crash reports')}
          checked={settings.crashReports}
          onChange={(v) => set({ crashReports: v })}
        />
      ) : (
        <p className="muted">{t('This copy of OpenTiles has no server to send reports to.')}</p>
      )}
    </section>
  );
}
