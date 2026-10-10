// Sheet-music PDFs kept with a piece (P5-15, ADR 0018): importing a PDF with its MIDI file, a PDF
// on its own, and adding, replacing and removing one later. Every file is generated in
// e2e/fixtures.ts (CC0).
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { tinyMidi, tinyPdf } from './fixtures';

const midi = (name: string) => ({ name, mimeType: 'audio/midi', buffer: tinyMidi() });
const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: tinyPdf() });

/** Pages (one per test) where the import rights are already confirmed. */
const confirmed = new WeakSet<Page>();

/** Opens the library's file picker, confirming the import rights the first time. */
async function pickFiles(page: Page, files: ReturnType<typeof midi>[]) {
  await page.goto('./#/library');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  if (!confirmed.has(page)) {
    await page.getByRole('checkbox', { name: /I only import files/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    confirmed.add(page);
  }
  await (await chooser).setFiles(files);
}

const card = (page: Page, title: string): Locator =>
  page.locator('.library-item').filter({ has: page.locator('h3', { hasText: title }) });

test('a MIDI file and the PDF of the same name become one piece with its sheet', async ({
  page,
}) => {
  await pickFiles(page, [pdf('Little Study.pdf'), midi('Little Study.mid')]);
  await expect(page.getByRole('heading', { name: 'Check the import' })).toBeVisible();
  await expect(page.getByText('Sheet music: Little Study.pdf')).toBeVisible();
  await expect(page.getByText('4 notes in 1 bars')).toBeVisible();
  await page.getByRole('button', { name: 'Save to my library' }).click();
  // One piece with notes opens for practice, as a MIDI file alone does.
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await expect(page.locator('.stats')).toContainText('Step 1/4');

  await page.goto('./#/library');
  await expect(page.locator('.library-item')).toHaveCount(1);
  const piece = card(page, 'Little Study');
  await expect(piece.locator('.badge', { hasText: 'Sheet' })).toBeVisible();
  await expect(piece).toContainText('Little Study.pdf');
  await expect(piece.getByRole('link', { name: 'Practise' })).toBeVisible();
});

test('the review can leave the sheet out before saving', async ({ page }) => {
  await pickFiles(page, [midi('Left Out.mid'), pdf('Left Out.pdf')]);
  await page.getByRole('button', { name: 'Leave out the sheet music' }).click();
  await expect(page.getByText('Sheet music: Left Out.pdf')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await page.goto('./#/library');
  const piece = card(page, 'Left Out');
  await expect(piece.locator('.badge')).toHaveCount(0);
  await expect(piece.getByRole('button', { name: 'Add sheet music (PDF)' })).toBeVisible();
});

test('a PDF alone becomes a sheet-only piece, and its MIDI file can be added later', async ({
  page,
}) => {
  await pickFiles(page, [pdf('Quiet Waltz.pdf')]);
  await expect(page.getByLabel('Title')).toHaveValue('Quiet Waltz');
  await expect(page.getByText('Sheet music: Quiet Waltz.pdf')).toBeVisible();
  await expect(page.getByText(/has no notes OpenTiles can follow/)).toBeVisible();
  await expect(page.getByLabel('Tempo')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save to my library' }).click();

  // It stays in the library: there is nothing to practise yet.
  await expect(page).toHaveURL(/#\/library$/);
  const piece = card(page, 'Quiet Waltz');
  await expect(piece).toContainText('PDF');
  await expect(piece).toContainText('Sheet only — add the MIDI file to practise');
  await expect(piece.locator('.badge', { hasText: 'Sheet' })).toBeVisible();
  await expect(piece.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    /#\/practice\/library\/\d+$/,
  );
  await expect(piece.getByRole('button', { name: 'Remove sheet music' })).toHaveCount(0);

  const chooser = page.waitForEvent('filechooser');
  await piece.getByRole('button', { name: 'Add the MIDI or score file' }).click();
  await (await chooser).setFiles(midi('quiet-waltz.mid'));
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Check the import' })).toBeVisible();
  // The learner's title stays; the sheet stays and cannot be dropped here.
  await expect(dialog.getByLabel('Title')).toHaveValue('Quiet Waltz');
  await expect(dialog.getByText('Sheet music: Quiet Waltz.pdf')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Leave out the sheet music' })).toHaveCount(0);
  await expect(dialog.getByText('4 notes in 1 bars')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await expect(page.locator('.stats')).toContainText('Step 1/4');

  await page.goto('./#/library');
  await expect(page.locator('.library-item')).toHaveCount(1);
  const done = card(page, 'Quiet Waltz');
  await expect(done).not.toContainText('Sheet only');
  await expect(done).toContainText('MIDI');
  await expect(done.locator('.badge', { hasText: 'Sheet' })).toBeVisible();
  await expect(done.getByRole('link', { name: 'Practise' })).toBeVisible();
});

test('a PDF can be added to a piece, replaced and removed', async ({ page }) => {
  await pickFiles(page, [midi('Scale Study.mid')]);
  await expect(page.getByText(/Sheet music:/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);

  await page.goto('./#/library');
  const piece = card(page, 'Scale Study');
  await expect(piece.locator('.badge')).toHaveCount(0);
  let chooser = page.waitForEvent('filechooser');
  await piece.getByRole('button', { name: 'Add sheet music (PDF)' }).click();
  await (await chooser).setFiles(pdf('Scale Study (edition A).pdf'));
  await expect(piece.locator('.badge', { hasText: 'Sheet' })).toBeVisible();
  await expect(piece).toContainText('Scale Study (edition A).pdf');

  chooser = page.waitForEvent('filechooser');
  await piece.getByRole('button', { name: 'Replace sheet music' }).click();
  await (await chooser).setFiles(pdf('Scale Study (edition B).pdf'));
  await expect(piece).toContainText('Scale Study (edition B).pdf');
  await expect(piece).not.toContainText('edition A');

  // Something that is not a PDF is refused with a plain message, and the sheet stays.
  chooser = page.waitForEvent('filechooser');
  await piece.getByRole('button', { name: 'Replace sheet music' }).click();
  await (
    await chooser
  ).setFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('hello') });
  await expect(piece.locator('.error')).toContainText('“notes.pdf” is not a PDF file');
  await expect(piece).toContainText('Scale Study (edition B).pdf');

  page.once('dialog', (d) => void d.accept());
  await piece.getByRole('button', { name: 'Remove sheet music' }).click();
  await expect(piece.locator('.badge')).toHaveCount(0);
  await expect(piece).not.toContainText('edition B');
  await expect(piece.getByRole('link', { name: 'Practise' })).toBeVisible();
});

test('a score file and a PDF with different names: the learner decides', async ({ page }) => {
  await pickFiles(page, [midi('Etude.mid'), pdf('Scan 0042.pdf')]);
  await expect(
    page.getByRole('heading', { name: 'Is this PDF the sheet music of this piece?' }),
  ).toBeVisible();
  await expect(page.getByText('The names differ: “Etude.mid” and “Scan 0042.pdf”.')).toBeVisible();
  await page.getByRole('button', { name: 'No, two pieces' }).click();
  await expect(page.getByText('Piece 1 of 2')).toBeVisible();
  await expect(page.getByText(/Sheet music:/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page.getByText('Piece 2 of 2')).toBeVisible();
  await expect(page.getByText('Sheet music: Scan 0042.pdf')).toBeVisible();
  await page.getByRole('button', { name: 'Save to my library' }).click();
  // Two pieces: the library shows them both rather than opening one.
  await expect(page).toHaveURL(/#\/library$/);
  await expect(page.locator('.library-item')).toHaveCount(2);

  await pickFiles(page, [midi('Etude.mid'), pdf('Scan 0042.pdf')]);
  await page.getByRole('button', { name: 'Yes, one piece' }).click();
  await expect(page.getByText('Sheet music: Scan 0042.pdf')).toBeVisible();
});

test('several pairs dropped on the page at once are reviewed one by one', async ({ page }) => {
  // Confirm the rights first, so the drop goes straight to the review.
  await pickFiles(page, [midi('Warm-up.mid')]);
  await page.getByRole('button', { name: 'Cancel' }).click();

  const files = [
    { name: 'Minuet.mid', type: 'audio/midi', bytes: [...tinyMidi()] },
    { name: 'Minuet.pdf', type: 'application/pdf', bytes: [...tinyPdf()] },
    { name: 'Gavotte.PDF', type: 'application/pdf', bytes: [...tinyPdf()] },
    { name: 'gavotte.mid', type: 'audio/midi', bytes: [...tinyMidi()] },
  ];
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list)
      dt.items.add(new File([new Uint8Array(f.bytes)], f.name, { type: f.type }));
    return dt;
  }, files);
  await page.dispatchEvent('main', 'dragenter', { dataTransfer });
  await expect(page.locator('.import-box--drop')).toBeVisible();
  await page.dispatchEvent('main', 'drop', { dataTransfer });
  await expect(page.locator('.import-box--drop')).toHaveCount(0);

  await expect(page.getByText('Piece 1 of 2')).toBeVisible();
  await expect(page.getByText('Sheet music: Minuet.pdf')).toBeVisible();
  await page.getByLabel('Title').fill('Minuet');
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page.getByText('Piece 2 of 2')).toBeVisible();
  await expect(page.getByText('Sheet music: Gavotte.PDF')).toBeVisible();
  await page.getByLabel('Title').fill('Gavotte');
  await page.getByRole('button', { name: 'Save to my library' }).click();

  await expect(page.locator('.library-item')).toHaveCount(2);
  for (const title of ['Minuet', 'Gavotte']) {
    await expect(card(page, title).locator('.badge', { hasText: 'Sheet' })).toBeVisible();
  }
  // Search finds a piece by its PDF's name too.
  await page.getByLabel('Search your library').fill('gavotte.pdf');
  await expect(page.locator('.library-item')).toHaveCount(1);
});

test('the library with sheet music fits a ⅓-width iPad window', async ({ page }) => {
  await pickFiles(page, [
    pdf('Composer_ A. Person Arranger_ B. Other - A Rather Long Title for a Small Window.pdf'),
  ]);
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await pickFiles(page, [midi('Pair.mid'), pdf('Pair.pdf')]);
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await page.setViewportSize({ width: 320, height: 768 });
  await page.goto('./#/library');
  await expect(page.locator('.library-item')).toHaveCount(2);
  const { pageWidth, viewportWidth } = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(pageWidth).toBeLessThanOrEqual(viewportWidth);
  for (const button of await page.locator('.library-item button, .library-item a').all()) {
    const box = await button.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewportWidth);
  }
});
