// Input calibration per device (PLAN.md P1-19, P1-20), in the settings table on this device only.
// Keys hold the device's name as the browser reports it; nothing here leaves the device.
import { getSetting, setSetting } from './db';

export interface MidiCalibration {
  /** Seconds to subtract from note times in play-along. */
  latency: number;
  measuredAt: number;
}

export interface MicCalibration {
  /** Median per-bin room noise from the detector (dB), for comparison on later starts. */
  noiseDb: number | null;
  /** Quiet-room level (RMS dBFS). */
  roomDb: number | null;
  /** Loudest key played during calibration (RMS dBFS). */
  peakDb: number | null;
  /** Tuning offset from A = 440 Hz, cents. */
  tuningCents: number | null;
  /** Input latency for play-along, seconds (null when the speaker test was skipped). */
  latency: number | null;
  measuredAt: number;
}

const midiKey = (device: string) => `calibration:midi:${device || 'default'}`;
const micKey = (device: string) => `calibration:mic:${device || 'default'}`;
const MIC_SKIPPED = 'calibration:mic:skipped';

export function getMidiCalibration(device: string): Promise<MidiCalibration | null> {
  return getSetting<MidiCalibration | null>(midiKey(device), null);
}

export function setMidiCalibration(device: string, c: MidiCalibration): Promise<void> {
  return setSetting(midiKey(device), c);
}

export function getMicCalibration(device: string): Promise<MicCalibration | null> {
  return getSetting<MicCalibration | null>(micKey(device), null);
}

export function setMicCalibration(device: string, c: MicCalibration): Promise<void> {
  return setSetting(micKey(device), c);
}

/** Devices whose guided calibration the learner skipped; they are not asked again. */
export async function micCalibrationSkipped(device: string): Promise<boolean> {
  const list = await getSetting<string[]>(MIC_SKIPPED, []);
  return list.includes(device || 'default');
}

export async function skipMicCalibration(device: string): Promise<void> {
  const list = await getSetting<string[]>(MIC_SKIPPED, []);
  const key = device || 'default';
  if (!list.includes(key)) await setSetting(MIC_SKIPPED, [...list, key]);
}
