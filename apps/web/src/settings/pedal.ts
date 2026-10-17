// Bluetooth foot-pedal page turn (P2-15). Page-turn pedals pair as keyboards and send a key such
// as Right arrow or Page Down. Every page view (the engraved pages, the learner's sheet and the
// sheet reader) turns with the usual keys, and with the keys chosen for a pedal in Settings while
// it is switched on.
import { pedalAction } from './model';
import type { PedalSettings } from './model';

/** What most page-turn pedals send, and the arrow keys. */
const NEXT_KEYS = new Set(['PageDown', 'ArrowRight', 'Space']);
const PREVIOUS_KEYS = new Set(['PageUp', 'ArrowLeft']);

/**
 * Which way a key press turns a page view: 1, -1, or 0 for none. The pedal's own keys come first
 * (not when held down or with a modifier); then the usual ones, Space by its key code.
 */
export function pageTurn(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  pedal: PedalSettings,
): 1 | -1 | 0 {
  const action = pedalAction(pedal, event);
  if (action) return action === 'next' ? 1 : -1;
  if (event.altKey || event.ctrlKey || event.metaKey) return 0;
  const key = event.code === 'Space' ? 'Space' : event.key;
  return NEXT_KEYS.has(key) ? 1 : PREVIOUS_KEYS.has(key) ? -1 : 0;
}
