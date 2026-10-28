import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

// P5-09: from Home to playing in two clicks at most. Only the clicks named in each test are made;
// everything after them is the learner playing notes on the computer keyboard.

/** A one-track MIDI file: C4 D4 E4 F4 as quarter notes. */
function tinyMidi(): Buffer {
  const events: number[] = [];
  [60, 62, 64, 65].forEach((p) => events.push(0, 0x90, p, 80, 0x83, 0x60, 0x80, p, 0));
  events.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const track = [0x4d, 0x54, 0x72, 0x6b, 0, 0, (events.length >> 8) & 0xff, events.length & 0xff];
  return Buffer.from([...header, ...track, ...events]);
}

/** Alle meine Entchen, the first piece on the path, opens on C3 and C4 together. */
async function playFirstStep(page: Page) {
  await page.keyboard.press('KeyZ'); // the computer keys an octave down: A is C3, K is C4
  await page.keyboard.down('KeyA');
  await page.keyboard.down('KeyK');
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyK');
}

// The card says "Continue" once a run has been played; it is the same link, to the next piece on
// the path that is not mastered yet.
test('a learner is playing one click after opening the app', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: /Start here/ }).click(); // 1
  await expect(page).toHaveURL(/#\/practice\/catalogue\/alle-meine-entchen$/);
  const stats = page.locator('.stats');
  await expect(stats).toContainText('Step 1/');
  await playFirstStep(page);
  await expect(stats).toContainText('Step 2/');
});

test('a piece in the library is playing two clicks after opening the app', async ({ page }) => {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (await chooser).setFiles({ name: 'scale.mid', mimeType: 'audio/midi', buffer: tinyMidi() });
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);

  await page.goto('./');
  await page.getByRole('navigation').getByRole('link', { name: 'My library' }).click(); // 1
  await page.locator('.card', { hasText: 'scale' }).getByRole('link').first().click(); // 2
  await expect(page).toHaveURL(/#\/practice\/library\//);
  const stats = page.locator('.stats');
  await expect(stats).toContainText('Step 1/4');
  await page.keyboard.press('KeyA');
  await expect(stats).toContainText('Step 2/4');
});
