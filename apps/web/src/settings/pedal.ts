// Bluetooth foot-pedal page turn (P2-15). Page-turn pedals pair as keyboards and send a key such
// as Right arrow or Page Down; the user picks which in Settings. Views that turn pages call
// `usePedalPageTurn` with what to do; the hook does nothing while the pedal is switched off.
import { useEffect, useRef } from 'react';
import { pedalAction } from './model';
import { appSettings } from './store';

export function usePedalPageTurn(handlers: { onNext: () => void; onPrevious: () => void }): void {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const action = pedalAction(appSettings().pedal, {
        key: e.key,
        repeat: e.repeat,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        inTextField: Boolean(target?.closest?.('input, textarea, select, [contenteditable]')),
      });
      if (action === null) return;
      e.preventDefault();
      if (action === 'next') ref.current.onNext();
      else ref.current.onPrevious();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
