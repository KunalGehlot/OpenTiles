// What the learner last chose on the practice screen (mode, hands, tempo, metronome), remembered
// on this device between pieces and visits. Stored like the app settings: IndexedDB with a
// localStorage copy (storage/db.ts). Read defensively, since the stored value may be old, edited
// or damaged.
import { getSetting, setSetting } from '../storage/db';

export type PracticeModeChoice = 'wait' | 'listen' | 'play-along';
export type HandChoice = 'left' | 'both' | 'right';

export interface PracticePrefs {
  mode: PracticeModeChoice;
  hands: HandChoice;
  /** Practice tempo as a factor of the written tempo. */
  tempo: number;
  /** Play the other hand when practising one. */
  accompany: boolean;
  metronome: boolean;
  /** Metronome click volume, 0 to 1. */
  clickVolume: number;
}

export const DEFAULT_PRACTICE_PREFS: Readonly<PracticePrefs> = Object.freeze({
  mode: 'wait',
  hands: 'both',
  tempo: 1,
  accompany: true,
  metronome: false,
  clickVolume: 0.5,
});

export const PRACTICE_PREFS_KEY = 'practicePrefs';

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function normalisePracticePrefs(value: unknown): PracticePrefs {
  const d = DEFAULT_PRACTICE_PREFS;
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    mode: v.mode === 'listen' || v.mode === 'play-along' ? v.mode : 'wait',
    hands: v.hands === 'left' || v.hands === 'right' ? v.hands : 'both',
    // The slider runs 25 % to 150 % in steps of 5 %.
    tempo: Math.round(clamp(v.tempo, 0.25, 1.5, d.tempo) * 20) / 20,
    accompany: typeof v.accompany === 'boolean' ? v.accompany : d.accompany,
    metronome: typeof v.metronome === 'boolean' ? v.metronome : d.metronome,
    clickVolume: Math.round(clamp(v.clickVolume, 0, 1, d.clickVolume) * 20) / 20,
  };
}

let current: PracticePrefs | null = null;
let saving: Promise<void> = Promise.resolve();

/** The saved choices, or the defaults when nothing is saved or storage is unavailable. */
export async function loadPracticePrefs(): Promise<PracticePrefs> {
  if (current) return current;
  try {
    current = normalisePracticePrefs(await getSetting<unknown>(PRACTICE_PREFS_KEY, null));
  } catch {
    current = normalisePracticePrefs(null);
  }
  return current;
}

/** Remembers a change. Saves are queued in order and never reject. */
export function savePracticePrefs(patch: Partial<PracticePrefs>): void {
  current = normalisePracticePrefs({ ...(current ?? DEFAULT_PRACTICE_PREFS), ...patch });
  const snapshot = current;
  saving = saving.then(() => setSetting(PRACTICE_PREFS_KEY, snapshot)).catch(() => {});
}

/** Forgets the in-memory copy, so the next load reads storage (after a backup restore). */
export function resetPracticePrefsCache(): void {
  current = null;
}
