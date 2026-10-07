import { useSyncExternalStore } from 'react';
import { updates } from './update-store';

/**
 * A small bar shown when a new version of the app is installed and waiting. It never reloads by
 * itself (a reload would end a practice run) and, once dismissed, stays away for this visit.
 */
export function UpdateBar() {
  const status = useSyncExternalStore(
    updates.subscribe,
    updates.getSnapshot,
    () => 'idle' as const,
  );
  if (status !== 'available' && status !== 'applying') return null;
  return (
    <div className="update-bar" role="status">
      <span>Update available</span>
      <button
        className="primary"
        disabled={status === 'applying'}
        onClick={() => void updates.apply()}
      >
        {status === 'applying' ? 'Reloading…' : 'Reload'}
      </button>
      <button className="update-bar__close" aria-label="Dismiss" onClick={updates.dismiss}>
        ×
      </button>
    </div>
  );
}
