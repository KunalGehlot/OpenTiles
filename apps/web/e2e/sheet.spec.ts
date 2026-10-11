// The learner's own sheet music (P5-14, ADR 0018): a PDF stored on a library piece is drawn in
// the practice screen's Sheet view, its bars are found and matched to the song, and the highlight
// follows the music, repeats included. The PDF and the song are made up here (CC0): engraved-looking
// pages drawn in code (packages/sheet/test/fixtures.ts) and a song with the same bars.
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { scanPdf, scorePdf } from '../../../packages/sheet/test/fixtures';
import type { FixtureBar } from '../../../packages/sheet/test/fixtures';

// Eight written bars, with a repeat of bars 3 to 5: played 1 2 3 4 5 3 4 5 6 7 8.
const HEADS = [3, 5, 6, 4, 7, 2, 5, 6];
const PLAYED = [0, 1, 2, 3, 4, 2, 3, 4, 5, 6, 7];

function sheetPage() {
  const bars: FixtureBar[] = HEADS.map((heads) => ({ width: 120, heads }));
  bars[2] = { ...bars[2]!, start: 'repeat-start' };
  bars[4] = { ...bars[4]!, end: 'repeat-end' };
  bars[7] = { ...bars[7]!, end: 'final' };
  return { systems: [{ bars: bars.slice(0, 4) }, { bars: bars.slice(4) }] };
}

const sheetPdf = () => scorePdf([sheetPage()]);

/** A song in 4/4 at a brisk tempo with the bars played out, as a MIDI file would have them. */
function songOf(played: readonly number[]) {
  const measures = played.map((_, index) => ({
    index,
    number: String(index + 1),
    sourceIndex: index,
    startBeat: index * 4,
    lengthBeats: 4,
  }));
  const notes = played.flatMap((bar, index) =>
    Array.from({ length: HEADS[bar] ?? 0 }, (_, k) => ({
      pitch: 60 + ((bar * 3 + k * 2) % 12),
      startBeat: index * 4 + (k * 4) / (HEADS[bar] ?? 1),
      durationBeats: 0.5,
      hand: 'right',
      staff: 1,
      voice: 1,
      part: 0,
      measureIndex: index,
      sourceRefs: [],
    })),
  );
  return {
    title: 'Sheet test',
    format: 'midi',
    notes: notes.map((n, i) => ({ id: `n${i}`, ...n })),
    measures,
    tempos: [{ beat: 0, bpm: 480 }],
    timeSignatures: [{ beat: 0, numerator: 4, denominator: 4 }],
    keySignatures: [{ beat: 0, fifths: 0 }],
    parts: [{ name: 'Piano' }],
    lengthBeats: played.length * 4,
    warnings: [],
  };
}

const EMPTY_SONG = {
  title: 'Only a sheet',
  format: 'pdf',
  notes: [],
  measures: [],
  tempos: [{ beat: 0, bpm: 120 }],
  timeSignatures: [],
  keySignatures: [],
  parts: [{ name: 'Piano' }],
  lengthBeats: 0,
  warnings: [],
};

/** Puts a piece straight into the library (the app must have opened its database first). */
async function addPiece(
  page: Page,
  piece: { title: string; format: string; song: unknown; pdf?: Uint8Array },
): Promise<number> {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Free piano practice' })).toBeVisible();
  return page.evaluate(
    async ({ title, format, song, pdf }) => {
      const open = () =>
        new Promise<IDBDatabase | null>((resolve, reject) => {
          const request = indexedDB.open('opentiles');
          // Not created by the app yet: leave it to the app.
          request.onupgradeneeded = () => request.transaction?.abort();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            request.error?.name === 'AbortError' ? resolve(null) : reject(request.error);
        });
      let db = await open();
      for (let i = 0; i < 50 && !db?.objectStoreNames.contains('library'); i++) {
        db?.close();
        await new Promise((r) => setTimeout(r, 100));
        db = await open();
      }
      if (!db) throw new Error('The app did not create its database');
      const store = db.transaction('library', 'readwrite').objectStore('library');
      const item: Record<string, unknown> = {
        title,
        fileName: `${title}.mid`,
        format,
        bytes: new Uint8Array(0),
        song,
        settings: { transpose: 0, swapHands: false },
        tags: [],
        addedAt: Date.now(),
      };
      if (pdf) item.sheet = { fileName: `${title}.pdf`, bytes: new Uint8Array(pdf), addedAt: 1 };
      const id = await new Promise<number>((resolve, reject) => {
        const request = store.add(item);
        request.onsuccess = () => resolve(request.result as number);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return id;
    },
    { ...piece, pdf: piece.pdf ? Array.from(piece.pdf) : undefined },
  );
}

/** The map stored on a piece. */
function storedMap(page: Page, key: number) {
  return page.evaluate(
    (id) =>
      new Promise<{ barOfMeasure: number[]; layout: { source: string; bars: unknown[] } } | null>(
        (resolve) => {
          const request = indexedDB.open('opentiles');
          request.onsuccess = () => {
            const get = request.result.transaction('library').objectStore('library').get(id);
            get.onsuccess = () => {
              const item = get.result as {
                sheet?: {
                  map?: { barOfMeasure: number[]; layout: { source: string; bars: unknown[] } };
                };
              };
              resolve(item.sheet?.map ?? null);
              request.result.close();
            };
          };
        },
      ),
    key,
  );
}

/** Records which bar the highlight is on, every frame. */
async function recordBars(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { shownBars: number[] };
    w.shownBars = [];
    const sample = () => {
      const h = document.querySelector('[data-testid="sheet-highlight"]') as HTMLElement | null;
      const bar = h && !h.hidden ? Number(h.dataset.bar) : -1;
      if (bar >= 0 && w.shownBars.at(-1) !== bar) w.shownBars.push(bar);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

test('the Sheet view draws the learner’s PDF and the highlight follows the music through a repeat', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/content security policy|refused to/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(String(e)));
  const id = await addPiece(page, {
    title: 'Sheet test',
    format: 'midi',
    song: songOf(PLAYED),
    pdf: sheetPdf(),
  });
  await page.goto(`./#/practice/library/${id}`);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' }).click();
  const panel = page.getByRole('region', { name: 'Your sheet music' });
  await expect(panel).toHaveAttribute('data-map', 'ready', { timeout: 30_000 });
  await expect(panel.locator('canvas.ot-sheet-canvas')).toHaveCount(1);
  const highlight = page.getByTestId('sheet-highlight');
  await expect(highlight).toBeVisible();
  await expect(highlight).toHaveAttribute('data-bar', '0');
  await expect(page.getByTestId('sheet-page')).toHaveText('Page 1 of 1');

  // The map is stored on the piece, so the bars are not looked for again next time.
  const stored = (await storedMap(page, id))?.barOfMeasure;
  expect(stored).toEqual(PLAYED);

  await recordBars(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shownBars: number[] }).shownBars), {
      timeout: 30_000,
    })
    .toEqual(expect.arrayContaining([7]));
  const seen = await page.evaluate(() => (window as unknown as { shownBars: number[] }).shownBars);
  // Bars 3 to 5 twice, then on to the end.
  expect(seen.slice(0, PLAYED.length)).toEqual(PLAYED);
  // Narrow (a third of an iPad) and turned: no sideways scrolling, and the highlight stays.
  for (const size of [
    { width: 320, height: 768 },
    { width: 820, height: 1180 },
    { width: 1180, height: 820 },
  ]) {
    await page.setViewportSize(size);
    await expect(highlight).toBeVisible();
    await expect(panel.locator('canvas.ot-sheet-canvas')).toHaveCount(1);
    // Polled: right after a resize WebKit can report the old width for a moment.
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);
  }
  expect(problems).toEqual([]);
});

test('bars can be adjusted, and the corrections are kept', async ({ page }) => {
  test.setTimeout(90_000);
  const id = await addPiece(page, {
    title: 'Adjust test',
    format: 'midi',
    song: songOf(PLAYED),
    pdf: sheetPdf(),
  });
  await page.goto(`./#/practice/library/${id}`);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' }).click();
  const panel = page.getByRole('region', { name: 'Your sheet music' });
  await expect(panel).toHaveAttribute('data-map', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Adjust bars' }).click();
  await expect(panel.locator('.ot-sheet-outline')).toHaveCount(8);
  // The highlight runs a bar behind from the first bar on.
  await panel.getByRole('button', { name: 'a bar behind' }).click();
  await expect(page.getByTestId('sheet-highlight')).toHaveAttribute('data-bar', '1');
  // A tap in the first bar goes there and marks the place; the barline is added on request.
  const box = await panel.locator('.ot-sheet-outline').first().boundingBox();
  if (!box) throw new Error('No outline for the first bar');
  const tapFirstBar = () => page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
  await tapFirstBar();
  await expect(panel.locator('.ot-sheet-mark')).toBeVisible();
  await expect(panel.locator('.ot-sheet-outline')).toHaveCount(8);
  await panel.getByRole('button', { name: 'Add a barline here' }).click();
  await expect(panel.locator('.ot-sheet-outline')).toHaveCount(9);
  await panel.getByRole('button', { name: 'Undo' }).click();
  await expect(panel.locator('.ot-sheet-outline')).toHaveCount(8);
  await tapFirstBar();
  await panel.getByRole('button', { name: 'Add a barline here' }).click();
  await expect(panel.locator('.ot-sheet-outline')).toHaveCount(9);
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(panel.locator('.ot-sheet-outline')).toHaveCount(0);
  // After a reload the corrected bars are still there and not found afresh.
  await page.reload();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' }).click();
  await expect(panel).toHaveAttribute('data-map', 'ready', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Adjust bars' }).click();
  await expect(panel.locator('.ot-sheet-outline')).toHaveCount(9);
  await expect(panel).not.toHaveAttribute('data-analysis-ms');
});

test('a sheet-only piece opens as a reader, and pieces without a sheet never load pdf.js', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  const plain = await addPiece(page, { title: 'No sheet', format: 'midi', song: songOf([0, 1]) });
  await page.goto(`./#/practice/library/${plain}`);
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
  await expect(
    page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' }),
  ).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(requests.filter((u) => /pdf/i.test(u))).toEqual([]);

  const only = await addPiece(page, {
    title: 'Only a sheet',
    format: 'pdf',
    song: EMPTY_SONG,
    pdf: sheetPdf(),
  });
  await page.goto(`./#/practice/library/${only}`);
  await expect(
    page.getByText(
      'Add the MIDI file of this piece to practise it with falling notes and feedback.',
    ),
  ).toBeVisible();
  const panel = page.getByRole('region', { name: 'Your sheet music' });
  await expect(panel.locator('canvas.ot-sheet-canvas')).toHaveCount(1, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toHaveCount(0);
  expect(requests.some((u) => /assets\/pdf/.test(u))).toBe(true);
});

test('a scanned sheet is read from its page image', async ({ page }) => {
  test.setTimeout(90_000);
  const written = HEADS.map((_, i) => i);
  const id = await addPiece(page, {
    title: 'Scan test',
    format: 'midi',
    song: songOf(written),
    pdf: scanPdf([sheetPage()]),
  });
  await page.goto(`./#/practice/library/${id}`);
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' }).click();
  const panel = page.getByRole('region', { name: 'Your sheet music' });
  await expect(panel).toHaveAttribute('data-map', 'ready', { timeout: 30_000 });
  await expect(page.getByTestId('sheet-highlight')).toHaveAttribute('data-bar', '0');
  const map = await storedMap(page, id);
  expect(map?.layout.source).toBe('raster');
  expect(map?.layout.bars).toHaveLength(8);
  expect(map?.barOfMeasure).toEqual(written);
});
