import { useState } from 'react';
import { isAppleTouchDevice, isStandalone } from '../storage/persist';
import { deviceName, dismissHint, isHintDismissed, shouldShowHomeScreenHint } from './install-hint';

/**
 * Explains Add to Home Screen to iPad and iPhone users browsing in a normal tab (spec §5). iOS has
 * no install prompt a page can trigger, so this is a plain, dismissible notice; dismissal is
 * remembered on this device.
 */
export function HomeScreenHint() {
  const [visible, setVisible] = useState(() =>
    shouldShowHomeScreenHint({
      appleTouch: isAppleTouchDevice(),
      standalone: isStandalone(),
      dismissed: isHintDismissed(),
    }),
  );
  if (!visible) return null;
  const device = deviceName(navigator.userAgent);
  return (
    <aside className="notice home-screen-hint" aria-label="Add OpenTiles to your Home Screen">
      <p>
        <strong>Add OpenTiles to your Home Screen.</strong> Tap the Share button, then{' '}
        <strong>Add to Home Screen</strong>, and open OpenTiles from its icon. It then opens full
        screen, works offline and keeps your library and progress safe on this {device}. In a normal
        browser tab, Safari may delete them after seven days without a visit.
      </p>
      <button
        onClick={() => {
          dismissHint();
          setVisible(false);
        }}
      >
        Got it
      </button>
    </aside>
  );
}
