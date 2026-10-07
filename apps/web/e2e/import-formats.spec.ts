// Library import of ABC and MuseScore files. Both files are self-made and generated here (CC0).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function importFile(page: Page, name: string, mimeType: string, text: string) {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (await chooser).setFiles({ name, mimeType, buffer: Buffer.from(text, 'utf8') });
  await expect(page.getByRole('heading', { name: 'Check the import' })).toBeVisible();
}

test('an ABC tune can be imported, with its estimated level', async ({ page }) => {
  await importFile(
    page,
    'tune.abc',
    'text/plain',
    'X:1\nT:Little Tune\nL:1/4\nQ:1/4=90\nK:C\nCDEF|\n',
  );
  await expect(page.getByLabel('Title')).toHaveValue('Little Tune');
  await expect(page.getByText('4 notes in 1 bars')).toBeVisible();
  await expect(page.getByText('Estimated level 1 of 5')).toBeVisible();
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await expect(page.locator('.stats')).toContainText('Step 1/4');
});

test('a MuseScore file can be imported', async ({ page }) => {
  const chord = (pitch: number) =>
    `<Chord><durationType>quarter</durationType><Note><pitch>${pitch}</pitch><tpc>14</tpc></Note></Chord>`;
  const mscx = `<?xml version="1.0" encoding="UTF-8"?>
<museScore version="4.20"><Score><Division>480</Division><metaTag name="workTitle">Four Steps</metaTag>
<Part><Staff id="1"><StaffType group="pitched"/></Staff><trackName>Piano</trackName><Instrument><longName>Piano</longName></Instrument></Part>
<Staff id="1"><Measure><voice><TimeSig><sigN>4</sigN><sigD>4</sigD></TimeSig>${[60, 62, 64, 65].map(chord).join('')}</voice></Measure></Staff>
</Score></museScore>`;
  await importFile(page, 'steps.mscx', 'application/xml', mscx);
  await expect(page.getByLabel('Title')).toHaveValue('Four Steps');
  await expect(page.getByText('4 notes in 1 bars')).toBeVisible();
});
