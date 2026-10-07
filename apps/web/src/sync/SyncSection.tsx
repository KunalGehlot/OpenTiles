// Settings → Sync (P3-03). Shown only when the build has a sync server (VITE_SYNC_URL).
import { useEffect, useState } from 'react';
import { describeError } from '../lib/errors';
import { passphraseStrength } from '../lib/passphrase';
import { getSyncController, useSyncState } from './controller';
import type { SyncController } from './local';
import { passkeysSupported } from './webauthn';

export function SyncSection() {
  const controller = getSyncController();
  if (controller === null) return null;
  return (
    <section aria-labelledby="sync-title" className="stack">
      <h2 id="sync-title">Sync</h2>
      <p className="muted">
        Keep your library on several devices. Everything is encrypted on this device with your sync
        passphrase before it is uploaded; the server stores only your email address and data it
        cannot read.
      </p>
      <SyncBody controller={controller} />
    </section>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

function SyncBody({ controller }: { controller: SyncController }) {
  const state = useSyncState();
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  if (recoveryCode !== null) {
    return <RecoveryCode code={recoveryCode} onDone={() => setRecoveryCode(null)} />;
  }
  switch (state.phase) {
    case 'loading':
      return <p className="muted">Loading…</p>;
    case 'signed-out':
      return <SignIn controller={controller} />;
    case 'needs-vault':
      return state.accountHasVault === false ? (
        <CreateKey controller={controller} onCode={setRecoveryCode} />
      ) : (
        <Unlock controller={controller} />
      );
    case 'ready':
      return <Ready controller={controller} />;
  }
}

function SignIn({ controller }: { controller: SyncController }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const { busy, error, run } = useAction();
  return (
    <div className="panel stack">
      <h3>Sign in</h3>
      {passkeysSupported() && (
        <div className="row">
          <button disabled={busy} onClick={() => void run(() => controller.signInWithPasskey())}>
            Sign in with a passkey
          </button>
        </div>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await controller.startEmailSignIn(email);
            setSent(true);
          });
        }}
      >
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <div className="row">
          <button type="submit" disabled={busy || !email.includes('@')}>
            Email me a sign-in link
          </button>
        </div>
      </form>
      {sent && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => controller.finishEmailSignIn({ email, code }));
          }}
        >
          <p className="notice" role="status">
            We sent a link and an 8-digit code to {email}. Open the link on this device, or type the
            code here — on iPad, the code is easier if you added OpenTiles to the Home Screen.
          </p>
          <label>
            Code
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={busy || code.length < 8}>
              Sign in
            </button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CreateKey({
  controller,
  onCode,
}: {
  controller: SyncController;
  onCode: (code: string) => void;
}) {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, run } = useAction();
  const strength = passphraseStrength(pass);
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const code = await controller.createLibraryKey(pass);
          if (code) onCode(code);
        });
      }}
    >
      <h3>Choose a sync passphrase</h3>
      <p className="muted">
        You type it once on each new device. It never leaves this device. If you forget it and lose
        the recovery code, the synced copy cannot be opened by anyone.
      </p>
      <label>
        Sync passphrase
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
        Passphrase again
        <input
          type="password"
          autoComplete="new-password"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
      </label>
      {again.length > 0 && again !== pass && (
        <p className="error">The two passphrases are different.</p>
      )}
      {busy && <p className="muted">Protecting the key with your passphrase…</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button
          type="submit"
          className="primary"
          disabled={busy || strength.level === 0 || again !== pass}
        >
          Turn on sync
        </button>
        <button type="button" onClick={() => void controller.signOut()} disabled={busy}>
          Sign out
        </button>
      </div>
    </form>
  );
}

function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [kept, setKept] = useState(false);
  return (
    <div className="panel stack" role="alertdialog" aria-labelledby="recovery-title">
      <h3 id="recovery-title">Your recovery code</h3>
      <p className="notice notice--warn">
        <strong>This is shown only once.</strong> Write it down or print it and keep it somewhere
        safe. If you forget your passphrase, this code is the only way to open your synced library.
        Nobody else can recover it for you.
      </p>
      <p className="recovery-code" translate="no">
        {code}
      </p>
      <div className="row">
        <button onClick={() => window.print()}>Print</button>
        <button onClick={() => void navigator.clipboard?.writeText(code)}>Copy</button>
      </div>
      <label>
        <input type="checkbox" checked={kept} onChange={(e) => setKept(e.target.checked)} />I have
        written down or saved my recovery code.
      </label>
      <div className="row">
        <button className="primary" disabled={!kept} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function Unlock({ controller }: { controller: SyncController }) {
  const [secret, setSecret] = useState('');
  const [useCode, setUseCode] = useState(false);
  const { busy, error, run, setError } = useAction();
  return (
    <form
      className="panel stack"
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const ok = await controller.unlock(
            useCode ? { recoveryCode: secret } : { passphrase: secret },
          );
          if (!ok) setError('Sync is not set up for this account yet.');
        });
      }}
    >
      <h3>Unlock sync on this device</h3>
      <p className="muted">
        Signed in{controller.state.email ? ` as ${controller.state.email}` : ''}. Enter the sync
        passphrase you chose on your first device.
      </p>
      <label>
        {useCode ? 'Recovery code' : 'Sync passphrase'}
        <input
          type={useCode ? 'text' : 'password'}
          autoComplete={useCode ? 'off' : 'current-password'}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
      </label>
      <label>
        <input type="checkbox" checked={useCode} onChange={(e) => setUseCode(e.target.checked)} />
        Use the recovery code instead
      </label>
      {busy && <p className="muted">Unlocking…</p>}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy || secret.length === 0}>
          Unlock
        </button>
        <button type="button" onClick={() => void controller.signOut()} disabled={busy}>
          Sign out
        </button>
      </div>
    </form>
  );
}

function Ready({ controller }: { controller: SyncController }) {
  const state = useSyncState();
  const { busy, error, run } = useAction();
  const [confirmDelete, setConfirmDelete] = useState('');
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const last = state.lastSync;
  return (
    <div className="panel stack">
      <p>
        Sync is on{state.email ? ` for ${state.email}` : ''}.{' '}
        <span className="muted" role="status">
          {state.busy
            ? 'Syncing…'
            : last === null
              ? 'Not synced yet.'
              : last.error
                ? `Last attempt failed: ${last.error}`
                : `Last synced ${new Date(last.at).toLocaleString()}.`}
        </span>
      </p>
      <div className="row">
        <button
          className="primary"
          disabled={busy || state.busy}
          onClick={() => void run(async () => void (await controller.syncNow()))}
        >
          Sync now
        </button>
        <label>
          <input
            type="checkbox"
            checked={state.auto}
            onChange={(e) => void controller.setAuto(e.target.checked)}
          />
          Sync automatically while OpenTiles is open
        </label>
      </div>
      {passkeysSupported() && (
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await controller.addPasskey();
                setPasskeyAdded(true);
              })
            }
          >
            Add a passkey for faster sign-in
          </button>
          {passkeyAdded && <span role="status">Passkey added.</span>}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button disabled={busy} onClick={() => void run(() => controller.signOut())}>
          Sign out on this device
        </button>
      </div>
      <details>
        <summary>Delete sync account</summary>
        <div className="stack">
          <p>
            This deletes your account and every encrypted copy on the server, at once. Your library
            on this device stays. Type <strong>delete</strong> to confirm.
          </p>
          <label>
            Confirm
            <input
              type="text"
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.target.value)}
            />
          </label>
          <div className="row">
            <button
              className="danger"
              disabled={busy || confirmDelete.trim().toLowerCase() !== 'delete'}
              onClick={() => void run(() => controller.deleteAccount())}
            >
              Delete account and server data
            </button>
          </div>
        </div>
      </details>
    </div>
  );
}

/** Sign-in tokens work once; StrictMode runs effects twice, so remember which were used. */
const usedTokens = new Set<string>();

/** Finishes an email-link sign-in (`#/sign-in/<token>`), then shows Settings. */
export function SignInLink({ token }: { token: string }) {
  const controller = getSyncController();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (controller === null || usedTokens.has(token)) return;
    usedTokens.add(token);
    void controller
      .init()
      .then(() => controller.finishEmailSignIn({ token }))
      .then(() => {
        window.location.replace('#/settings');
      })
      .catch((e: unknown) => setError(describeError(e)));
  }, [controller, token]);
  if (controller === null) {
    return <p className="muted">This copy of OpenTiles has no sync service.</p>;
  }
  return (
    <section className="stack">
      <h1>Signing in…</h1>
      {error && (
        <>
          <p className="error">{error}</p>
          <p>
            <a href="#/settings">Back to Settings</a>
          </p>
        </>
      )}
    </section>
  );
}
