import { useRef, useState } from 'react';
import { readBackupManifest } from '@opentiles/vault';
import { describeError } from '../lib/errors';
import { passphraseStrength } from '../lib/passphrase';
import { reloadAppSettings } from '../settings/store';
import { requestPersistence } from '../storage/persist';
import { backupFileName, createBackupFile, restoreBackupFile } from './backup';
import type { BackupStage, RestoreSummary } from './backup';
import { locale, t } from '../i18n';

function stageOf(stage: BackupStage): { label: string; value: number } {
  switch (stage) {
    case 'collecting':
      return { label: t('Collecting your library…'), value: 0.15 };
    case 'deriving-key':
      return { label: t('Protecting the key with your passphrase…'), value: 0.4 };
    case 'encrypting':
      return { label: t('Encrypting…'), value: 0.75 };
    case 'decrypting':
      return { label: t('Checking the passphrase and decrypting…'), value: 0.4 };
    default:
      return { label: t('Adding to this device…'), value: 0.8 };
  }
}

function Progress({ stage }: { stage: BackupStage | 'done' | null }) {
  if (stage === null) return null;
  const s = stage === 'done' ? { label: t('Done.'), value: 1 } : stageOf(stage);
  return (
    <div className="stack" aria-live="polite">
      <progress max={1} value={s.value} aria-label={t('Backup progress')} />
      <span className="muted">{s.label}</span>
    </div>
  );
}

function download(bytes: Uint8Array, name: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function BackupSection() {
  return (
    <section aria-labelledby="backup-title" className="stack">
      <h2 id="backup-title">{t('Backup')}</h2>
      <p className="muted">
        {t(
          'Save your library, progress and settings in one encrypted file that you keep. It never leaves this device unless you move it yourself. Without the passphrase nobody can open it, not even the OpenTiles project — so write the passphrase down.',
        )}
      </p>
      <ExportBackup />
      <ImportBackup />
    </section>
  );
}

function ExportBackup() {
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [stage, setStage] = useState<BackupStage | 'done' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const strength = passphraseStrength(pass);
  const mismatch = again.length > 0 && again !== pass;
  const busy = stage !== null && stage !== 'done';

  const run = async () => {
    setError(null);
    try {
      const file = await createBackupFile(pass, { onProgress: setStage });
      download(file, backupFileName());
      setStage('done');
      setPass('');
      setAgain('');
    } catch (e) {
      setStage(null);
      setError(describeError(e));
    }
  };

  if (!open) {
    return (
      <div className="row">
        <button className="primary" onClick={() => setOpen(true)}>
          {t('Export backup…')}
        </button>
      </div>
    );
  }
  return (
    <form
      className="panel stack"
      aria-labelledby="export-title"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <h3 id="export-title">{t('Export an encrypted backup')}</h3>
      <label>
        {t('Passphrase')}
        <input
          type="password"
          autoComplete="new-password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
      </label>
      <p className={`strength strength--${strength.level}`} aria-live="polite">
        <strong>{strength.label}.</strong> {strength.hint}
      </p>
      <label>
        {t('Passphrase again')}
        <input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {mismatch && <p className="error">{t('The two passphrases are different.')}</p>}
      <Progress stage={stage} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button
          type="submit"
          className="primary"
          disabled={busy || strength.level === 0 || again !== pass}
        >
          {t('Download backup')}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={busy}>
          {t('Close')}
        </button>
      </div>
    </form>
  );
}

function ImportBackup() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; createdAt: string } | null>(
    null,
  );
  const [pass, setPass] = useState('');
  const [useCode, setUseCode] = useState(false);
  const [stage, setStage] = useState<BackupStage | 'done' | null>(null);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = stage !== null && stage !== 'done';

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setSummary(null);
    setStage(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const manifest = readBackupManifest(bytes);
      setFile({ name: f.name, bytes, createdAt: manifest.createdAt });
    } catch (e) {
      setFile(null);
      setError(describeError(e));
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  const run = async () => {
    if (!file) return;
    setError(null);
    try {
      const result = await restoreBackupFile(
        file.bytes,
        useCode ? { recoveryCode: pass } : { passphrase: pass },
        { onProgress: setStage },
      );
      await reloadAppSettings();
      await requestPersistence();
      setStage('done');
      setSummary(result);
      setFile(null);
      setPass('');
    } catch (e) {
      setStage(null);
      setError(describeError(e));
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <button onClick={() => input.current?.click()}>{t('Restore from a backup…')}</button>
        <input
          ref={input}
          type="file"
          hidden
          accept=".zip,application/zip"
          aria-label={t('Backup file')}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      {file && (
        <form
          className="panel stack"
          aria-labelledby="import-title"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <h3 id="import-title">{t('Restore {name}', { name: file.name })}</h3>
          <p className="muted">
            {t('Made on {date}. Pieces already on this device are kept and not added twice.', {
              date: new Date(file.createdAt).toLocaleString(locale()),
            })}
          </p>
          <label>
            {useCode ? t('Recovery code') : t('Backup passphrase')}
            <input
              type={useCode ? 'text' : 'password'}
              autoComplete="off"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={useCode}
              onChange={(e) => setUseCode(e.target.checked)}
            />
            {t('Use a recovery code instead')}
          </label>
          <Progress stage={stage} />
          <div className="row">
            <button type="submit" className="primary" disabled={busy || pass.length === 0}>
              {t('Restore')}
            </button>
            <button type="button" onClick={() => setFile(null)} disabled={busy}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {summary && (
        <p className="notice" role="status">
          {t('Restored:')}{' '}
          {[
            summary.added === 1 ? t('1 piece added') : t('{n} pieces added', { n: summary.added }),
            ...(summary.skipped > 0 ? [t('{n} already here', { n: summary.skipped })] : []),
            summary.progress === 1
              ? t('1 progress entry merged')
              : t('{n} progress entries merged', { n: summary.progress }),
          ].join(', ')}
          .
        </p>
      )}
    </div>
  );
}
