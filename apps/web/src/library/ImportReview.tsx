import { FileText } from 'lucide-react';
import { estimateDifficulty } from '@opentiles/song-model';
import { useState } from 'react';
import { applySettings, handCounts, parseTags, trimFor } from '../lib/import-settings';
import { noteLabel } from '../lib/notes';
import type { ImportSettings } from '../storage/db';
import { t } from '../i18n';
import type { Pending } from './pending';

/** The PDF that will be kept with the piece, with a way to leave it out before saving. */
function SheetLine({ name, onRemove }: { name: string; onRemove?: () => void }) {
  return (
    <p className="row sheet-line">
      <FileText />
      <span className="sheet-line__name" title={name}>
        {t('Sheet music: {name}', { name })}
      </span>
      {onRemove && (
        <button type="button" className="quiet" onClick={onRemove}>
          {t('Leave out the sheet music')}
        </button>
      )}
    </p>
  );
}

/**
 * The import review screen (spec §8): title, what was read, and the settings applied before
 * saving. A sheet-only piece (a PDF with no notes yet) has only a title to check.
 */
export function ImportReview({
  pending,
  progress,
  keepSheet = false,
  onChange,
  onSave,
  onCancel,
}: {
  pending: Pending;
  /** Which piece this is when several were imported at once. */
  progress?: { index: number; total: number };
  /** The sheet belongs to a piece already saved, so it cannot be left out here. */
  keepSheet?: boolean;
  onChange: (p: Pending) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const sheetOnly = pending.base.format === 'pdf';
  const song = applySettings(pending.base, pending.settings);
  const hands = handCounts(song);
  const bpm = Math.round(song.tempos[0]?.bpm ?? 120);
  const pitches = song.notes.map((n) => n.pitch);
  const difficulty = estimateDifficulty(song);
  const set = (s: Partial<ImportSettings>) =>
    onChange({ ...pending, settings: { ...pending.settings, ...s } });
  // Every bar, as played, before any is left out (P1-07).
  const { trim, ...untrimmed } = pending.settings;
  const bars = sheetOnly ? 0 : applySettings(pending.base, untrimmed).measures.length;
  const first = trim?.from ?? 0;
  const last = trim?.to ?? Math.max(0, bars - 1);
  const keep = (from: number, to: number) => {
    const next = trimFor(from, to, bars);
    onChange({ ...pending, settings: next ? { ...untrimmed, trim: next } : untrimmed });
  };
  // What the learner types, kept as typed until it is read as tags.
  const [tagText, setTagText] = useState((pending.tags ?? []).join(', '));
  const { sheet } = pending;
  return (
    <div className="panel stack" aria-labelledby="review-title">
      <h2 id="review-title">{t('Check the import')}</h2>
      {progress && progress.total > 1 && (
        <p className="muted">
          {t('Piece {n} of {total}', { n: progress.index, total: progress.total })}
        </p>
      )}
      {pending.approximate && (
        <p className="row">
          <span className="badge badge--warn">{t('Approximate')}</span>
          <span className="muted">{t('Transcribed from a recording on this device.')}</span>
        </p>
      )}
      <label className="field">
        <span className="field__label">{t('Title')}</span>
        <input
          type="text"
          value={pending.title}
          onChange={(e) => onChange({ ...pending, title: e.target.value })}
        />
      </label>
      {sheet && (
        <SheetLine
          name={sheet.fileName}
          onRemove={
            sheetOnly || keepSheet
              ? undefined
              : () => {
                  const { sheet: _left, ...rest } = pending;
                  onChange(rest);
                }
          }
        />
      )}
      {sheetOnly ? (
        <p className="muted">
          {t(
            'This PDF has no notes OpenTiles can follow. You can read it now, and practise it once you add the MIDI or score file of the same piece.',
          )}
        </p>
      ) : (
        <>
          <p className="muted">
            {t('{notes} notes in {bars} bars · right hand {right}, left hand {left}', {
              notes: song.notes.length,
              bars: song.measures.length,
              right: hands.right,
              left: hands.left,
            })}
            {pitches.length > 0 && (
              <>
                {' '}
                ·{' '}
                {t('range {low}–{high}', {
                  low: noteLabel(Math.min(...pitches)),
                  high: noteLabel(Math.max(...pitches)),
                })}
              </>
            )}
          </p>
          {song.notes.length > 0 && (
            <p
              className="muted"
              title={t(
                'Estimated from speed, rhythm, chords, hand stretch, key and hand independence',
              )}
            >
              {t('Estimated level {n} of 5', { n: difficulty.level })}
            </p>
          )}
          {song.warnings.map((w) => (
            <p key={w} className="notice notice--warn">
              {t(w)}
            </p>
          ))}
          <div className="field-grid">
            <label className="field">
              <span className="field__label">{t('Tempo')}</span>
              <span className="row">
                <input
                  type="number"
                  min={20}
                  max={300}
                  value={pending.settings.baseBpm ?? bpm}
                  onChange={(e) => set({ baseBpm: Number(e.target.value) || undefined })}
                  style={{ width: '6em' }}
                />
                <span className="muted">{t('beats per minute')}</span>
              </span>
            </label>
            <label className="field">
              <span className="field__label">{t('Transpose')}</span>
              <select
                value={pending.settings.transpose}
                onChange={(e) => set({ transpose: Number(e.target.value) })}
              >
                {Array.from({ length: 25 }, (_, i) => i - 12).map((n) => (
                  <option key={n} value={n}>
                    {t('{n} semitones', { n: n > 0 ? `+${n}` : n })}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span className="field__label">{t('Hands')}</span>
              <button
                aria-pressed={pending.settings.swapHands}
                onClick={() => set({ swapHands: !pending.settings.swapHands })}
              >
                {t('Swap hands')}
              </button>
            </div>
          </div>
          {bars > 1 && (
            <div className="field">
              <span className="field__label" id="review-bars">
                {t('Bars to keep')}
              </span>
              <span className="row" role="group" aria-labelledby="review-bars">
                <label className="row">
                  <span>{t('From bar')}</span>
                  <input
                    type="number"
                    min={1}
                    max={bars}
                    value={first + 1}
                    onChange={(e) =>
                      keep(Number(e.target.value) - 1, Math.max(last, Number(e.target.value) - 1))
                    }
                    style={{ width: '5em' }}
                  />
                </label>
                <label className="row">
                  <span>{t('To bar')}</span>
                  <input
                    type="number"
                    min={1}
                    max={bars}
                    value={last + 1}
                    onChange={(e) =>
                      keep(Math.min(first, Number(e.target.value) - 1), Number(e.target.value) - 1)
                    }
                    style={{ width: '5em' }}
                  />
                </label>
                <span className="muted">{t('of {n}, as played', { n: bars })}</span>
              </span>
            </div>
          )}
          {song.format === 'midi' && (
            <label className="field">
              <span className="field__label">{t('Hand split point')}</span>
              <span className="row">
                <input
                  type="range"
                  min={48}
                  max={72}
                  value={pending.settings.splitPoint ?? 60}
                  onChange={(e) => set({ splitPoint: Number(e.target.value) })}
                />
                <span>{noteLabel(pending.settings.splitPoint ?? 60)}</span>
              </span>
            </label>
          )}
        </>
      )}
      <label className="field">
        <span className="field__label">{t('Tags')}</span>
        <input
          type="text"
          value={tagText}
          placeholder={t('For example: exam, warm-up')}
          onChange={(e) => {
            setTagText(e.target.value);
            onChange({ ...pending, tags: parseTags(e.target.value) });
          }}
        />
        <span className="muted">
          {t('Words to find the piece by in your library, with commas between them.')}
        </span>
      </label>
      <div className="row">
        <button className="primary" onClick={onSave}>
          {t('Save to my library')}
        </button>
        <button onClick={onCancel}>{t('Cancel')}</button>
      </div>
    </div>
  );
}
