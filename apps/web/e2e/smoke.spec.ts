import { expect, test } from '@playwright/test';

test('the catalogue lists public-domain pieces', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Free piano practice' })).toBeVisible();
  await expect(page.locator('.card h3', { hasText: 'Ode to Joy (theme)' })).toBeVisible();
});

test('wait mode advances on correct notes and counts wrong ones', async ({ page }) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Right', exact: true }).click();
  const stats = page.locator('.stats');
  await expect(stats).toContainText('Step 1/');
  await page.keyboard.press('KeyD'); // E4
  await expect(stats).toContainText('Step 2/');
  await page.keyboard.press('KeyF'); // F4: wrong, E4 expected again
  await expect(stats).toContainText('✗ 1');
  await page.keyboard.press('KeyD');
  await expect(stats).toContainText('Step 3/');
});

/** A one-track MIDI file: C4 D4 E4 F4 as quarter notes. */
function tinyMidi(): Buffer {
  const events: number[] = [];
  [60, 62, 64, 65].forEach((p, i) => {
    events.push(i === 0 ? 0 : 0, 0x90, p, 80, 0x83, 0x60, 0x80, p, 0);
  });
  events.push(0, 0xff, 0x2f, 0);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  const len = events.length;
  return Buffer.from([
    ...header,
    0x4d,
    0x54,
    0x72,
    0x6b,
    0,
    0,
    (len >> 8) & 0xff,
    len & 0xff,
    ...events,
  ]);
}

test('a MIDI file can be imported into the private library and practised', async ({ page }) => {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (await chooser).setFiles({ name: 'scale.mid', mimeType: 'audio/midi', buffer: tinyMidi() });
  await expect(page.getByRole('heading', { name: 'Check the import' })).toBeVisible();
  await expect(page.getByText('4 notes in 1 bars')).toBeVisible();
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page).toHaveURL(/#\/practice\/library\//);
  await expect(page.locator('.stats')).toContainText('Step 1/4');
  await page.keyboard.press('KeyA');
  await expect(page.locator('.stats')).toContainText('Step 2/4');
});

test('the detector runs on a (fake) microphone', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Fake media devices are configured for Chromium only');
  await page.goto('./#/lab');
  await page.getByRole('button', { name: 'Start microphone' }).click();
  await expect(page.getByRole('button', { name: 'Stop microphone' })).toBeVisible();
  await expect(page.getByRole('log')).toContainText('onset', { timeout: 10_000 });
});

test('the detector benchmark runs the WebAssembly engine', async ({ page }) => {
  await page.goto('./#/lab');
  await page.getByRole('button', { name: 'Benchmark detector speed' }).click();
  await expect(page.getByText(/ms per 5\.3 ms hop/)).toBeVisible({ timeout: 20_000 });
});
