import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { importScore, noteName, SUPPORTED_EXTENSIONS } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import { applySettings, DEFAULT_SETTINGS, handCounts } from '../lib/import-settings';
import { href } from '../lib/router';
import { db, getSetting, setSetting } from '../storage/db';
import type { ImportSettings } from '../storage/db';
import { requestPersistence, shouldSuggestHomeScreen } from '../storage/persist';

interface Pending {
  fileName: string;
  bytes: Uint8Array;
  base: Song;
  title: string;
  settings: ImportSettings;
}

export function Library() {
  const items = useLiveQuery(() => db.library.orderBy('addedAt').reverse().toArray(), []);
  const [rightsConfirmed, setRightsConfirmed] = useState<boolean | null>(null);
  const [askRights, setAskRights] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [homeScreenHint, setHomeScreenHint] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getSetting('rightsConfirmed', false).then(setRightsConfirmed);
  }, []);

  const chooseFile = () => {
    if (!rightsConfirmed) {
      setAskRights(true);
      return;
    }
    fileInput.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const base = importScore(file.name, bytes);
      setPending({
        fileName: file.name,
        bytes,
        base,
        title: base.title,
        settings: { ...DEFAULT_SETTINGS },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const save = async () => {
    if (!pending) return;
    const song = {
      ...applySettings(pending.base, pending.settings),
      title: pending.title.trim() || 'Untitled',
    };
    const id = await db.library.add({
      title: song.title,
      fileName: pending.fileName,
      format: song.format,
      bytes: pending.bytes,
      song,
      settings: pending.settings,
      tags: [],
      addedAt: Date.now(),
    });
    const first = (await db.library.count()) === 1;
    setPending(null);
    if (first) {
      await requestPersistence();
      if (shouldSuggestHomeScreen()) setHomeScreenHint(true);
    }
    window.location.hash = href({ name: 'practice', source: 'library', id: String(id) });
  };

  return (
    <>
      <h1>My library</h1>
      <p className="lead">
        Your own scores, stored only on this device. Import MusicXML (<code>.musicxml</code>,{' '}
        <code>.xml</code>, <code>.mxl</code>) or MIDI (<code>.mid</code>). From MuseScore, use{' '}
        <em>File → Export → MusicXML</em>.
      </p>
      <div className="row">
        <button className="primary" onClick={chooseFile}>
          Import a file…
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={SUPPORTED_EXTENSIONS.join(',')}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {homeScreenHint && (
        <div className="notice notice--warn">
          To keep your library safe on iPad and iPhone, tap{' '}
          <strong>Share → Add to Home Screen</strong> and open OpenTiles from there. Safari may
          otherwise clear site data after a week without a visit.
        </div>
      )}

      {askRights && (
        <RightsDialog
          onConfirm={async () => {
            await setSetting('rightsConfirmed', true);
            setRightsConfirmed(true);
            setAskRights(false);
            fileInput.current?.click();
          }}
          onCancel={() => setAskRights(false)}
        />
      )}

      {pending && (
        <ImportReview
          pending={pending}
          onChange={setPending}
          onSave={() => void save()}
          onCancel={() => setPending(null)}
        />
      )}

      <h2>Pieces</h2>
      {items && items.length === 0 && <p className="muted">Nothing here yet.</p>}
      <div className="grid">
        {(items ?? []).map((item) => (
          <div key={item.id} className="card">
            <h3>{item.title}</h3>
            <span className="muted">
              {item.format.toUpperCase()} · added {new Date(item.addedAt).toLocaleDateString()}
            </span>
            <div className="row">
              <a
                className="button primary"
                href={href({ name: 'practice', source: 'library', id: String(item.id) })}
              >
                Practise
              </a>
              <button
                className="danger"
                onClick={() => {
                  if (
                    item.id !== undefined &&
                    confirm(`Delete “${item.title}” from this device?`)
                  ) {
                    void db.library.delete(item.id);
                    void db.progress.delete(`library:${item.id}`);
                  }
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function RightsDialog({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="panel" role="dialog" aria-labelledby="rights-title">
      <h2 id="rights-title">Before your first import</h2>
      <p>
        Your library is private: files stay on this device and OpenTiles has no way to share them.
        Please only import music you have the right to use for your own practice — for example
        scores you bought, wrote or transcribed yourself, or public-domain music.
      </p>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I
        only import files I have the right to use for personal practice.
      </label>
      <div className="row" style={{ marginTop: '0.75rem' }}>
        <button className="primary" disabled={!checked} onClick={onConfirm}>
          Continue
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ImportReview({
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  pending: Pending;
  onChange: (p: Pending) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const song = applySettings(pending.base, pending.settings);
  const hands = handCounts(song);
  const bpm = Math.round(song.tempos[0]?.bpm ?? 120);
  const pitches = song.notes.map((n) => n.pitch);
  const set = (s: Partial<ImportSettings>) =>
    onChange({ ...pending, settings: { ...pending.settings, ...s } });
  return (
    <div className="panel stack" aria-labelledby="review-title">
      <h2 id="review-title">Check the import</h2>
      <label>
        Title
        <input
          type="text"
          value={pending.title}
          onChange={(e) => onChange({ ...pending, title: e.target.value })}
        />
      </label>
      <p className="muted">
        {song.notes.length} notes in {song.measures.length} bars · right hand {hands.right}, left
        hand {hands.left}
        {pitches.length > 0 && (
          <>
            {' '}
            · range {noteName(Math.min(...pitches))}–{noteName(Math.max(...pitches))}
          </>
        )}
      </p>
      {song.warnings.map((w) => (
        <p key={w} className="notice notice--warn">
          {w}
        </p>
      ))}
      <div className="row">
        <label>
          Tempo
          <input
            type="number"
            min={20}
            max={300}
            value={pending.settings.baseBpm ?? bpm}
            onChange={(e) => set({ baseBpm: Number(e.target.value) || undefined })}
            style={{ width: '6em' }}
          />
          beats per minute
        </label>
        <label>
          Transpose
          <select
            value={pending.settings.transpose}
            onChange={(e) => set({ transpose: Number(e.target.value) })}
          >
            {Array.from({ length: 25 }, (_, i) => i - 12).map((t) => (
              <option key={t} value={t}>
                {t > 0 ? `+${t}` : t} semitones
              </option>
            ))}
          </select>
        </label>
        <button
          aria-pressed={pending.settings.swapHands}
          onClick={() => set({ swapHands: !pending.settings.swapHands })}
        >
          Swap hands
        </button>
      </div>
      {song.format === 'midi' && (
        <label>
          Hand split point
          <input
            type="range"
            min={48}
            max={72}
            value={pending.settings.splitPoint ?? 60}
            onChange={(e) => set({ splitPoint: Number(e.target.value) })}
          />
          {noteName(pending.settings.splitPoint ?? 60)}
        </label>
      )}
      <div className="row">
        <button className="primary" onClick={onSave}>
          Save to my library
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
