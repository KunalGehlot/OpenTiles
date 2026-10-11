// "Add the MIDI or score file" for a sheet-only piece (ADR 0018): reads the file, shows the usual
// import review in a modal dialog, and gives the piece its notes while keeping its sheet. Shared by
// the library and the sheet-only reader, so it carries its own picker, rights check and review.
import { useEffect, useRef, useState } from 'react';
import { FilePlus } from 'lucide-react';
import { SUPPORTED_EXTENSIONS } from '@opentiles/song-model';
import { isAudioFile } from '../lib/audio-import';
import { href } from '../lib/router';
import { db, getSetting, setSetting } from '../storage/db';
import { t } from '../i18n';
import { ImportReview } from './ImportReview';
import { pieceNotes, readScoreFile, saveErrorMessage } from './pending';
import type { Pending } from './pending';
import { RightsDialog } from './RightsDialog';
import { addNotes } from './store';

type Step =
  { kind: 'rights' } | { kind: 'review'; pending: Pending } | { kind: 'error'; message: string };

/**
 * `onSaved` runs once the piece has its notes. Without it the piece's practice screen opens; a
 * screen already showing the piece must pass it and load the piece again, since the address stays
 * the same.
 */
export function AddNotesButton({
  itemId,
  onSaved,
  className = 'primary',
}: {
  itemId: number;
  onSaved?: (id: number) => void;
  className?: string;
}) {
  const [rightsConfirmed, setRightsConfirmed] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    void getSetting('rightsConfirmed', false).then(setRightsConfirmed);
  }, []);

  // A modal <dialog> sits above whatever screen holds the button, and Escape closes it.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (step && !d.open) d.showModal();
    if (!step && d.open) d.close();
  }, [step]);

  const choose = () => {
    if (!rightsConfirmed) {
      setStep({ kind: 'rights' });
      return;
    }
    input.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      if (isAudioFile(file.name, file.type)) {
        throw new Error(
          t('Choose a MIDI or score file. A recording cannot be paired with sheet music.'),
        );
      }
      const [pending, item] = await Promise.all([readScoreFile(file), db.library.get(itemId)]);
      if (!item) throw new Error(t('This piece is not in your library on this device.'));
      // The learner may have named the piece already; the file's own title is usually the same.
      const sheet = item.sheet && { fileName: item.sheet.fileName, bytes: item.sheet.bytes };
      setStep({ kind: 'review', pending: { ...pending, title: item.title, sheet } });
    } catch (e) {
      // Import errors from the shared packages are in English; t() shows them in German too.
      setStep({ kind: 'error', message: e instanceof Error ? t(e.message) : String(e) });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const save = async (pending: Pending) => {
    try {
      await addNotes(itemId, pieceNotes(pending));
    } catch (e) {
      setStep({ kind: 'error', message: saveErrorMessage(e) });
      return;
    }
    setStep(null);
    if (onSaved) onSaved(itemId);
    else window.location.hash = href({ name: 'practice', source: 'library', id: String(itemId) });
  };

  return (
    <>
      <button className={className} onClick={choose} disabled={busy}>
        <FilePlus /> {t('Add the MIDI or score file')}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={SUPPORTED_EXTENSIONS.join(',')}
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <dialog ref={dialog} className="import-dialog" onClose={() => setStep(null)}>
        {step?.kind === 'rights' && (
          <RightsDialog
            onConfirm={async () => {
              await setSetting('rightsConfirmed', true);
              setRightsConfirmed(true);
              setStep(null);
              input.current?.click();
            }}
            onCancel={() => setStep(null)}
          />
        )}
        {step?.kind === 'review' && (
          <ImportReview
            pending={step.pending}
            keepSheet
            onChange={(pending) => setStep({ kind: 'review', pending })}
            onSave={() => void save(step.pending)}
            onCancel={() => setStep(null)}
          />
        )}
        {step?.kind === 'error' && (
          <div className="panel stack" role="alert">
            <p className="error">{step.message}</p>
            <div className="row">
              <button onClick={() => setStep(null)}>{t('Close')}</button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
