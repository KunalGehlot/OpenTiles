// Which colour each note glyph gets on the score (PLAN.md P1-15, P1-24). Pure.
import type { SongNote } from '@opentiles/song-model';

/**
 * `expected`: play it now · `correct`: played right · `wrong`: wrong key while it was expected, or
 * missed · `done`: passed without feedback (listen mode, the other hand) · `other`: the hand not
 * being practised.
 */
export type NoteState = 'expected' | 'correct' | 'wrong' | 'done' | 'other';

export interface StateInput {
  notes: readonly SongNote[];
  beat: number;
  /** Ids of the notes to play now (the wait-mode step), or null to use the notes sounding at `beat`. */
  current: ReadonlySet<string> | null;
  marks: ReadonlyMap<string, 'correct' | 'wrong'>;
  inHands: (n: SongNote) => boolean;
}

export function noteStates(input: StateInput): Map<string, NoteState> {
  const out = new Map<string, NoteState>();
  const { beat, current, marks } = input;
  for (const n of input.notes) {
    const mark = marks.get(n.id);
    const sounding = n.startBeat <= beat + 1e-6 && beat < n.startBeat + n.durationBeats - 1e-6;
    const now = current ? current.has(n.id) : sounding;
    if (!input.inHands(n)) {
      out.set(n.id, 'other');
    } else if (mark === 'wrong') {
      out.set(n.id, 'wrong');
    } else if (now) {
      out.set(n.id, mark === 'correct' ? 'correct' : 'expected');
    } else if (mark === 'correct') {
      out.set(n.id, 'correct');
    } else if (n.startBeat < beat - 1e-6) {
      out.set(n.id, 'done');
    }
  }
  return out;
}

/**
 * One state per glyph. A glyph drawn for several notes (a repeated passage) shows the note of the
 * pass the cursor is in or nearest to: `nearest` picks it, so a red mark in the first pass does
 * not stay on the glyph during the second.
 */
export function glyphStates(
  states: ReadonlyMap<string, NoteState>,
  notesOf: ReadonlyMap<string, readonly string[]>,
  nearest: (noteIds: readonly string[]) => string | undefined,
): Map<string, NoteState> {
  const out = new Map<string, NoteState>();
  for (const [glyph, notes] of notesOf) {
    const pick = notes.length > 1 ? nearest(notes) : notes[0];
    const state = pick !== undefined ? states.get(pick) : undefined;
    if (state) out.set(glyph, state);
  }
  return out;
}

/** The note (of several passes over one glyph) whose onset is closest to `beat`. */
export function nearestByBeat(
  ids: readonly string[],
  startOf: (id: string) => number | undefined,
  beat: number,
): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  for (const id of ids) {
    const start = startOf(id);
    if (start === undefined) continue;
    const d = Math.abs(start - beat);
    if (d < bestDistance) {
      best = id;
      bestDistance = d;
    }
  }
  return best;
}

export interface FingerMark {
  noteId: string;
  finger: number;
  /** A suggested finger (P4-08), drawn lighter than the score's own. */
  suggested: boolean;
}

/**
 * Fingers to add to a drawn score. Verovio draws the fingering written in MusicXML but not in ABC,
 * so when the drawing already has fingering only the suggested fingers are added (P2-12, P4-08).
 */
export function fingersToAdd(
  notes: readonly SongNote[],
  scoreDrawsWritten: boolean,
  suggested: ReadonlySet<string>,
): FingerMark[] {
  const out: FingerMark[] = [];
  for (const n of notes) {
    if (n.fingering === undefined) continue;
    const isSuggested = suggested.has(n.id);
    if (scoreDrawsWritten && !isSuggested) continue;
    out.push({ noteId: n.id, finger: n.fingering, suggested: isSuggested });
  }
  return out;
}
