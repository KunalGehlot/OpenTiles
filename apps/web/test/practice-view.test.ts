// The practice view switch (P5-17): one Sheet tab for the learner's PDF or the engraved pages, and
// the old Page choice read as Sheet.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { NotationSource } from '../src/views/score/notation';
import { readChoice, viewFor } from '../src/views/score/ViewToggle';

const score: NotationSource = { kind: 'musicxml', text: '<score-partwise/>', transpose: 0 };
const none: NotationSource = { kind: 'none', reason: 'No score' };

describe('the remembered view', () => {
  it('reads the old Page tab as the Sheet tab', () => {
    expect(readChoice('page')).toBe('sheet');
  });

  it('keeps the three tabs and forgets anything else', () => {
    expect(readChoice('falling')).toBe('falling');
    expect(readChoice('scroll')).toBe('scroll');
    expect(readChoice('sheet')).toBe('sheet');
    expect(readChoice('nonsense')).toBeNull();
    expect(readChoice(3)).toBeNull();
    expect(readChoice(null)).toBeNull();
  });
});

describe('the Sheet tab', () => {
  it('shows the learner’s PDF where there is one', () => {
    expect(viewFor('sheet', score, true)).toBe('sheet');
    expect(viewFor('sheet', none, true)).toBe('sheet');
  });

  it('shows the engraved pages of a piece without a PDF', () => {
    expect(viewFor('sheet', score, false)).toBe('page');
  });

  it('falls back to the falling notes for a piece with neither', () => {
    expect(viewFor('sheet', none, false)).toBe('falling');
  });
});

describe('the other tabs', () => {
  it('show what was chosen where the piece has it', () => {
    expect(viewFor('falling', score, true)).toBe('falling');
    expect(viewFor('scroll', score, false)).toBe('scroll');
    expect(viewFor('scroll', score, true)).toBe('scroll');
  });

  it('show the PDF, or else the falling notes, for a piece without notation', () => {
    expect(viewFor('scroll', none, true)).toBe('sheet');
    expect(viewFor('scroll', none, false)).toBe('falling');
  });
});
