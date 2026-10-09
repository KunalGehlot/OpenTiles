// Keyboard size, fingering and the timing teacher (PLAN.md P4-07…P4-09). The tune is self-made and
// generated here (CC0).
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The keyboard size and the fingers are in the Options panel of the practice header. */
async function openOptions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(page.getByRole('group', { name: 'Options' })).toBeVisible();
}

async function importTune(page: Page): Promise<void> {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'tune.abc',
    mimeType: 'text/plain',
    buffer: Buffer.from('X:1\nT:Hold Tune\nL:1/4\nQ:1/4=90\nK:C\nCDEF|\n', 'utf8'),
  });
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await expect(page.locator('.stats')).toContainText('Step 1/4');
}

test('note names follow the chosen style wherever the app names a note (P5-03)', async ({
  page,
}) => {
  await page.goto('./#/settings');
  await page.getByLabel('Keyboard size').selectOption('custom');
  await page.getByLabel('Lowest key').selectOption({ label: 'A0' });
  await page.getByLabel('Number of keys').fill('86');
  const range = page.getByTestId('custom-keyboard');
  await expect(range).toHaveText('86 keys (A0–B♭7)');
  const style = page.getByLabel('How note names are written');
  await expect(style).toHaveValue('auto');
  await style.selectOption('german');
  await expect(range).toHaveText('86 keys (A0–B7)');
  await style.selectOption('fixed-do');
  await expect(range).toHaveText('86 keys (La0–Si♭7)');
  await expect(page.getByLabel('Lowest key').locator('option:checked')).toHaveText('La0');
  await page.reload();
  await expect(page.getByLabel('How note names are written')).toHaveValue('fixed-do');
  await expect(page.getByTestId('custom-keyboard')).toHaveText('86 keys (La0–Si♭7)');
});

test('a custom keyboard is set up in Settings and drawn in practice', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByLabel('Keyboard size').selectOption('custom');
  await page.getByLabel('Lowest key').selectOption({ label: 'A0' });
  const keys = page.getByLabel('Number of keys');
  await keys.fill('86');
  await expect(page.getByTestId('custom-keyboard')).toHaveText('86 keys (A0–B♭7)');
  await page.reload();
  await expect(page.getByLabel('Number of keys')).toHaveValue('86');

  await page.goto('./#/practice/catalogue/ode-to-joy');
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-keys', '21-106');
  // The Options panel switches size on the spot; a 25-key board starts at C3.
  await openOptions(page);
  await page.getByRole('combobox', { name: 'Keyboard size' }).selectOption('25');
  await expect(canvas).toHaveAttribute('data-keys', '48-72');
  await page.getByRole('combobox', { name: 'Keyboard size' }).selectOption('auto');
  await expect(canvas).not.toHaveAttribute('data-keys', '48-72');
});

test('the Options panel opens from its button and closes with Escape or a press outside', async ({
  page,
}) => {
  await page.goto('./#/practice/catalogue/ode-to-joy');
  await expect(page.locator('canvas')).toBeVisible();
  const button = page.getByRole('button', { name: 'Options' });
  const panel = page.getByRole('group', { name: 'Options' });
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await expect(panel).toHaveCount(0);

  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: 'All settings' })).toBeVisible();

  // Escape closes it and puts focus back on the button.
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(button).toBeFocused();

  // So does a press outside the panel.
  await button.click();
  await expect(panel).toBeVisible();
  await page.mouse.click(40, 400);
  await expect(panel).toHaveCount(0);
});

test('a piece too wide for the keyboard is moved and the screen says so', async ({ page }) => {
  await page.goto('./#/library');
  await page.getByRole('button', { name: 'Import a file…' }).click();
  await page.getByRole('checkbox').check();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Continue' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'high.abc',
    mimeType: 'text/plain',
    buffer: Buffer.from("X:1\nT:High Tune\nL:1/4\nK:C\nc'd'e'f'|\n", 'utf8'),
  });
  await page.getByRole('button', { name: 'Save to my library' }).click();
  await openOptions(page);
  await page.getByRole('combobox', { name: 'Keyboard size' }).selectOption('25');
  await expect(
    page.getByRole('status').filter({ hasText: 'to fit your 25-key keyboard' }),
  ).toHaveText('Moved down 2 octaves to fit your 25-key keyboard.');
});

test('holds are judged, and the run can be heard back', async ({ page }) => {
  await importTune(page);
  await openOptions(page);
  await page.getByRole('combobox', { name: 'Fingering' }).selectOption('suggested');
  // Escape closes the panel and puts focus back on its button, so the computer keys play again.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('group', { name: 'Options' })).toHaveCount(0);
  // The computer keyboard plays like a piano: A S D F are C D E F. The first note is only tapped.
  await page.keyboard.down('a');
  await page.keyboard.up('a');
  for (const key of ['s', 'd', 'f']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(750);
    await page.keyboard.up(key);
  }
  await expect(page.getByRole('heading', { name: 'Well played!' })).toBeVisible();
  await expect(page.getByTestId('hold-summary')).toHaveText('Held well: 3 of 4 · 1 too short');
  const listen = page.getByRole('group', { name: 'Listen to your performance' });
  await expect(listen).toBeVisible();
  // Library pieces are heard back but not saved as files.
  await expect(listen.getByRole('button', { name: 'Save as WAV' })).toHaveCount(0);
  await listen.getByRole('button', { name: 'As played' }).click();
  await listen.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(listen.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
  await listen.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(listen.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
});
