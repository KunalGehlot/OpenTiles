// "Plays on" in the practice session bar (P6-01, ADR 0019): where the app's notes play (Listen,
// the other hand, listening back), always visible, and a warning when the keyboard was chosen but
// the notes play on this device. It writes the same setting as Settings → MIDI keyboard.
import { useId } from 'react';
import { Piano, Speaker, TriangleAlert } from 'lucide-react';
import { t } from '../i18n';
import type { PlaysOn } from '../audio/plays-on';
import type { MidiPlayback } from '../settings/model';
import { Popover } from '../ui/Popover';

export function PlaysOnControl({
  choice,
  route,
  supported,
  keyboardName,
  outputs,
  outputName,
  unavailableHint,
  onChoose,
  onOutput,
}: {
  choice: MidiPlayback;
  route: PlaysOn;
  /** MIDI keyboards can be reached here (Web MIDI, or CoreMIDI in the iPad app). */
  supported: boolean;
  /** The output that belongs to the connected keyboard, if one is known. */
  keyboardName: string | null;
  outputs: readonly string[];
  /** The output chosen by name; empty for the connected keyboard. */
  outputName: string;
  /** Why there is no MIDI here and what works instead, when it is not supported. */
  unavailableHint: string;
  onChoose: (choice: MidiPlayback) => void;
  onOutput: (name: string) => void;
}) {
  const group = useId();
  const label = t('Plays on');
  const shown: MidiPlayback = supported ? choice : 'device';
  const warn = supported && route.problem !== null;
  const names: Record<MidiPlayback, string> = {
    device: t('This device'),
    keyboard: t('My keyboard'),
    both: t('Both'),
  };
  const icon = warn ? (
    <TriangleAlert />
  ) : shown === 'device' ? (
    <Speaker />
  ) : shown === 'keyboard' ? (
    <Piano />
  ) : (
    <>
      <Speaker />
      <Piano />
    </>
  );
  const title =
    route.output !== null
      ? t('The app’s notes play on {name}', { name: route.output })
      : t('The app’s notes play on this device');
  return (
    <Popover
      label={label}
      icon={icon}
      value={names[shown]}
      className={warn ? 'plays-on--warn' : undefined}
      title={title}
      align="start"
    >
      {supported ? (
        <>
          <fieldset className="plays-on__choices">
            <legend className="field__label">{t('App’s notes play on')}</legend>
            {(['device', 'keyboard', 'both'] as const).map((value) => (
              <label className="check" key={value}>
                <input
                  type="radio"
                  name={group}
                  value={value}
                  checked={choice === value}
                  onChange={() => onChoose(value)}
                />
                {names[value]}
                {value === 'keyboard' && keyboardName && (
                  <span className="plays-on__name">({keyboardName})</span>
                )}
              </label>
            ))}
          </fieldset>
          {choice !== 'device' && outputs.length > 1 && (
            <label className="field">
              <span className="field__label">{t('Your keyboard’s MIDI output')}</span>
              <select
                aria-label={t('Your keyboard’s MIDI output')}
                value={outputs.includes(outputName) ? outputName : ''}
                onChange={(e) => onOutput(e.target.value)}
              >
                <option value="">{t('The connected keyboard')}</option>
                {outputs.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="muted popover__hint">
            {t('The metronome and count-in stay on this device.')}
          </p>
        </>
      ) : (
        <p className="popover__hint" data-testid="plays-on-unavailable">
          {unavailableHint}
        </p>
      )}
    </Popover>
  );
}
