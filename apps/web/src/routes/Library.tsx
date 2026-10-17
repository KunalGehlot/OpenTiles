import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, FileMusic, FilePlus, FileText, Play, Trash2 } from 'lucide-react';
import { SUPPORTED_EXTENSIONS } from '@opentiles/song-model';
import {
  AUDIO_EXTENSIONS,
  audioProgressValue,
  importAudioFile,
  isAudioFile,
} from '../lib/audio-import';
import type { AudioImportStage } from '../lib/audio-import';
import { DEFAULT_SETTINGS } from '../lib/import-settings';
import { href } from '../lib/router';
import { matchesQuery } from '../catalogue/search';
import { AddNotesButton } from '../library/AddNotesButton';
import { ImportReview } from '../library/ImportReview';
import { planImport } from '../library/pairing';
import type { ImportGroup } from '../library/pairing';
import {
  checkSize,
  MAX_AUDIO_BYTES,
  pieceNotes,
  readScoreFile,
  saveErrorMessage,
  sheetOnlyPending,
} from '../library/pending';
import type { Pending } from '../library/pending';
import { RightsDialog } from '../library/RightsDialog';
import { isSheetOnly, readSheetFile, sheetAttachment } from '../library/sheet';
import type { SheetFile } from '../library/sheet';
import { attachSheet, deletePiece, removeSheet } from '../library/store';
import { db, getSetting, setSetting } from '../storage/db';
import type { LibraryRow } from '../storage/db';
import { addLibraryItem } from '../storage/library';
import { SearchBox } from '../ui/SearchBox';
import { requestPersistence, shouldSuggestHomeScreen } from '../storage/persist';
import { locale, t } from '../i18n';

interface AudioProgress {
  stage: AudioImportStage;
  fraction: number;
  controller: AbortController;
}

function audioStageLabel(stage: AudioImportStage): string {
  switch (stage) {
    case 'loading':
      return t('Loading the note detector…');
    case 'decoding':
      return t('Reading the recording…');
    default:
      return t('Listening for notes…');
  }
}

/** Files picked or dropped together, reviewed and saved one piece at a time. */
interface Batch {
  /** Bumped by each new batch, so a slow file from an earlier one is dropped. */
  id: number;
  queue: ImportGroup<File>[];
  total: number;
  /** Several files: messages name the file they are about. */
  named: boolean;
  saved: { id: number; practisable: boolean }[];
}

const ACCEPT = [...SUPPORTED_EXTENSIONS, ...AUDIO_EXTENSIONS, '.pdf', 'application/pdf'].join(',');

export function Library() {
  const items = useLiveQuery(() => db.library.orderBy('addedAt').reverse().toArray(), []);
  const [query, setQuery] = useState('');
  const visible = (items ?? []).filter((i) =>
    matchesQuery(
      { title: `${i.title} ${i.fileName} ${i.sheet?.fileName ?? ''}`, tags: i.tags },
      query,
    ),
  );
  const [rightsConfirmed, setRightsConfirmed] = useState<boolean | null>(null);
  /** What to do once the learner confirms their rights: open the picker, or take dropped files. */
  const [afterRights, setAfterRights] = useState<(() => void) | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [ask, setAsk] = useState<{ notes: File; sheet: File } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [cardError, setCardError] = useState<{ id: number; message: string } | null>(null);
  const [homeScreenHint, setHomeScreenHint] = useState(false);
  const [audio, setAudio] = useState<AudioProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  /** The piece "Add sheet music" or "Replace" was pressed on. */
  const sheetTarget = useRef<number | null>(null);
  const batch = useRef<Batch | null>(null);
  const batchCount = useRef(0);

  useEffect(() => {
    void getSetting('rightsConfirmed', false).then(setRightsConfirmed);
  }, []);

  const withRights = (then: () => void) => {
    if (rightsConfirmed) then();
    else setAfterRights(() => then);
  };

  const chooseFile = () => withRights(() => fileInput.current?.click());

  const fail = (message: string) => setErrors((list) => [...list, message]);

  /** Reads the files of one piece. Null when nothing from them can be saved. */
  const prepare = async (group: ImportGroup<File>, named: boolean): Promise<Pending | null> => {
    const message = (file: File, e: unknown) => {
      // Import errors from the shared packages are in English; t() shows them in German too.
      const text = e instanceof Error ? t(e.message) : String(e);
      return named ? `${file.name}: ${text}` : text;
    };
    let sheet: SheetFile | undefined;
    if (group.sheet) {
      try {
        sheet = await readSheetFile(group.sheet);
      } catch (e) {
        // The notes still make a piece; the learner can add a good PDF to it later.
        fail(message(group.sheet, e));
      }
    }
    const file = group.notes;
    if (!file) return sheet ? sheetOnlyPending(sheet) : null;
    try {
      if (!isAudioFile(file.name, file.type)) return { ...(await readScoreFile(file)), sheet };
      checkSize(file, MAX_AUDIO_BYTES);
      // Recordings are transcribed on this device; the model loads only now (P4-02).
      const controller = new AbortController();
      setAudio({ stage: 'loading', fraction: 0, controller });
      try {
        const base = await importAudioFile(file, {
          signal: controller.signal,
          onProgress: (stage, fraction) => setAudio({ stage, fraction, controller }),
        });
        return {
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          base,
          title: base.title,
          settings: { ...DEFAULT_SETTINGS },
          approximate: true,
        };
      } finally {
        setAudio(null);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail(message(file, e));
      return null;
    }
  };

  /** Shows the next piece of the batch for review, or ends the batch. */
  const next = async () => {
    const b = batch.current;
    if (!b) return;
    for (let group = b.queue.shift(); group; group = b.queue.shift()) {
      const p = await prepare(group, b.named);
      if (batch.current !== b) return;
      if (p) {
        setProgress({ index: b.total - b.queue.length, total: b.total });
        setPending(p);
        return;
      }
    }
    batch.current = null;
    setProgress(null);
    // One piece with notes opens straight away, as before; several, or a sheet without notes,
    // stay here where they can be seen.
    const [only, ...others] = b.saved;
    if (only?.practisable && others.length === 0) {
      window.location.hash = href({ name: 'practice', source: 'library', id: String(only.id) });
    }
  };

  const start = (groups: ImportGroup<File>[], named: boolean) => {
    batchCount.current += 1;
    batch.current = {
      id: batchCount.current,
      queue: [...groups],
      total: groups.length,
      named,
      saved: [],
    };
    setPending(null);
    void next();
  };

  const onFiles = (files: File[]) => {
    // The picker is disabled while a recording is transcribed; files dropped then are ignored.
    if (files.length === 0 || audio) return;
    setErrors([]);
    setAsk(null);
    const plan = planImport(files);
    if (plan.ask) setAsk(plan.ask);
    else start(plan.groups, files.length > 1);
  };

  // Files dropped anywhere on the page are imported like picked ones. Only the files are read: a
  // dragged link is never fetched (no imports from other sites). Without this, a dropped PDF would
  // replace the app in the tab.
  const onDrop = useRef<(files: File[]) => void>(() => {});
  onDrop.current = (files) => withRights(() => onFiles(files));
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      onDrop.current([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  const save = async () => {
    if (!pending) return;
    const notes = pieceNotes(pending);
    let id: number;
    try {
      id = await addLibraryItem({
        ...notes,
        tags: pending.tags ?? [],
        addedAt: Date.now(),
        ...(pending.sheet ? { sheet: sheetAttachment(pending.sheet) } : {}),
      });
    } catch (e) {
      fail(saveErrorMessage(e));
      return;
    }
    batch.current?.saved.push({ id, practisable: !isSheetOnly(notes) });
    const first = (await db.library.count()) === 1;
    setPending(null);
    if (first) {
      // Not awaited: Firefox asks the user first, and the promise waits for their answer.
      void requestPersistence();
      if (shouldSuggestHomeScreen()) setHomeScreenHint(true);
    }
    await next();
  };

  const skip = () => {
    setPending(null);
    void next();
  };

  const chooseSheet = (id: number) =>
    withRights(() => {
      sheetTarget.current = id;
      sheetInput.current?.click();
    });

  const onSheetFile = async (file: File | undefined) => {
    const id = sheetTarget.current;
    if (!file || id === null) return;
    setCardError(null);
    try {
      await attachSheet(id, await readSheetFile(file));
    } catch (e) {
      setCardError({ id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (sheetInput.current) sheetInput.current.value = '';
    }
  };

  return (
    <>
      <h1>{t('My library')}</h1>
      <p className="lead">
        {t(
          'Your own scores, stored only on this device. Nothing here can be sent to anyone: OpenTiles has no way to share or publish your files.',
        )}
      </p>
      <div className={dragging ? 'import-box import-box--drop' : 'import-box'}>
        <span className="file-tile" aria-hidden="true">
          <FilePlus />
        </span>
        <div className="import-box__text">
          <strong>{t('Add a score, sheet music or a recording')}</strong>
          <span className="muted">
            {t(
              'MusicXML, MuseScore, ABC or MIDI, a PDF of the sheet music, or a recording of a piano. Pick or drop several files at once.',
            )}{' '}
            <a href={href({ name: 'sheet-music' })}>{t('Where to find free sheet music')}</a>
          </span>
        </div>
        <button className="primary" onClick={chooseFile} disabled={audio !== null}>
          <FilePlus /> {t('Import a file…')}
        </button>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
        <input
          ref={sheetInput}
          type="file"
          hidden
          accept=".pdf,application/pdf"
          onChange={(e) => void onSheetFile(e.target.files?.[0])}
        />
      </div>
      <details className="formats">
        <summary>{t('Which files can I import?')}</summary>
        <p>
          {t(
            'MusicXML (.musicxml, .xml, .mxl), MuseScore (.mscz, .mscx), ABC (.abc) or MIDI (.mid). You can also import a recording (.wav, .mp3, .m4a, .ogg, .flac); its notes are detected on this device and are only approximate.',
          )}
        </p>
        <p>
          {t(
            'A PDF (.pdf) is kept as the sheet music of a piece: pick it together with the MIDI or score file of the same name, or add it to a piece later. OpenTiles shows your PDF but does not read notes from it, so a PDF on its own can be read but not practised.',
          )}
        </p>
      </details>
      {audio && (
        <div className="panel stack" aria-live="polite">
          <h2>{t('Importing a recording')}</h2>
          <progress
            max={1}
            value={audioProgressValue(audio.stage, audio.fraction)}
            aria-label={t('Recording import progress')}
          />
          <span className="muted">
            {audioStageLabel(audio.stage)}
            {audio.stage === 'transcribing' && ` ${Math.round(audio.fraction * 100)} %`}
          </span>
          <p className="notice notice--warn">
            {t(
              'Notes detected from a recording are approximate: some may be missing or wrong, and the rhythm is a guess. You can check them on the next screen.',
            )}
          </p>
          <div className="row">
            <button onClick={() => audio.controller.abort()}>{t('Cancel')}</button>
          </div>
        </div>
      )}
      {errors.map((message, i) => (
        <p key={i} className="error">
          {message}
        </p>
      ))}
      {homeScreenHint && (
        <div className="notice notice--warn">
          {t(
            'To keep your library safe on iPad and iPhone, tap Share → Add to Home Screen and open OpenTiles from there. Safari may otherwise clear site data after a week without a visit.',
          )}
        </div>
      )}

      {afterRights && (
        <RightsDialog
          onConfirm={async () => {
            await setSetting('rightsConfirmed', true);
            setRightsConfirmed(true);
            setAfterRights(null);
            afterRights();
          }}
          onCancel={() => setAfterRights(null)}
        />
      )}

      {ask && (
        <div className="panel stack" role="group" aria-labelledby="pair-title">
          <h2 id="pair-title">{t('Is this PDF the sheet music of this piece?')}</h2>
          <p>
            {t('The names differ: “{notes}” and “{sheet}”.', {
              notes: ask.notes.name,
              sheet: ask.sheet.name,
            })}
          </p>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                setAsk(null);
                start([{ notes: ask.notes, sheet: ask.sheet }], true);
              }}
            >
              {t('Yes, one piece')}
            </button>
            <button
              onClick={() => {
                setAsk(null);
                start([{ notes: ask.notes }, { sheet: ask.sheet }], true);
              }}
            >
              {t('No, two pieces')}
            </button>
            <button onClick={() => setAsk(null)}>{t('Cancel')}</button>
          </div>
        </div>
      )}

      {pending && (
        <ImportReview
          pending={pending}
          progress={progress ?? undefined}
          onChange={setPending}
          onSave={() => void save()}
          onCancel={skip}
        />
      )}

      <h2>{t('Pieces')}</h2>
      {items && items.length > 1 && (
        <SearchBox
          value={query}
          onChange={setQuery}
          label={t('Search your library')}
          placeholder={t('Search by title, file name or tag')}
        />
      )}
      {items && items.length > 1 && query.trim() !== '' && visible.length === 0 && (
        <p className="muted" role="status">
          {t('No piece in your library matches “{query}”.', { query: query.trim() })}
        </p>
      )}
      {items && items.length === 0 && (
        <div className="empty">
          <FileMusic />
          <p>{t('Nothing here yet.')}</p>
          <p className="muted">
            {t(
              'Pieces you import appear here and stay on this device. They are never added to the public catalogue.',
            )}
          </p>
        </div>
      )}
      <div className="grid grid--wide">
        {visible.map((item) => (
          <LibraryCard
            key={item.id}
            item={item}
            error={cardError && cardError.id === item.id ? cardError.message : null}
            onChooseSheet={chooseSheet}
          />
        ))}
      </div>
    </>
  );
}

function LibraryCard({
  item,
  error,
  onChooseSheet,
}: {
  item: LibraryRow;
  error: string | null;
  onChooseSheet: (id: number) => void;
}) {
  const id = item.id;
  if (id === undefined) return null;
  const sheetOnly = isSheetOnly(item);
  const practice = href({ name: 'practice', source: 'library', id: String(id) });
  return (
    <div className="card library-item">
      <div className="library-item__head">
        <span className="file-tile" aria-hidden="true">
          {sheetOnly ? <FileText /> : <FileMusic />}
        </span>
        <div className="library-item__text">
          <h3>{item.title}</h3>
          <span className="muted library-item__meta">
            {item.format.toUpperCase()} ·{' '}
            {t('added {date}', {
              date: new Date(item.addedAt).toLocaleDateString(locale()),
            })}
            {item.sheet && <span className="badge">{t('Sheet')}</span>}
          </span>
          {item.tags.length > 0 && (
            <span className="muted library-item__tags">{item.tags.join(' · ')}</span>
          )}
        </div>
      </div>
      {sheetOnly && (
        <p className="muted library-item__note">
          {t('Sheet only — add the MIDI file to practise')}
        </p>
      )}
      <div className="row">
        {sheetOnly ? (
          <>
            <AddNotesButton itemId={id} />
            <a className="button" href={practice}>
              <BookOpen /> {t('Open')}
            </a>
          </>
        ) : (
          <a className="button primary" href={practice}>
            <Play /> {t('Practise')}
          </a>
        )}
        <button
          className="danger quiet"
          onClick={() => {
            if (confirm(t('Delete “{title}” from this device?', { title: item.title }))) {
              void deletePiece(id);
            }
          }}
        >
          <Trash2 /> {t('Delete')}
        </button>
      </div>
      <div className="library-item__sheet">
        {item.sheet ? (
          <>
            <span className="library-item__sheet-name" title={item.sheet.fileName}>
              <FileText />
              <span>{item.sheet.fileName}</span>
            </span>
            <button
              className="quiet"
              aria-label={t('Replace sheet music')}
              onClick={() => onChooseSheet(id)}
            >
              {t('Replace')}
            </button>
            {!sheetOnly && (
              <button
                className="quiet"
                aria-label={t('Remove sheet music')}
                onClick={() => {
                  if (confirm(t('Remove the sheet music from “{title}”?', { title: item.title }))) {
                    void removeSheet(id);
                  }
                }}
              >
                {t('Remove')}
              </button>
            )}
          </>
        ) : (
          <button className="quiet" onClick={() => onChooseSheet(id)}>
            <FilePlus /> {t('Add sheet music (PDF)')}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
