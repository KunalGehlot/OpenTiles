import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { FileMusic, FilePlus, Play, ShieldCheck, Trash2 } from 'lucide-react';
import { estimateDifficulty, noteName, SUPPORTED_EXTENSIONS } from '@opentiles/song-model';
import type { Song } from '@opentiles/song-model';
import {
  AUDIO_EXTENSIONS,
  audioProgressValue,
  importAudioFile,
  isAudioFile,
} from '../lib/audio-import';
import type { AudioImportStage } from '../lib/audio-import';
import { applySettings, DEFAULT_SETTINGS, handCounts } from '../lib/import-settings';
import { href } from '../lib/router';
import { matchesQuery } from '../catalogue/search';
import { db, getSetting, setSetting } from '../storage/db';
import { SearchBox } from '../ui/SearchBox';
import type { ImportSettings } from '../storage/db';
import { requestPersistence, shouldSuggestHomeScreen } from '../storage/persist';

interface Pending {
  fileName: string;
  bytes: Uint8Array;
  base: Song;
  title: string;
  settings: ImportSettings;
  /** Transcribed from a recording (P4-02): the notes are a best guess. */
  approximate: boolean;
}

interface AudioProgress {
  stage: AudioImportStage;
  fraction: number;
  controller: AbortController;
}

const AUDIO_STAGE_LABELS: Record<AudioImportStage, string> = {
  loading: 'Loading the note detector…',
  decoding: 'Reading the recording…',
  transcribing: 'Listening for notes…',
};

/** Largest score file and recording the library accepts, so a huge file cannot hang the tab. */
const MAX_SCORE_BYTES = 30_000_000;
const MAX_AUDIO_BYTES = 200_000_000;

export function Library() {
  const items = useLiveQuery(() => db.library.orderBy('addedAt').reverse().toArray(), []);
  const [query, setQuery] = useState('');
  const visible = (items ?? []).filter((i) =>
    matchesQuery({ title: `${i.title} ${i.fileName}`, tags: i.tags }, query),
  );
  const [rightsConfirmed, setRightsConfirmed] = useState<boolean | null>(null);
  const [askRights, setAskRights] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [homeScreenHint, setHomeScreenHint] = useState(false);
  const [audio, setAudio] = useState<AudioProgress | null>(null);
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
      const limit = isAudioFile(file.name, file.type) ? MAX_AUDIO_BYTES : MAX_SCORE_BYTES;
      if (file.size > limit) {
        throw new Error(
          `This file is too large (${Math.round(file.size / 1e6)} MB). The limit is ${Math.round(limit / 1e6)} MB.`,
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isAudioFile(file.name, file.type)) {
        // Recordings are transcribed on this device; the model loads only now (P4-02).
        const controller = new AbortController();
        setAudio({ stage: 'loading', fraction: 0, controller });
        try {
          const base = await importAudioFile(file, {
            signal: controller.signal,
            onProgress: (stage, fraction) => setAudio({ stage, fraction, controller }),
          });
          setPending({
            fileName: file.name,
            bytes,
            base,
            title: base.title,
            settings: { ...DEFAULT_SETTINGS },
            approximate: true,
          });
        } finally {
          setAudio(null);
        }
        return;
      }
      // The importers (and the MuseScore reader inside them) load only when a file is imported.
      const { importAnyScore } = await import('@opentiles/importers');
      const base = await importAnyScore(file.name, bytes);
      setPending({
        fileName: file.name,
        bytes,
        base,
        title: base.title,
        settings: { ...DEFAULT_SETTINGS },
        approximate: false,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
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
    let id: number;
    try {
      id = await db.library.add({
        title: song.title.slice(0, 200),
        fileName: pending.fileName,
        format: song.format,
        bytes: pending.bytes,
        song,
        settings: pending.settings,
        tags: [],
        addedAt: Date.now(),
      });
    } catch (e) {
      // Most often the browser's storage is full, or blocked in a private window.
      const full = e instanceof DOMException && e.name === 'QuotaExceededError';
      setError(
        full
          ? 'There is not enough storage left on this device to save this piece. Delete a piece you no longer need and try again.'
          : 'This piece could not be saved. Your browser may be blocking storage (a private window, for example).',
      );
      return;
    }
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
        Your own scores, stored only on this device. Nothing here can be sent to anyone: OpenTiles
        has no way to share or publish your files.
      </p>
      <div className="import-box">
        <span className="file-tile" aria-hidden="true">
          <FilePlus />
        </span>
        <div className="import-box__text">
          <strong>Add a score or a recording</strong>
          <span className="muted">
            MusicXML, MuseScore, ABC or MIDI, or a recording of a piano.
          </span>
        </div>
        <button className="primary" onClick={chooseFile} disabled={audio !== null}>
          <FilePlus /> Import a file…
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={[...SUPPORTED_EXTENSIONS, ...AUDIO_EXTENSIONS].join(',')}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      <details className="formats">
        <summary>Which files can I import?</summary>
        <p>
          MusicXML (<code>.musicxml</code>, <code>.xml</code>, <code>.mxl</code>), MuseScore (
          <code>.mscz</code>, <code>.mscx</code>), ABC (<code>.abc</code>) or MIDI (
          <code>.mid</code>
          ). You can also import a recording (<code>.wav</code>, <code>.mp3</code>,{' '}
          <code>.m4a</code>, <code>.ogg</code>, <code>.flac</code>); its notes are detected on this
          device and are only approximate.
        </p>
      </details>
      {audio && (
        <div className="panel stack" aria-live="polite">
          <h2>Importing a recording</h2>
          <progress
            max={1}
            value={audioProgressValue(audio.stage, audio.fraction)}
            aria-label="Recording import progress"
          />
          <span className="muted">
            {AUDIO_STAGE_LABELS[audio.stage]}
            {audio.stage === 'transcribing' && ` ${Math.round(audio.fraction * 100)} %`}
          </span>
          <p className="notice notice--warn">
            Notes detected from a recording are approximate: some may be missing or wrong, and the
            rhythm is a guess. You can check them on the next screen.
          </p>
          <div className="row">
            <button onClick={() => audio.controller.abort()}>Cancel</button>
          </div>
        </div>
      )}
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
      {items && items.length > 1 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          label="Search your library"
          placeholder="Search by title, file name or tag"
        />
      )}
      {items && items.length > 1 && query.trim() !== '' && visible.length === 0 && (
        <p className="muted" role="status">
          No piece in your library matches “{query.trim()}”.
        </p>
      )}
      {items && items.length === 0 && (
        <div className="empty">
          <FileMusic />
          <p>Nothing here yet.</p>
          <p className="muted">
            Pieces you import appear here and stay on this device. They are never added to the
            public catalogue.
          </p>
        </div>
      )}
      <div className="grid grid--wide">
        {visible.map((item) => (
          <div key={item.id} className="card library-item">
            <div className="library-item__head">
              <span className="file-tile" aria-hidden="true">
                <FileMusic />
              </span>
              <div className="library-item__text">
                <h3>{item.title}</h3>
                <span className="muted">
                  {item.format.toUpperCase()} · added {new Date(item.addedAt).toLocaleDateString()}
                </span>
              </div>
            </div>
            <div className="row">
              <a
                className="button primary"
                href={href({ name: 'practice', source: 'library', id: String(item.id) })}
              >
                <Play /> Practise
              </a>
              <button
                className="danger quiet"
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
                <Trash2 /> Delete
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
    <div className="panel stack" role="dialog" aria-labelledby="rights-title">
      <h2 id="rights-title">
        <ShieldCheck /> Before your first import
      </h2>
      <p>
        Your library is private: files stay on this device and OpenTiles has no way to share them.
        Please only import music you have the right to use for your own practice — for example
        scores you bought, wrote or transcribed yourself, or public-domain music.
      </p>
      <label>
        <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I
        only import files I have the right to use for personal practice.
      </label>
      <div className="row">
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
  const difficulty = estimateDifficulty(song);
  const set = (s: Partial<ImportSettings>) =>
    onChange({ ...pending, settings: { ...pending.settings, ...s } });
  return (
    <div className="panel stack" aria-labelledby="review-title">
      <h2 id="review-title">Check the import</h2>
      {pending.approximate && (
        <p className="row">
          <span className="badge badge--warn">Approximate</span>
          <span className="muted">Transcribed from a recording on this device.</span>
        </p>
      )}
      <label className="field">
        <span className="field__label">Title</span>
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
      {song.notes.length > 0 && (
        <p
          className="muted"
          title="Estimated from speed, rhythm, chords, hand stretch, key and hand independence"
        >
          Estimated level {difficulty.level} of 5
        </p>
      )}
      {song.warnings.map((w) => (
        <p key={w} className="notice notice--warn">
          {w}
        </p>
      ))}
      <div className="field-grid">
        <label className="field">
          <span className="field__label">Tempo</span>
          <span className="row">
            <input
              type="number"
              min={20}
              max={300}
              value={pending.settings.baseBpm ?? bpm}
              onChange={(e) => set({ baseBpm: Number(e.target.value) || undefined })}
              style={{ width: '6em' }}
            />
            <span className="muted">beats per minute</span>
          </span>
        </label>
        <label className="field">
          <span className="field__label">Transpose</span>
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
        <div className="field">
          <span className="field__label">Hands</span>
          <button
            aria-pressed={pending.settings.swapHands}
            onClick={() => set({ swapHands: !pending.settings.swapHands })}
          >
            Swap hands
          </button>
        </div>
      </div>
      {song.format === 'midi' && (
        <label className="field">
          <span className="field__label">Hand split point</span>
          <span className="row">
            <input
              type="range"
              min={48}
              max={72}
              value={pending.settings.splitPoint ?? 60}
              onChange={(e) => set({ splitPoint: Number(e.target.value) })}
            />
            <span>{noteName(pending.settings.splitPoint ?? 60)}</span>
          </span>
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
