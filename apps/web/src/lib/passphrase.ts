// A rough passphrase strength hint for the backup and sync forms. It is advice, not a gate: the
// vault enforces only the minimum length (8 characters). Argon2id makes each guess expensive, but a
// short or common passphrase is still guessable from a stolen backup file, so we nudge towards
// several random words.
import { MIN_PASSPHRASE_LENGTH } from '@opentiles/vault';

export type StrengthLevel = 0 | 1 | 2 | 3;

export interface PassphraseStrength {
  level: StrengthLevel;
  /** Short label: Too short, Weak, Fair, Strong. */
  label: string;
  hint: string;
}

const COMMON = [
  'password',
  'passwort',
  'qwerty',
  'qwertz',
  '123456',
  'letmein',
  'iloveyou',
  'opentiles',
  'piano',
  'klavier',
  'admin',
  'welcome',
];

/** Estimated bits from length and the kinds of characters used; deliberately conservative. */
export function estimateBits(passphrase: string): number {
  const chars = [...passphrase.normalize('NFC')];
  if (chars.length === 0) return 0;
  let pool = 0;
  if (chars.some((c) => /[a-z]/.test(c))) pool += 26;
  if (chars.some((c) => /[A-Z]/.test(c))) pool += 26;
  if (chars.some((c) => /[0-9]/.test(c))) pool += 10;
  if (chars.some((c) => /\s/.test(c))) pool += 1;
  if (chars.some((c) => /[^a-zA-Z0-9\s]/.test(c))) pool += 20;
  const unique = new Set(chars).size;
  // Repeated characters add little.
  const effective = Math.min(chars.length, unique * 2);
  return Math.round(effective * Math.log2(Math.max(pool, 2)));
}

export function passphraseStrength(passphrase: string): PassphraseStrength {
  const length = [...passphrase.normalize('NFC')].length;
  if (length < MIN_PASSPHRASE_LENGTH) {
    return {
      level: 0,
      label: 'Too short',
      hint: `Use at least ${MIN_PASSPHRASE_LENGTH} characters. Four or five random words work well.`,
    };
  }
  const lower = passphrase.toLowerCase();
  if (COMMON.some((w) => lower.includes(w)) && length < 16) {
    return {
      level: 1,
      label: 'Weak',
      hint: 'This contains a very common word or pattern. Add a few unrelated words.',
    };
  }
  const words = passphrase
    .trim()
    .split(/[\s\-_.]+/)
    .filter((w) => w.length >= 3).length;
  const bits = estimateBits(passphrase);
  if (bits >= 70 || (words >= 4 && length >= 20)) {
    return { level: 3, label: 'Strong', hint: 'Good. Keep it somewhere safe.' };
  }
  if (bits >= 50 || (words >= 3 && length >= 15)) {
    return { level: 2, label: 'Fair', hint: 'Fair. One or two more words would make it strong.' };
  }
  return {
    level: 1,
    label: 'Weak',
    hint: 'Easy to guess. Make it longer, for example four or five random words.',
  };
}
