import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { t } from '../i18n';

/** The upload-rights confirmation before the first import (docs/legal-guardrails.md). */
export function RightsDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="panel stack" role="dialog" aria-labelledby="rights-title">
      <h2 id="rights-title">
        <ShieldCheck /> {t('Before your first import')}
      </h2>
      <p>
        {t(
          'Your library is private: files stay on this device and OpenTiles has no way to share them. Please only import music you have the right to use for your own practice — for example scores you bought, wrote or transcribed yourself, or public-domain music.',
        )}
      </p>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        {t('I only import files I have the right to use for personal practice.')}
      </label>
      <div className="row">
        <button className="primary" disabled={!checked} onClick={onConfirm}>
          {t('Continue')}
        </button>
        <button onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </div>
  );
}
