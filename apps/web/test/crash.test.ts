import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { libraryNames } from '../src/crash/reporter';
import { buildScrubbedReport, coarsePlatform, scrubCrashText } from '../src/crash/scrub';
import { db } from '../src/storage/db';
import { addLibraryItem } from '../src/storage/library';

const ORIGIN = 'https://opentiles.example';

describe('crash report scrubbing', () => {
  it('removes library titles and file names, case-insensitively', () => {
    const out = scrubCrashText('Cannot render My Secret Waltz (my secret waltz.mid) after Waltz', {
      names: ['My Secret Waltz', 'my secret waltz.mid', 'Waltz'],
    });
    expect(out).not.toMatch(/secret/i);
    expect(out).not.toMatch(/waltz/i);
    expect(out).toContain('[title]');
  });

  it('removes file names it was not told about', () => {
    const out = scrubCrashText('Failed to parse lieblingslied.musicxml and Übung_2.mid');
    expect(out).not.toContain('lieblingslied');
    expect(out).not.toContain('Übung');
    expect(out).toContain('[file]');
  });

  it('removes ids from routes, query strings, fragments, blob and data URLs', () => {
    const out = scrubCrashText(
      `at ${ORIGIN}/#/practice/library/42 and ${ORIGIN}/?id=7#token=abc ` +
        'blob:https://opentiles.example/1b2c3d4e data:text/plain;base64,QUJD ' +
        '#/sign-in/AbCdEfGhIjKlMnOpQrStUvWx',
      { names: [] },
      ORIGIN,
    );
    expect(out).not.toContain('42');
    expect(out).not.toContain('id=7');
    expect(out).not.toContain('abc');
    expect(out).not.toContain('1b2c3d4e');
    expect(out).not.toContain('QUJD');
    expect(out).not.toContain('AbCdEfGh');
    expect(out).not.toContain(ORIGIN);
    expect(out).toContain('#/practice/library/[id]');
  });

  it('removes quoted text, email addresses and tokens', () => {
    const out = scrubCrashText(
      'Delete “Moonlight Medley”? failed for pianist@example.org with "Bearer abc.def" token=xyz',
    );
    expect(out).not.toContain('Moonlight');
    expect(out).not.toContain('pianist@example.org');
    expect(out).not.toContain('xyz');
    expect(out).not.toContain('abc.def');
  });

  it('keeps the useful part of a stack trace', () => {
    const stack =
      'TypeError: x is undefined\n' +
      `    at draw (${ORIGIN}/assets/index-B4x9.js:12:345)\n` +
      `    at loop (${ORIGIN}/assets/index-B4x9.js:20:1)`;
    const out = scrubCrashText(stack, { names: [] }, ORIGIN);
    expect(out).toContain('at draw (/assets/index-B4x9.js:12:345)');
    expect(out).toContain('TypeError: x is undefined');
  });

  it('builds a report with every text field scrubbed', () => {
    const error = new Error('Could not open “Secret Song” from secret-song.mxl');
    error.stack = `Error: Could not open Secret Song\n    at f (${ORIGIN}/#/practice/library/9)`;
    const report = buildScrubbedReport(
      error,
      { app: 'web', version: '0.1.0', platform: 'iOS / Safari', context: { kind: 'error' } },
      { names: ['Secret Song'] },
      ORIGIN,
    );
    const all = JSON.stringify(report);
    expect(all).not.toMatch(/secret/i);
    expect(all).not.toContain('/9');
    expect(report).toMatchObject({ app: 'web', version: '0.1.0', context: { kind: 'error' } });
  });

  it('reduces the user agent to OS and browser family', () => {
    expect(
      coarsePlatform(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        5,
      ),
    ).toBe('iOS / Safari');
    expect(
      coarsePlatform(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      ),
    ).toBe('Windows / Chrome');
  });
});

describe('names kept out of crash reports', () => {
  it('include the file name of a piece’s sheet music', async () => {
    await db.library.clear();
    await db.files.clear();
    await addLibraryItem({
      title: 'Secret Study',
      fileName: 'secret-study.mid',
      format: 'midi',
      bytes: new Uint8Array(0),
      song: {
        title: 'Secret Study',
        format: 'midi',
        notes: [],
        measures: [],
        tempos: [{ beat: 0, bpm: 120 }],
        timeSignatures: [],
        keySignatures: [],
        parts: [],
        lengthBeats: 0,
        warnings: [],
      },
      settings: { transpose: 0, swapHands: false },
      tags: [],
      addedAt: 1,
      sheet: { fileName: 'A Different Edition.pdf', bytes: new Uint8Array(0), addedAt: 1 },
    });
    const names = await libraryNames();
    expect(names).toContain('A Different Edition.pdf');
    expect(
      scrubCrashText('Failed to open A Different Edition.pdf', { names }, 'https://x.test'),
    ).not.toContain('Different Edition');
  });
});
