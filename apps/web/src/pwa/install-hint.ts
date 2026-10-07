// Remembers whether the user closed the "Add to Home Screen" hint. Safari can delete
// script-written data after seven days without a visit unless OpenTiles runs as a Home Screen app
// (spec §5), so the Home page explains how to install it until the user dismisses the hint.

export const HINT_DISMISSED_KEY = 'opentiles.homeScreenHint.dismissed';

type HintStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage, or null where reading it throws (blocked storage, some private modes). */
function defaultStorage(): HintStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function isHintDismissed(storage: HintStorage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Returns false when the choice could not be stored; the hint still closes for this visit. */
export function dismissHint(storage: HintStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(HINT_DISMISSED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

export interface HintContext {
  /** iPad, iPhone or iPod (including iPadOS reporting itself as a Mac). */
  appleTouch: boolean;
  /** Already running as a Home Screen app. */
  standalone: boolean;
  dismissed: boolean;
}

export function shouldShowHomeScreenHint({ appleTouch, standalone, dismissed }: HintContext) {
  return appleTouch && !standalone && !dismissed;
}

/** Which device to name in the hint text. */
export function deviceName(userAgent: string): 'iPhone' | 'iPad' {
  return /iPhone|iPod/.test(userAgent) ? 'iPhone' : 'iPad';
}
